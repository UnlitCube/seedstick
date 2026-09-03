import { describe, expect, it } from 'vitest'
import { createTranslator, en, ja, LOCALES, resolveLocale, type MsgKey } from './index.js'

describe('i18n', () => {
  it('ja と en のキーが完全に一致する', () => {
    // 型でも保証しているが、実行時にも確認しておく（satisfies を外した事故を検出する）
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort())
  })

  it('空の訳文が無い', () => {
    for (const locale of LOCALES) {
      const dict = locale === 'ja' ? ja : en
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim().length, `${locale}.${k} が空`).toBeGreaterThan(0)
      }
    }
  })

  it('英語の辞書に日本語が混入していない', () => {
    // 製品名など意図的な例外は無い想定
    for (const [k, v] of Object.entries(en)) {
      expect(/[ぁ-んァ-ヶ一-龠]/.test(v), `en.${k} に日本語が残っている: ${v}`).toBe(false)
    }
  })

  it('翻訳関数がロケールごとに正しい文字列を返す', () => {
    expect(createTranslator('ja')('common.next')).toBe('次へ')
    expect(createTranslator('en')('common.next')).toBe('Next')
  })

  it('未知のキーはキー名を返す（画面が空白にならない）', () => {
    expect(createTranslator('ja')('nope.not.a.key' as MsgKey)).toBe('nope.not.a.key')
  })

  it('OS ロケールから言語を決める', () => {
    expect(resolveLocale('ja-JP')).toBe('ja')
    expect(resolveLocale('ja')).toBe('ja')
    expect(resolveLocale('en-US')).toBe('en')
    expect(resolveLocale(undefined)).toBe('en')
    expect(resolveLocale('de-DE')).toBe('en')
  })

  it('危険な操作の文言に警告が含まれている', () => {
    // 誤操作でディスクを消す事故を防ぐため、確認文には必ず「消去」「erased」が入る
    expect(ja['write.confirmBody']).toMatch(/消去/)
    expect(en['write.confirmBody']).toMatch(/erased/i)
    expect(ja['storage.warning']).toMatch(/消去/)
  })
})
