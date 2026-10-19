import { ja, type MsgKey } from './ja.js'
import { en } from './en.js'
import { FALLBACK_LOCALE, LOCALE_META, type Locale } from './locales.js'

export type { MsgKey }
export { ja, en }
export {
  FALLBACK_LOCALE,
  LOCALE_META,
  LOCALES,
  isLocale,
  negotiateLocale,
  type Locale,
  type LocaleMeta,
} from './locales.js'

/**
 * 言語ごとの辞書。**全キーを持つことを型で強制する**（`satisfies Record<MsgKey, string>`）。
 * 言語を足すときは `locales.ts` の表に 1 行と、ここに 1 つ。
 */
export const DICTIONARIES: Readonly<Record<Locale, Readonly<Record<MsgKey, string>>>> = { ja, en }

/** その言語の訳文。無ければ en、それも無ければ ja（原文）、それも無ければキー名。 */
function lookup(locale: Locale, key: string): string {
  return (
    (DICTIONARIES[locale] as Record<string, string> | undefined)?.[key] ??
    (DICTIONARIES[FALLBACK_LOCALE] as Record<string, string>)[key] ??
    (ja as Record<string, string>)[key] ??
    key
  )
}

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

/**
 * 複数形の区切り `{n, plural, one {# item} other {# items}}` を、数に合う形に置き換える。
 *
 * ICU MessageFormat の plural だけを、必要な分だけ実装する（select・offset・`=0` は持たない）。
 * 形は `Intl.PluralRules` で選び、**その形が書かれていなければ `other`** を使う
 * （フランス語の many のように、訳者が書かない形を CLDR が返すことがある）。
 * `#` はその数に置き換える。中に `{size}` のような通常の差し込みがあれば、
 * そのまま残して後の置換に任せる。
 *
 * 値が無い・数として読めないときは**ブロックごと残す**（渡し忘れに気づけるように）。
 * 書式が壊れていても例外は投げない（辞書は手で書くもの）。
 */
export function resolvePlurals(
  template: string,
  params: Readonly<Record<string, unknown>> | undefined,
  locale: Locale | undefined,
): string {
  if (!template.includes(', plural,') && !template.includes(',plural,')) return template
  let out = ''
  let i = 0
  const head = /\{([A-Za-z][A-Za-z0-9_]*)\s*,\s*plural\s*,/y
  while (i < template.length) {
    head.lastIndex = i
    const m = template[i] === '{' ? head.exec(template) : null
    if (m === null) {
      out += template[i]
      i++
      continue
    }
    const block = parsePluralBlock(template, head.lastIndex)
    if (block === null) {
      out += template.slice(i)
      break
    }
    const raw = params?.[m[1]!]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(n)) {
      out += template.slice(i, block.end)
    } else {
      const tag = locale === undefined ? 'en-US' : LOCALE_META[locale]?.intl ?? 'en-US'
      let category: string
      try {
        category = new Intl.PluralRules(tag).select(n)
      } catch {
        category = 'other'
      }
      const chosen = block.forms.get(category) ?? block.forms.get('other') ?? ''
      out += chosen.replace(/#/g, String(n))
    }
    i = block.end
  }
  return out
}

/** `{n, plural,` の直後から読み、`one {..} other {..}}` を取り出す。壊れていれば null。 */
function parsePluralBlock(text: string, start: number): { forms: Map<string, string>; end: number } | null {
  const forms = new Map<string, string>()
  let i = start
  for (;;) {
    while (i < text.length && /\s/.test(text[i]!)) i++
    if (i >= text.length) return null
    if (text[i] === '}') return { forms, end: i + 1 }
    const sel = /[A-Za-z=0-9]+/y
    sel.lastIndex = i
    const m = sel.exec(text)
    if (m === null) return null
    i = sel.lastIndex
    while (i < text.length && /\s/.test(text[i]!)) i++
    if (text[i] !== '{') return null
    let depth = 0
    const bodyStart = i + 1
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) return null
    forms.set(m[0], text.slice(bodyStart, i))
    i++
  }
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
  template = resolvePlurals(template, params, locale)
  // 判定用と置換用で正規表現を共有しない（落とし穴 63）。ここは置換専用。
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const value = params[name]
    if (value === undefined) return whole
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (!isLocalizedText(value)) return whole
    // 訳せないもの（locale が無い・深すぎる）はプレースホルダのまま残す。
    // JSON から来た値は循環しないが、**深さは外から決まる**ので必ず上限を置く。
    if (locale === undefined || depth >= MAX_NEST_DEPTH) return whole
    return interpolateAt(lookup(locale, value.key), value.params, locale, depth + 1)
  })
}

/**
 * 訳文に含まれる差し込み名の集合を返す（言語間の食い違いを検出するために使う）。
 * 複数形のブロック `{n, plural, …}` の `n` と、その中の `{size}` も数える。
 */
export function placeholdersOf(template: string): string[] {
  const found = new Set<string>()
  // `matchAll` は毎回新しい正規表現を作る（`/g` の lastIndex を持ち回さない）
  for (const m of template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)(?:\}|\s*,\s*plural\s*,)/g)) found.add(m[1]!)
  return [...found].sort()
}

/** 翻訳関数を作る。未知のキーはキー名をそのまま返す（画面が空白になるより気づきやすい）。 */
export function createTranslator(locale: Locale): (key: MsgKey, params?: MsgParams) => string {
  return (key: MsgKey, params?: MsgParams) => interpolate(lookup(locale, key), params, locale)
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

