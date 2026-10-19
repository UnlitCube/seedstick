import { describe, expect, it } from 'vitest'
import { LOCALE_META, LOCALES, negotiateLocale } from '@autoinstall/shared'
import {
  INSTALLER_LOCALES,
  LOCALES as INSTALLER_LOCALE_LIST,
  negotiateLocale as negotiateInstallerLocale,
} from '../../installer/shared/locales.js'
import { DICTIONARIES as INSTALLER_DICTIONARIES } from '../../installer/shared/labels.js'

// インストーラはアプリ本体のコードを読み込まない規約なので、言語の表と選び方を
// 自分で持っている（installer/shared/locales.ts）。**写しは契約が動いたときに取り残される**
// （落とし穴 74）ので、両方を import できるここで食い違いを落とす。

describe('インストーラとアプリ本体の言語', () => {
  it('同じ言語の集合を同じ順に持つ', () => {
    expect([...INSTALLER_LOCALE_LIST]).toEqual([...LOCALES])
  })

  it('html の lang が同じ', () => {
    for (const l of LOCALES) {
      expect(INSTALLER_LOCALES[l as keyof typeof INSTALLER_LOCALES]?.htmlLang, l).toBe(LOCALE_META[l].htmlLang)
    }
  })

  it('インストーラの辞書が全言語ぶんある', () => {
    expect(Object.keys(INSTALLER_DICTIONARIES).sort()).toEqual([...LOCALES].sort())
  })

  it('OS の言語の並びから同じ言語を選ぶ', () => {
    const samples: string[][] = [
      ['ja-JP'],
      ['en-US'],
      ['en-GB'],
      ['de-DE'],
      ['de-AT', 'ja'],
      ['fr-CA'],
      ['es-MX'],
      ['pt-PT'],
      ['pt-BR'],
      ['zh-CN'],
      ['zh-TW'],
      ['zh-HK'],
      ['zh-Hant-TW'],
      ['zh'],
      ['ko-KR'],
      ['it-IT', 'ko'],
      ['it-IT'],
      [],
      ['ja_JP'],
      [''],
    ]
    for (const s of samples) {
      expect(negotiateInstallerLocale(s), JSON.stringify(s)).toBe(negotiateLocale(s))
    }
  })
})
