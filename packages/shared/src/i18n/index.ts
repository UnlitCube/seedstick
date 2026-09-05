import { ja, type MsgKey } from './ja.js'
import { en } from './en.js'

export type Locale = 'ja' | 'en'
export type { MsgKey }
export { ja, en }

export const LOCALES: readonly Locale[] = ['ja', 'en']

const DICTS: Record<Locale, Record<MsgKey, string>> = { ja, en }

/**
 * `{name}` の差し込みに渡せる値。ReactNode は renderer 側の `useTx` が扱う。
 *
 * `LocalizedText` を許すのは、**文の中に別の訳文が入る**ことが実際にあるため。
 * 「\.\PhysicalDrive1 には書き込めません: OS が入っているシステムディスクです」は
 * 外側（どのデバイスが拒否されたか）と内側（なぜ拒否されたか）が別々の場所で作られる。
 * 入れ子を許さないと、内側を捨てる（英語の利用者に理由が届かない）か、
 * 片方の言語で組み立てて連結する（英語の画面に日本語が混ざる）しかない。
 * どちらも実際に一度そうなった。
 *
 * 入れ子でも JSON 往復で壊れない（`{key, params}` は純粋なデータのまま）。
 */
export type MsgParamValue = string | number | LocalizedText
export type MsgParams = Readonly<Record<string, MsgParamValue>>

/** 入れ子の深さの上限。これを超えたらプレースホルダを残す（下の理由を参照）。 */
const MAX_NEST_DEPTH = 4

/**
 * `LocalizedText` の形をしているか。**壊れた値が IPC / NDJSON から届く前提で見る**。
 *
 * **ここが唯一の定義。** 同じ判定を受け取り口ごとに書き写すと、片方だけが
 * 契約の変更に追いつかない。実際に一度そうなった: 入れ子を許したあとも
 * ワーカー境界の写しが `params` を `string | number` に限っていたため、
 * 理由つきの拒否（`device.rejectedNotWritable`）が境界で捨てられ、
 * 画面には「予期しないエラーが発生しました」だけが出ていた。
 *
 * `deep` を渡すと `params` の中身まで見る（プロセス境界を越える値の検査用）。
 * 既定は形だけを見る（差し込みの途中で毎回全体を歩かないため）。
 */
export function isLocalizedText(value: unknown, deep = false): value is LocalizedText {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as { key?: unknown; params?: unknown }
  if (typeof v.key !== 'string' || v.key.length === 0) return false
  if (!deep) return true
  if (v.params === undefined) return true
  if (typeof v.params !== 'object' || v.params === null || Array.isArray(v.params)) return false
  // 差し込み値は string / number か、**入れ子の LocalizedText**。
  // 深さは `MAX_NEST_DEPTH` までしか展開しないので、ここでも同じ深さで打ち切る。
  return Object.values(v.params as Record<string, unknown>).every(
    (p) => typeof p === 'string' || typeof p === 'number' || isLocalizedTextDeepAt(p, 1),
  )
}

function isLocalizedTextDeepAt(value: unknown, depth: number): boolean {
  if (depth > MAX_NEST_DEPTH) return false
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as { key?: unknown; params?: unknown }
  if (typeof v.key !== 'string' || v.key.length === 0) return false
  if (v.params === undefined) return true
  if (typeof v.params !== 'object' || v.params === null || Array.isArray(v.params)) return false
  return Object.values(v.params as Record<string, unknown>).every(
    (p) => typeof p === 'string' || typeof p === 'number' || isLocalizedTextDeepAt(p, depth + 1),
  )
}

/**
 * 訳文の `{name}` を差し込む。
 *
 * 値が無いキーは**プレースホルダをそのまま残す**。空文字に落とすと
 * 「3.2 GB 以上必要です」が「 以上必要です」になり、画面上は自然に見えて
 * しまう。`{size}` が残っていれば、渡し忘れだと一目で分かる。
 *
 * `locale` を渡すと、値の `LocalizedText` も訳して差し込む。渡さないときは
 * 入れ子を訳せないのでプレースホルダを残す（**日本語の既定に落とさない**。
 * 落とすと英語の画面に日本語が出て、しかもそれが正常に見える）。
 */
