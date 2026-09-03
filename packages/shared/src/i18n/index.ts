import { ja, type MsgKey } from './ja.js'
import { en } from './en.js'

export type Locale = 'ja' | 'en'
export type { MsgKey }
export { ja, en }

export const LOCALES: readonly Locale[] = ['ja', 'en']

const DICTS: Record<Locale, Record<MsgKey, string>> = { ja, en }

/** 翻訳関数を作る。未知のキーはキー名をそのまま返す（画面が空白になるより気づきやすい）。 */
export function createTranslator(locale: Locale): (key: MsgKey) => string {
  const dict = DICTS[locale] ?? ja
  return (key: MsgKey) => dict[key] ?? ja[key] ?? key
}

/** OS のロケール文字列（`ja-JP` 等）から対応言語を選ぶ。 */
export function resolveLocale(systemLocale: string | undefined): Locale {
  return (systemLocale ?? '').toLowerCase().startsWith('ja') ? 'ja' : 'en'
}
