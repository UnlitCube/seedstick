// インストーラの表示言語の表。
//
// **アプリ本体（packages/shared/src/i18n/locales.ts）と同じ集合・同じ選び方**でなければならない
// （アプリを英語で使っている人のインストーラだけが日本語、を起こさない）。
// ただしインストーラはアプリのコードを 1 行も読み込まない規約なので、表と選び方を
// ここに写して持つ。写しが本体とずれていないことは
// apps/desktop/src/main/installer-locales.test.ts（両方を import できる場所）が見る。

export const INSTALLER_LOCALES = {
  ja: { htmlLang: 'ja' },
  en: { htmlLang: 'en' },
} as const

export type Locale = keyof typeof INSTALLER_LOCALES

export const LOCALES: readonly Locale[] = Object.keys(INSTALLER_LOCALES) as Locale[]

export const FALLBACK_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INSTALLER_LOCALES, value)
}

function asLocale(id: string): Locale | null {
  return isLocale(id) ? id : null
}

/** 本体の `matchTag` と同じ規則（中国語は文字体系で分け、pt は pt-BR に寄せ、他は第 1 サブタグ）。 */
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

export function negotiateLocale(preferred: readonly (string | null | undefined)[]): Locale {
  for (const tag of preferred) {
    if (typeof tag !== 'string') continue
    const hit = matchTag(tag)
    if (hit !== null) return hit
  }
  return FALLBACK_LOCALE
}
