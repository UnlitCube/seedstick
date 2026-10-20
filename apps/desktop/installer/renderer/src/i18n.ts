// 表示言語。最初は main が OS の言語から選び、タイトルバーの選択欄で切り替えられる。
//
// 切り替えは**その起動の間だけ**で、どこにも保存しない。インストーラは数十秒で終わり、
// 入れたアプリは自分で OS の言語から選び直す（アプリ側の設定は書き換えない）。

import { createContext, useContext } from 'react'
import { createTranslator, type Locale, type Translator } from '../../shared/labels.js'

export const LocaleContext = createContext<Locale>('ja')

export function useT(): Translator {
  const locale = useContext(LocaleContext)
  // 訳す関数は辞書を引くだけなので、描画のたびに作ってよい。
  return createTranslator(locale)
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}
