import { describe, expect, it } from 'vitest'
import {
  createDefaultProfile,
  formatLocalized,
  ja,
  en,
  type AutoinstallProfile,
  type MsgKey,
} from '@autoinstall/shared'
import { summarizeStep } from './summary.js'

// ---------------------------------------------------------------------------
// **サイドバーの要約は「折りたたみの中」も見なければならない。**
//
// 「インストール後」の上級者向け設定はタブから折りたたみ（`Disclosure`）へ移った。
// 折りたたみは隠すための仕組みなので、隠れているものこそ要約に出さないと、
// 要約そのものが意味を失う。実際、`summarizePostInstall()` が
// `behavior` / `advanced` を見ていなかったため、
//
//   - 全画面で入力を待つ（＝**無人インストールでなくなる**）
//   - YAML で autoinstall の任意のセクションを上書きする
//   - カーネル引数を足す
//   - インストーラ本体を最新に差し替える
//
// のどれを立てても、サイドバーは「既定のまま（何もしない）」と表示していた。
// 折りたたみを閉じた状態では、画面のどこにも手がかりが無くなる。
//
// ここで固定するのは「既定のままにならない」ことだけで、**文面は固定しない**
// （落とし穴 56）。文言を変えただけでテストが落ちると、テストに合わせて
// 実装を戻す圧力になる。
// ---------------------------------------------------------------------------

const base = (): AutoinstallProfile => createDefaultProfile('24.04')

const rendered = (profile: AutoinstallProfile): { ja: string; en: string } => {
  const text = summarizeStep('postinstall', profile)
  if (text === null) throw new Error('postinstall の要約が null')
  return { ja: formatLocalized('ja', text), en: formatLocalized('en', text) }
}

/** 「既定のまま（…）」で包まれているか。文面ではなく**包み**を見る。 */
const DEFAULT_HEAD = { ja: ja['nav.summaryDefault'], en: en['nav.summaryDefault'] }
const isDefaultText = (s: { ja: string; en: string }): boolean =>
  (['ja', 'en'] as const).every((l) => s[l].startsWith(DEFAULT_HEAD[l].split('{detail}')[0]!))

/** 差し込み忘れ（`{name}` が残る）と、辞書に無いキー（`nav.` がそのまま出る）を弾く。 */
const looksTranslated = (s: string): boolean =>
  s.length > 0 && !/\{[A-Za-z]/.test(s) && !s.includes('nav.summary')

/** 「詳しい設定」に置かれている設定と、それが要約に出すキー。 */
const HIDDEN_SETTINGS: {
  name: string
  key: MsgKey
  apply: (p: AutoinstallProfile) => AutoinstallProfile
}[] = [
  {
    name: 'インストーラを最新に差し替える',
    key: 'nav.summaryRefreshInstaller',
    apply: (p) => ({ ...p, behavior: { ...p.behavior, refreshInstaller: true } }),
  },
  {
    name: '全画面で入力を待つ（無人インストールでなくなる）',
    key: 'nav.summaryInteractiveAll',
    apply: (p) => ({ ...p, behavior: { ...p.behavior, interactiveAll: true } }),
  },
  {
    name: 'YAML で上書きする',
    key: 'nav.summaryRawOverlay',
    apply: (p) => ({
      ...p,
      advanced: { ...p.advanced, rawOverlayYaml: 'storage:\n  layout:\n    name: direct\n' },
    }),
  },
  {
    name: 'カーネル引数を足す',
    key: 'nav.summaryExtraKernelArgs',
    apply: (p) => ({ ...p, advanced: { ...p.advanced, extraKernelArgs: 'nomodeset' } }),
  },
]

describe('summarizeStep("postinstall") — 「詳しい設定」の中身', () => {
  it('前提: 既定のプロファイルは「既定のまま」になる', () => {
    // これが最初から false だと、下のテストは何も検証していないことになる。
    expect(isDefaultText(rendered(base()))).toBe(true)
  })

  for (const { name, key, apply } of HIDDEN_SETTINGS) {
    it(`${name} を立てると「既定のまま」ではなくなる`, () => {
      const s = rendered(apply(base()))
      expect(isDefaultText(s), `折りたたみの中の設定が要約から抜けている: ${s.ja}`).toBe(false)
      // 何が変わったのかも分かること（「既定ではない」だけでは折りたたみを開くしかない）。
      expect(s.ja).toContain(ja[key])
      expect(s.en).toContain(en[key])
    })
  }

  it('ja / en のどちらでも訳せる（差し込み漏れも生キーも出ない）', () => {
    for (const { name, apply } of HIDDEN_SETTINGS) {
      const s = rendered(apply(base()))
      expect(looksTranslated(s.ja), `${name} ja: ${s.ja}`).toBe(true)
      expect(looksTranslated(s.en), `${name} en: ${s.en}`).toBe(true)
      expect(/[ぁ-んァ-ヶ一-龠]/.test(s.en), `${name} の en に日本語: ${s.en}`).toBe(false)
    }
  })

  it('4 つ全部立てても 1 行に収まり、差し込みが壊れない', () => {
    // `join()` は 4 枠を超えると「ほか N 件」に畳む。畳んだ側でも訳が壊れないこと。
    const all = HIDDEN_SETTINGS.reduce((p, s) => s.apply(p), base())
    const s = rendered(all)
    expect(isDefaultText(s)).toBe(false)
    expect(looksTranslated(s.ja), s.ja).toBe(true)
    expect(looksTranslated(s.en), s.en).toBe(true)
  })

  it('折りたたみの外の設定と一緒に立てても、両方が要約に出る', () => {
    // 片方だけ見て打ち切る実装（`if (parts.length) return` 等）を弾く。
    const p = HIDDEN_SETTINGS[1]!.apply(base())
    const s = rendered({
      ...p,
      postInstall: { ...p.postInstall, presets: ['sudo-nopasswd'] },
    })
    expect(s.ja).toContain(ja['nav.summaryInteractiveAll'])
    expect(s.ja).toContain(ja['nav.summaryPresets'].replace('{n}', '1'))
  })

  it('セクションごと欠けていても例外を投げず、既定のままとも言わない', () => {
    // 手で編集された JSON では `behavior` / `advanced` が丸ごと無いことがある。
    const gutted = { ...base(), behavior: undefined, advanced: undefined }
    expect(() => summarizeStep('postinstall', gutted as unknown as AutoinstallProfile)).not.toThrow()
  })
})
