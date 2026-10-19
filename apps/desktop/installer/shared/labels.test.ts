import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { DICTIONARIES, createTranslator, interpolate, type LabelKey } from './labels.js'
import { LOCALES } from './locales.js'

// ---------------------------------------------------------------------------
// この番人が見ているもの
// ---------------------------------------------------------------------------
//
// アプリ本体には `renderer/src` を走査する番人がある
// (`apps/desktop/src/renderer/src/lib/i18n.test.ts`) が、**インストーラは
// その走査範囲の外**にある（別の root、別の辞書）。
// 範囲を広げずに文言を足すと、英語表示で日本語が出る不具合が
// そのまま通る（落とし穴 78 の再発）。だからここに同じ検査を置く。
//
// 見ているもの:
//   1. ja と en のキーが完全一致すること（型でも守っているが、数も数える）
//   2. 同じキーの差し込み `{name}` の集合が ja と en で一致すること
//   3. **インストーラの renderer と main に、画面に出る日本語が無いこと**
//   4. `interpolate` が壊れた `params` でも投げないこと（落とし穴 30 / 76）
//
// 見ていないもの:
//   - 完全な字句解析。コメントの除去は近似で、取りこぼす側に倒してある
//     （本体の番人と同じ方針）。緑でも「日本語が 0 だ」とは断言できない。

const INSTALLER_DIR = join(import.meta.dirname, '..')

/** 日本語（かな・カナ・漢字・全角記号）。判定用と抽出用は別に持つ（落とし穴 63）。 */
const JAPANESE = /[　-〿぀-ヿ一-鿿＀-￯]/u

interface Allowed {
  /** `installer/` からの相対パス（区切りは `/`）。 */
  readonly file: string
  /** 許すのは**この文字列だけ**。ファイル丸ごとの除外はしない。 */
  readonly text: string
  readonly reason: string
}

/**
 * 意図的な例外。**1 件ずつ理由を書く。**
 * 使われていない例外は下のテストが落とす（実態と食い違ったまま残らないように）。
 */
const ALLOWLIST: readonly Allowed[] = []

/** 走査する対象。`shared/labels.ts` は辞書そのものなので当然除く。 */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      if (/\.test\.tsx?$/.test(entry.name)) continue
      const rel = relative(INSTALLER_DIR, p).split(sep).join('/')
      if (rel === 'shared/labels.ts') continue
      out.push(rel)
    }
  }
  walk(INSTALLER_DIR)
  return out.sort()
}

/**
 * コメントを空白に潰す（行数は保つ）。
 *
 * 近似は本体の番人と同じ 3 つ:
 *   (a) 正規表現リテラルを解釈しない（素の `//` を含む正規表現があれば取りこぼす）
 *   (b) `'` / `"` の状態は行末で必ず閉じる（`don't` で以降を読み飛ばさないため）
 *   (c) テンプレートリテラルの `${ … }` を「コード」に戻さない
 */
function stripComments(source: string): string[] {
  const out: string[] = []
  let inBlock = false
  let backtick = false
  for (const raw of source.split('\n')) {
    let kept = ''
    let quote: "'" | '"' | null = null
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i] ?? ''
      const next = raw[i + 1] ?? ''
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false
          i++
        }
        kept += ' '
        continue
      }
      if (quote === null && !backtick) {
        if (c === '/' && next === '*') {
          inBlock = true
          i++
          kept += '  '
          continue
        }
        if (c === '/' && next === '/' && raw[i - 1] !== '\\') break
      }
      if (c === '`' && quote === null) backtick = !backtick
      else if (!backtick && (c === "'" || c === '"')) {
        if (quote === null) quote = c
        else if (quote === c) quote = null
      }
      kept += c
    }
    out.push(kept)
  }
  return out
}

// ---------------------------------------------------------------------------

