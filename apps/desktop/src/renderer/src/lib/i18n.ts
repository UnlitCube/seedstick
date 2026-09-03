import { createTranslator, type MsgKey } from '@autoinstall/shared'
import { useStore } from '../store.js'

/** 現在のロケールに応じた翻訳関数を返す。 */
export function useT(): (key: MsgKey) => string {
  const locale = useStore((s) => s.locale)
  return createTranslator(locale)
}

/** プリセット等の「ja/en 両方持つオブジェクト」から現在の言語を選ぶ。 */
export function useLocalized(): <T>(pair: { ja: T; en: T }) => T {
  const locale = useStore((s) => s.locale)
  return <T,>(pair: { ja: T; en: T }): T => (locale === 'ja' ? pair.ja : pair.en)
}
