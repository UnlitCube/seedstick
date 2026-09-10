// 表示言語。main から 1 回もらってコンテキストに置くだけ。
//
// アプリ本体は切り替えボタンを持つが、インストーラは数十秒で終わるので
// **OS の言語に従うだけ**にしている（切り替えの UI を足すと、
// その状態をどこに保存するかという問題が付いてくる）。

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