describe('インストーラの辞書', () => {
  it('どの言語の辞書も ja とキーが完全に一致する', () => {
    const ja = Object.keys(DICTIONARIES.ja).sort()
    expect(ja.length).toBeGreaterThan(50)
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort(), locale).toEqual(ja)
    }
  })

  it('同じキーの差し込み名の集合が、どの言語でも ja と一致する', () => {
    const names = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort()
    const mismatched: string[] = []
    for (const locale of LOCALES) {
      for (const key of Object.keys(DICTIONARIES.ja) as LabelKey[]) {
        const a = names(DICTIONARIES.ja[key])
        const b = names(DICTIONARIES[locale][key])
        if (a.join(',') !== b.join(',')) {
          mismatched.push(`${locale} ${key}: ja=[${a.join(',')}] ${locale}=[${b.join(',')}]`)
        }
      }
    }
    expect(mismatched).toEqual([])
  })

  it('どの言語でも空の訳文が無い', () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(DICTIONARIES[locale])) {
        expect(text.trim(), `${locale}/${key}`).not.toBe('')
      }
    }
  })

  it('ja 以外に日本語（かな）が混ざっていない（写し忘れの検出）', () => {
    // 中国語は漢字を使うので、かなで見る。
    const leaked: string[] = []
    for (const locale of LOCALES.filter((l) => l !== 'ja')) {
      for (const [key, text] of Object.entries(DICTIONARIES[locale])) {
        if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) leaked.push(`${locale}/${key}`)
      }
    }
    expect(leaked).toEqual([])
  })
})

describe('interpolate', () => {
  it('差し込みを置き換える', () => {
    expect(interpolate('必要な容量 {size}', { size: '190 MB' })).toBe('必要な容量 190 MB')
  })

  it('壊れた params でも投げない（落とし穴 30 / 76）', () => {
    // **プレースホルダを持つ実在のキー**で試す。持たないキーだと
    // 置換のコールバックが一度も呼ばれず、何を渡しても通ってしまう。
    const withPlaceholder = DICTIONARIES.ja['options.need']
    expect(withPlaceholder).toContain('{size}')
    for (const bad of [null, undefined, 0, 'x', []] as unknown[]) {
      expect(() =>
        interpolate(withPlaceholder, bad as Record<string, string>),
      ).not.toThrow()
    }
    // 値が無いプレースホルダは**そのまま残す**（空文字にして黙って消さない）。
    expect(interpolate(withPlaceholder, {})).toContain('{size}')
  })

  it('知らないキーはキー名をそのまま返す（投げない）', () => {
    const t = createTranslator('ja')
    expect(t('does.not.exist' as LabelKey)).toBe('does.not.exist')
  })
})

describe('インストーラのソースに画面用の日本語が直書きされていない', () => {
  const files = sourceFiles()

  it('走査対象を見つけている', () => {
    // 走査が空になると「緑だが何も見ていない」になる（落とし穴 76）。
    expect(files.length).toBeGreaterThan(15)
    expect(files).toContain('renderer/src/App.tsx')
    expect(files).toContain('main/install.ts')
  })

  it('日本語のリテラルが残っていない', () => {
    const hits: string[] = []
    for (const file of files) {
      const source = readFileSync(join(INSTALLER_DIR, file), 'utf8')
      stripComments(source).forEach((line, i) => {
        if (!JAPANESE.test(line)) return
        const allowed = ALLOWLIST.some(
          (a) => a.file === file && line.includes(a.text),
        )
        if (!allowed) hits.push(`installer/${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(
      hits,
      hits.length === 0
        ? ''
        : `画面に出うる日本語が ${hits.length} 件あります。` +
            '辞書 (installer/shared/labels.ts) のキーで運んでください。\n' +
            hits.join('\n'),
    ).toEqual([])
  })

  it('例外表は実際に踏まれているものだけを載せる', () => {
    const unused = ALLOWLIST.filter((a) => {
      const source = readFileSync(join(INSTALLER_DIR, a.file), 'utf8')
      return !stripComments(source).some((line) => line.includes(a.text))
    })
    expect(unused.map((a) => `${a.file}: ${a.text}`)).toEqual([])
  })
})
