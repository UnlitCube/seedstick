import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './defaults.js'
import { GenerateError, buildAutoinstallObject, parseOverlay } from './generate.js'
import { generateErrorIssue, validateProfile } from './validate.js'
import { formatLocalized, localized } from '../i18n/index.js'
import type { AutoinstallProfile, ValidationIssue } from '../index.js'

// 5 巡目の監査で出た「英文の中に日本語が連結されて出る」の回帰テスト。
//
//     Failed to generate YAML: 上書き YAML の構文エラー: ...
//
// `generate.ts` の例外メッセージ（開発者向けの日本語の診断）を、そのまま
// `messageEn` に連結していたのが原因。English を選んでいる利用者には
// 半分日本語の行だけが見えていた。
//
// ソースを ASCII に保つため、判定は \u エスケープで書く（落とし穴 44）。
const HIRAGANA_KATAKANA_KANJI = /[\u3041-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/
// en の辞書検査と同じ範囲。かな漢字を消しても全角の括弧・句読点は残りやすい。
const FULLWIDTH_PUNCTUATION = /[\u3000-\u303F\uFF00-\uFFEF]/

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

function base(): AutoinstallProfile {
  const p = createDefaultProfile('24.04')
  return {
    ...p,
    basics: { ...p.basics, hostname: 'h1' },
    user: { ...p.user, username: 'opsuser', passwordHash: HASH },
  }
}

function withOverlay(yaml: string): AutoinstallProfile {
  const p = base()
  return { ...p, advanced: { ...p.advanced, rawOverlayYaml: yaml } }
}

function expectNoJapanese(text: string, what: string): void {
  expect(HIRAGANA_KATAKANA_KANJI.test(text), `${what} に日本語が残っている: ${text}`).toBe(false)
  expect(FULLWIDTH_PUNCTUATION.test(text), `${what} に全角の約物が残っている: ${text}`).toBe(false)
}

/** 上書き YAML についての指摘だけを取り出す。 */
function overlayIssues(p: AutoinstallProfile): ValidationIssue[] {
  return validateProfile(p)
    .issues.filter((i) => i.severity === 'error')
    .filter((i) => i.field === 'advanced.rawOverlayYaml' || i.field === 'generate')
}

// 構文エラー / マッピングでない、の 2 通り。どちらも parseOverlay が投げる。
const BROKEN = ['a:\n  - b\n c: [', '{{{', 'a: [1, 2']
const NOT_A_MAPPING = ['- 1\n- 2', 'plain string', '42']

describe('上書き YAML のエラーは英文に日本語を混ぜない', () => {
  it('構文エラーの messageEn に日本語が 1 文字も無い', () => {
    for (const yaml of BROKEN) {
      const issues = overlayIssues(withOverlay(yaml))
      expect(issues.length, `指摘が出ていない: ${yaml}`).toBeGreaterThan(0)
      for (const i of issues) expectNoJapanese(i.messageEn, `messageEn (${yaml})`)
    }
  })

  it('マッピングでない上書きの messageEn に日本語が 1 文字も無い', () => {
    for (const yaml of NOT_A_MAPPING) {
      const issues = overlayIssues(withOverlay(yaml))
      expect(issues.length, `指摘が出ていない: ${yaml}`).toBeGreaterThan(0)
      for (const i of issues) expectNoJapanese(i.messageEn, `messageEn (${yaml})`)
    }
  })

  it('messageJa と messageEn が同じ情報を伝える', () => {
    for (const yaml of [...BROKEN, ...NOT_A_MAPPING]) {
      const issues = overlayIssues(withOverlay(yaml))
      for (const i of issues) {
        // 日本語の方は日本語であること（英文をそのまま流用していない）
        expect(HIRAGANA_KATAKANA_KANJI.test(i.messageJa), `messageJa が日本語でない: ${i.messageJa}`).toBe(true)
        // 中身が違うこと（同じ文字列なら片方が訳されていない）
        expect(i.messageEn).not.toBe(i.messageJa)
      }
    }
  })

  it('YAML パーサの原文（英語）は両方の言語に載る', () => {
    // 差し込み値だけは原文のまま両方に出す。これは「連結」ではなく params。
    const yaml = 'a:\n  - b\n c: ['
    let detail = ''
    try {
      parseOverlay(yaml)
    } catch (err) {
      detail = err instanceof GenerateError ? (err.text.params?.detail as string) : ''
    }
    expect(detail.length).toBeGreaterThan(0)
    expectNoJapanese(detail, 'YAML パーサの原文')

    const issues = overlayIssues(withOverlay(yaml))
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(i.messageJa).toContain(detail)
      expect(i.messageEn).toContain(detail)
    }
  })

  it('同じ例外を 2 件に増やさない（検証と生成の両方で見ている）', () => {
    for (const yaml of [...BROKEN, ...NOT_A_MAPPING]) {
      expect(overlayIssues(withOverlay(yaml)), `重複している: ${yaml}`).toHaveLength(1)
    }
  })

  it('どの設定項目のせいかが分かる（generate に潰さない）', () => {
    for (const yaml of [...BROKEN, ...NOT_A_MAPPING]) {
      expect(overlayIssues(withOverlay(yaml))[0]!.field).toBe('advanced.rawOverlayYaml')
    }
  })
})

describe('generateErrorIssue', () => {
  it('GenerateError は両方の言語をキーから引く', () => {
    const err = new GenerateError('日本語の診断', localized('generate.overlayNotMapping'), 'advanced.rawOverlayYaml')
    const issue = generateErrorIssue(err)
    expect(issue.messageJa).toBe(formatLocalized('ja', err.text))
    expect(issue.messageEn).toBe(formatLocalized('en', err.text))
    // 開発者向けの日本語（`Error.message`）は画面の文言に混ぜない
    expect(issue.messageJa).not.toContain('日本語の診断')
    expect(issue.messageEn).not.toContain('日本語の診断')
    expect(issue.detail).toBeUndefined()
    expectNoJapanese(issue.messageEn, 'messageEn')
  })

  it('訳せない例外は総括を訳し、生の診断は detail に分ける', () => {
    const issue = generateErrorIssue(new TypeError('e.trim is not a function'))
    expect(issue.field).toBe('generate')
    expect(issue.messageJa).toBe(formatLocalized('ja', localized('generate.failed')))
    expect(issue.messageEn).toBe(formatLocalized('en', localized('generate.failed')))
    expectNoJapanese(issue.messageEn, 'messageEn')
    expect(issue.detail).toBe('e.trim is not a function')
  })

  it('Error でない値でも落ちない', () => {
    const issue = generateErrorIssue('文字列が投げられた')
    expect(issue.detail).toBe('文字列が投げられた')
    expectNoJapanese(issue.messageEn, 'messageEn')
  })
})

describe('検証と生成が同じ上書き YAML の実装を通る', () => {
  it('コメントだけの上書きは「上書き無し」として通る', () => {
    // 以前は validate が null を許し、parseOverlay が投げていたため、
    // 「検証は問題なし」なのに生成だけが落ちていた。
    const p = withOverlay('# nothing here\n')
    expect(overlayIssues(p)).toHaveLength(0)
    expect(() => buildAutoinstallObject(p)).not.toThrow()
    expect(parseOverlay('# nothing here\n')).toBeUndefined()
  })

  it('正しい上書きはそのままマージされる', () => {
    const p = withOverlay('late-commands:\n  - echo hi\n')
    expect(overlayIssues(p)).toHaveLength(0)
    expect(buildAutoinstallObject(p)['late-commands']).toEqual(['echo hi'])
  })
})
