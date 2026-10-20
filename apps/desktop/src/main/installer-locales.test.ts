import { describe, expect, it } from 'vitest'
import { DICTIONARIES, LOCALE_META, LOCALES, negotiateLocale, type Locale } from '@autoinstall/shared'
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

  it('言語の選択肢に出す名前が同じ', () => {
    for (const l of LOCALES) {
      expect(INSTALLER_LOCALES[l as keyof typeof INSTALLER_LOCALES]?.endonym, l).toBe(LOCALE_META[l].endonym)
    }
  })

  it('インストーラの辞書が全言語ぶんある', () => {
    expect(Object.keys(INSTALLER_DICTIONARIES).sort()).toEqual([...LOCALES].sort())
  })

  // 実験的な製品であることの説明は、アプリ（About とサイト）とインストーラの 2 つの辞書にある。
  // 核心は「無人インストールは**仮想マシンでしか**確かめていない」なので、訳を直したときに
  // そこが落ちたら止める（「消去」を見る SAFETY_TERMS と同じ考え方。言語を足すと型エラーになる）。
  const VIRTUAL_MACHINE = {
    ja: /仮想マシン/,
    en: /virtual machine/i,
    'zh-Hans': /虚拟机/,
    'zh-Hant': /虛擬機/,
    ko: /가상 머신/,
    es: /máquinas? virtual/i,
    fr: /machines? virtuelle/i,
    de: /virtuell\S* Maschine/i,
    'pt-BR': /máquinas? virtua/i,
  } satisfies Record<Locale, RegExp>

  it('実験的であることの説明が、どの言語でも「仮想マシンでしか確かめていない」を保っている', () => {
    for (const l of LOCALES) {
      const app = DICTIONARIES[l]
      const inst = INSTALLER_DICTIONARIES[l as keyof typeof INSTALLER_DICTIONARIES]
      expect(app['about.experimental'], `${l} about.experimental`).toMatch(VIRTUAL_MACHINE[l])
      expect(inst['welcome.experimentalNote'], `${l} welcome.experimentalNote`).toMatch(VIRTUAL_MACHINE[l])
      // 札は 1 語か短い句。長くなるとヘッダーとようこそ画面で折り返す
      expect(app['app.experimental'].length, `${l} app.experimental`).toBeLessThanOrEqual(14)
      expect(inst['welcome.experimental'], `${l} welcome.experimental`).toBe(app['app.experimental'])
    }
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