export function interpolate(template: string, params?: MsgParams, locale?: Locale): string {
  return interpolateAt(template, params, locale, 0)
}

function interpolateAt(
  template: string,
  params: MsgParams | undefined,
  locale: Locale | undefined,
  depth: number,
): string {
  // **`typeof null === 'object'`**（落とし穴 30）。`undefined` だけを見て弾くと、
  // `params: null` が `params[name]` まで進んで TypeError になる。
  // ここは IPC / NDJSON / 手で編集された JSON から値が来る場所なので、null も配列も届く。
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return template
  // 判定用と置換用で正規表現を共有しない（落とし穴 63）。ここは置換専用。
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const value = params[name]
    if (value === undefined) return whole
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (!isLocalizedText(value)) return whole
    // 訳せないもの（locale が無い・深すぎる）はプレースホルダのまま残す。
    // JSON から来た値は循環しないが、**深さは外から決まる**ので必ず上限を置く。
    if (locale === undefined || depth >= MAX_NEST_DEPTH) return whole
    const dict = DICTS[locale] ?? ja
    const inner = dict[value.key] ?? ja[value.key] ?? value.key
    return interpolateAt(inner, value.params, locale, depth + 1)
  })
}

/** 訳文に含まれる `{name}` の集合を返す（ja / en の食い違いを検出するために使う）。 */
export function placeholdersOf(template: string): string[] {
  const found = new Set<string>()
  // `matchAll` は毎回新しい正規表現を作る（`/g` の lastIndex を持ち回さない）
  for (const m of template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) found.add(m[1]!)
  return [...found].sort()
}

/** 翻訳関数を作る。未知のキーはキー名をそのまま返す（画面が空白になるより気づきやすい）。 */
export function createTranslator(locale: Locale): (key: MsgKey, params?: MsgParams) => string {
  const dict = DICTS[locale] ?? ja
  return (key: MsgKey, params?: MsgParams) =>
    interpolate(dict[key] ?? ja[key] ?? key, params, locale)
}

/**
 * 画面に出す文言を「キー + 差し込み値」で運ぶ。
 *
 * main と `@autoinstall/media` は利用者の言語を知らない
 * （昇格ワーカーは別プロセスで、設定も locale も持たない）ので、
 * **訳さずに運び、renderer が訳す**。
 *
 * これは IPC と NDJSON を通る**純粋なデータ**でなければならない。
 * 関数・Symbol・`undefined` を持たせないこと（JSON 往復で別物になる）。
 * `params` の値を `string | number` 以外へ広げるとこの性質が壊れるので、
 * `MsgParams` を広げるときはここの契約も一緒に見直す。
 */
export interface LocalizedText {
  readonly key: MsgKey
  readonly params?: MsgParams
}

/**
 * `LocalizedText` を作る。`params` を渡さないときは**キーを生やさない**
 * （`{key, params: undefined}` は JSON 往復で `{key}` になり、`toEqual` で別物になる）。
 */
export function localized(key: MsgKey, params?: MsgParams): LocalizedText {
  return params === undefined ? { key } : { key, params }
}

/** `LocalizedText` をその言語の文字列にする。`createTranslator(locale)(key, params)` と同じ。 */
export function formatLocalized(locale: Locale, text: LocalizedText): string {
  return createTranslator(locale)(text.key, text.params)
}

/** OS のロケール文字列（`ja-JP` 等）から対応言語を選ぶ。 */
export function resolveLocale(systemLocale: string | undefined): Locale {
  return (systemLocale ?? '').toLowerCase().startsWith('ja') ? 'ja' : 'en'
}
