/**
 * 画面の言語の表。**言語を足すときに触るのはここと辞書ファイルだけ**にする。
 *
 * 型 (`Locale`)・一覧 (`LOCALES`)・判定 (`isLocale`)・OS の言語からの選択
 * (`negotiateLocale`) はすべてこの表から導く。`'ja' | 'en'` のような写しを
 * IPC の契約・設定の正規化・インストーラに書くと、言語を足したときに写しだけが
 * 取り残される（落とし穴 74: 形の検査は定義を 1 つにする）。
 *
 * インストーラ（`apps/desktop/installer`）はアプリ本体のコードを読み込まない規約なので、
 * 同じ集合を自分の辞書に持つ。両者が食い違わないことは
 * `apps/desktop/src/main/installer-locales.test.ts` が見る。
 */

export interface LocaleMeta {
  /** その言語自身での名前（言語の選択肢に出す）。訳さない。 */
  readonly endonym: string
  /** `<html lang>` に入れるタグ。 */
  readonly htmlLang: string
  /** `Intl.DateTimeFormat` / `Intl.PluralRules` に渡すタグ。 */
  readonly intl: string
  /**
   * その言語の訳文に出てよい Unicode の文字体系（Common / Inherited は常に許す）。
   * 番人（i18n.test.ts）が「別の言語の文字が混ざっていないか」を見るのに使う。
   */
  readonly scripts: readonly string[]
  /** 全角の約物（、。「」（）など）を使う言語か。使わない言語に混ざったら訳し残し。 */
  readonly fullwidthPunctuation: boolean
}

export const LOCALE_META = {
  ja: {
    endonym: '日本語',
    htmlLang: 'ja',
    intl: 'ja-JP',
    scripts: ['Hiragana', 'Katakana', 'Han', 'Latin'],
    fullwidthPunctuation: true,
  },
  en: {
    endonym: 'English',
    htmlLang: 'en',
    intl: 'en-US',
    scripts: ['Latin'],
    fullwidthPunctuation: false,
  },
  'zh-Hans': {
    endonym: '简体中文',
    htmlLang: 'zh-Hans',
    intl: 'zh-CN',
    scripts: ['Han', 'Latin'],
    fullwidthPunctuation: true,
  },
  'zh-Hant': {
    endonym: '繁體中文',
    htmlLang: 'zh-Hant',
    intl: 'zh-TW',
    scripts: ['Han', 'Latin'],
    fullwidthPunctuation: true,
  },
  ko: {
    endonym: '한국어',
    htmlLang: 'ko',
    intl: 'ko-KR',
    scripts: ['Hangul', 'Latin'],
    fullwidthPunctuation: false,
  },
  es: {
    endonym: 'Español',
    htmlLang: 'es',
    intl: 'es-ES',
    scripts: ['Latin'],
    fullwidthPunctuation: false,
  },
  fr: {
    endonym: 'Français',
    htmlLang: 'fr',
    intl: 'fr-FR',
    scripts: ['Latin'],
    fullwidthPunctuation: false,
  },
  de: {
    endonym: 'Deutsch',
    htmlLang: 'de',
    intl: 'de-DE',
    scripts: ['Latin'],
    fullwidthPunctuation: false,
  },
  'pt-BR': {
    endonym: 'Português (Brasil)',
    htmlLang: 'pt-BR',
    intl: 'pt-BR',
    scripts: ['Latin'],
    fullwidthPunctuation: false,
  },
} as const satisfies Record<string, LocaleMeta>

export type Locale = keyof typeof LOCALE_META

/** 選択肢に並べる順。 */
export const LOCALES: readonly Locale[] = Object.keys(LOCALE_META) as Locale[]

/** 訳文が無いときに使う言語。ja を原文にしているが、ja 以外の利用者に日本語を出さないため en。 */
export const FALLBACK_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOCALE_META, value)
}

/** 表にある言語ならそれを、無ければ null（言語を足す前でもコンパイルできるように）。 */
function asLocale(id: string): Locale | null {
  return isLocale(id) ? id : null
}

/**
 * BCP 47 のタグ 1 つを、対応している言語に寄せる。寄せられなければ null。
 *
 * 中国語は**文字体系で分ける**（地域ではなく）。`zh-TW` / `zh-HK` / `zh-MO` は繁体字、
 * `zh` / `zh-CN` / `zh-SG` は簡体字。ポルトガル語は pt-BR しか持たないので `pt-PT` も寄せる。
 * それ以外は第 1 サブタグ（`es-MX` → `es`、`en-GB` → `en`）で見る。
 */
function matchTag(tag: string): Locale | null {
  const t = tag.trim().replace(/_/g, '-')
  if (t.length === 0) return null
  const lower = t.toLowerCase()
  for (const id of LOCALES) if (id.toLowerCase() === lower) return id
  const primary = lower.split('-')[0]!
  if (primary === 'zh') return asLocale(/-(hant|tw|hk|mo)(-|$)/.test(lower) ? 'zh-Hant' : 'zh-Hans')
  if (primary === 'pt') return asLocale('pt-BR')
  for (const id of LOCALES) if (id.toLowerCase().split('-')[0] === primary) return id
  return null
}

/**
 * OS が返す「好みの言語の並び」から 1 つ選ぶ。先頭から順に見て、最初に対応できたもの。
 * 1 つも対応できなければ en（例: 第一言語がイタリア語、第二が英語 → en）。
 *
 * main では `app.getPreferredSystemLanguages()`、renderer では `navigator.languages` を渡す。
 */
export function negotiateLocale(preferred: readonly (string | null | undefined)[]): Locale {
  for (const tag of preferred) {
    if (typeof tag !== 'string') continue
    const hit = matchTag(tag)
    if (hit !== null) return hit
  }
  return FALLBACK_LOCALE
}
