// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement, act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, type Locale, type MsgKey } from '@autoinstall/shared'
import { useT, useTx } from './i18n.js'
import { useStore } from '../store.js'

// ---------------------------------------------------------------------------
// 1. renderer のソースに、画面に出る日本語リテラルが残っていないこと
// ---------------------------------------------------------------------------
//
// 新しい画面を足すときは日本語を直書きするのが一番速いので、この規約は
// 放っておくと必ず退行する（HANDOFF.md 2.3 の「入力欄の修正が 5 か所で止まり
// 8 か所残っていた」はまさにそれ）。人の目で数えるのをやめ、機械に数えさせる。
//
// **この検査がどこまで見ているか（正直な範囲）**
//
//   見ている  : `/* … */`（複数行にまたがるものを含む）と `//` 以降を落としたあとに
//               残った日本語。JSX のテキスト・属性値・文字列リテラル・識別子は
//               すべて「コード」として扱う（＝画面に出うるものとして報告する）。
//   見ていない: 完全な字句解析。具体的には次の 3 つの近似が入っている。
//     (a) 正規表現リテラルを解釈しない。`/…\/\/…/` のように **エスケープされた**
//         スラッシュは「直前が `\` なら行コメントの開始と見なさない」規則で
//         救っているが、素の `//` を含む正規表現があれば、そこから行末までを
//         コメントとして落とす（＝**取りこぼし**が出る。誤検出ではない）。
//         現在のソースにそのような正規表現は無い。
//     (b) `'` / `"` の状態は行末で必ず閉じる。JSX 本文の `don't` のような
//         アポストロフィで文字列状態に入ったまま以降のファイル全体を
//         読み飛ばす事故を避けるため。バッククォートだけは行をまたいで持ち越す
//         （テンプレートリテラルは複数行に書けるため）。
//     (c) テンプレートリテラル内の `${ … }` を「コード」に戻さない。
//         `` `${cond ? '日本語' : 'x'}` `` は文字列の中として扱われるが、
//         いずれにせよ日本語は検出されるので、この検査の目的には影響しない。
//
// 取りこぼし側に倒しているので、**この検査が緑でも「日本語が 0 だ」と断言はできない**。
// できるのは「直書きが増えたら気づける」ところまで。

/** 日本語（かな・カナ・漢字・全角記号）を含むか。 */
const JAPANESE = /[　-〿぀-ヿ一-鿿＀-￯]/u
/** 連続する日本語のかたまり（許可リストとの突き合わせに使う）。判定用と別に持つ（落とし穴 63）。 */
const JAPANESE_RUN = /[　-〿぀-ヿ一-鿿＀-￯]+/gu

interface Allowed {
  /** `renderer/src/` からの相対パス。 */
  readonly file: string
  /** 許可する日本語そのもの。ファイル単位ではなく**この文字列だけ**を許す。 */
  readonly text: string
  readonly reason: string
}

/**
 * 意図的な例外。1 件ずつ理由を書く。ファイル丸ごとの除外はしない
 * （同じファイルに新しい直書きが増えたら、それは検出したい）。
 *
 * ここに **無い** ものについて:
 *   - `lib/format.ts` の `formatEta`: 以前は ja 分岐に日本語があったが、いまは
 *     `t('format.etaMinutesSeconds')` を呼ぶだけで日本語を持たない。例外は不要。
 *   - `lib/i18n.ts` 自身: 日本語はコメントだけで、リテラルは持たない。例外は不要。
 *   どちらも「例外として書いておく」と、実態と食い違ったまま残るので入れていない
 *   （未使用の例外は下のテストで落ちる）。
 */
const ALLOWLIST: readonly Allowed[] = [
  {
    file: 'App.tsx',
    text: '日本語',
    reason:
      '言語切り替えボタンのラベル。切り替え先の言語は「その言語自身の表記」で出すのが正しく、' +
      '訳文にすると英語表示のときに「Japanese」になって切り替え先が分かりにくくなる。',
  },
  {
    file: 'components/ErrorBoundary.tsx',
    text: '画面の描画に失敗しました',
    reason:
      '画面には出ない。DevTools のコンソールにだけ出す開発者向けのログで、' +
      '利用者に見せる文言は t(\'boundary.*\') 側にある。',
  },
]

/**
 * renderer のソースを raw で読む。`node:fs` を使わないのは、renderer の tsconfig に
 * Node の型を入れないという規約（CLAUDE.md）を、テストでも破らないため。
 * `*.test.ts` / `*.test.tsx` は除く（テストの説明文は日本語でよい）。
 */
const SOURCES = import.meta.glob(
  ['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as unknown as Record<string, string>

/** このテストファイルが置かれているディレクトリ（`renderer/src/` からの相対）。 */
const TEST_DIR = 'lib'

/**
 * `import.meta.glob` のキーを `renderer/src/` からの相対パスに直す。
 *
 * キーは**このテストファイルからの相対パス**なので、`../App.tsx` だけでなく
 * `./format.ts`（＝このファイルと同じ `lib/` の中）も返る。`../` を剥がすだけだと
 * 後者が `./format.ts` のまま残り、`ALLOWLIST` の `file` との完全一致が
 * 永久に成立しない。`.` / `..` をきちんと畳む。
 */
function normalizeKey(key: string): string {
  const out: string[] = []
  for (const segment of [...TEST_DIR.split('/'), ...key.split('/')]) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

/** コメントを空白に潰した行の配列を返す（行番号を保つため行数は変えない）。 */
function stripComments(source: string): string[] {
  const out: string[] = []
  let inBlock = false
  let quote: "'" | '"' | '`' | null = null
  for (const raw of source.split('\n')) {
    let kept = ''
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!
      const next = raw[i + 1]
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false
          i++
        }
        continue
      }
      if (quote !== null) {
        kept += c
        if (c === '\\') {
          kept += next ?? ''
          i++
          continue
        }
        if (c === quote) quote = null
        continue
      }
      if (c === '/' && next === '*') {
        inBlock = true
        i++
        continue
      }
      // 直前が `\` なら正規表現内のエスケープされたスラッシュ（`\/\/`）とみなす。
      if (c === '/' && next === '/' && raw[i - 1] !== '\\') break
      if (c === "'" || c === '"' || c === '`') {
        quote = c
        kept += c
        continue
      }
      kept += c
    }
    // 行をまたげるのはテンプレートリテラルだけ。'/" は必ず閉じる（上の (b)）。
    if (quote === "'" || quote === '"') quote = null
    out.push(kept)
  }
  return out
}

interface Finding {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly source: string
}

function scanForJapanese(): Finding[] {
  const findings: Finding[] = []
  for (const [key, source] of Object.entries(SOURCES)) {
    const file = normalizeKey(key)
    stripComments(source).forEach((line, i) => {
      if (!JAPANESE.test(line)) return
      for (const run of line.match(JAPANESE_RUN) ?? []) {
        findings.push({ file, line: i + 1, text: run, source: line.trim() })
      }
    })
  }
  return findings
}

const isAllowed = (f: Finding): boolean =>
  ALLOWLIST.some((a) => a.file === f.file && a.text === f.text)

describe('renderer の日本語直書き', () => {
  it('走査対象を実際に読めている（glob が空だと何も検証しないので確認する）', () => {
    const files = Object.keys(SOURCES).map(normalizeKey)
    expect(files.length).toBeGreaterThan(15)
    expect(files).toContain('App.tsx')
    expect(files).toContain('views/WriteStep.tsx')
    // このテストと同じディレクトリのファイルも `lib/` 付きで並ぶ（下の正規化の it を参照）
    expect(files).toContain('lib/format.ts')
    expect(files).toContain('lib/i18n.ts')
    // `.` / `..` が残っていない（残ると ALLOWLIST の突き合わせが永久に一致しない）
    expect(files.filter((f) => f.startsWith('.'))).toEqual([])
    // テストは除外されている（除外が効かないと、日本語だらけのテストで常に落ちる）
    expect(files.filter((f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx'))).toEqual([])
  })

  it('glob のキーを renderer/src からの相対パスに正規化する', () => {
    // `import.meta.glob` のキーは**このテストファイルからの相対パス**。
    // `../**` は「親から下」なので大半は `../` で始まるが、**このファイルと同じ
    // ディレクトリのもの**だけは `./format.ts` に畳まれて返る。
    // `replace(/^\.\.\//, '')` だけだと `lib/` の 2 ファイルが `./format.ts` のまま残り、
    // ALLOWLIST の `file` 完全一致が永久に成立しない（例外を書いても効かず、気づけない）。
    expect(normalizeKey('../App.tsx')).toBe('App.tsx')
    expect(normalizeKey('../views/sections/Gpu.tsx')).toBe('views/sections/Gpu.tsx')
    expect(normalizeKey('./format.ts')).toBe('lib/format.ts')
    expect(normalizeKey('./i18n.ts')).toBe('lib/i18n.ts')
  })

  it('ALLOWLIST の file が実在する走査対象を指している', () => {
    // 綴りを間違えた例外は「効かない例外」になる。上の「死んだ例外」の it でも
    // 落ちるが、そちらは「直したから消せ」というメッセージになるので、
    // 「そんなファイルは無い」を別に言う。
    const files = new Set(Object.keys(SOURCES).map(normalizeKey))
    const missing = ALLOWLIST.filter((a) => !files.has(a.file)).map((a) => a.file)
    expect(
      missing,
      '走査対象に無いファイルを指した例外は、書いても効きません（パスの綴りを確認）',
    ).toEqual([])
  })

  it('画面に出る日本語リテラルが残っていない（例外は ALLOWLIST に理由つきで）', () => {
    const remaining = scanForJapanese().filter((f) => !isAllowed(f))
    const report = remaining
      .map(
        (f) =>
          `  apps/desktop/src/renderer/src/${f.file}:${f.line}\n` +
          `    日本語: ${f.text}\n` +
          `    該当行: ${f.source}`,
      )
      .join('\n')
    expect(
      remaining.length,
      remaining.length === 0
        ? ''
        : `renderer に日本語の直書きが ${remaining.length} 件あります。\n` +
            `ja.ts / en.ts にキーを足して t() / tx() から引いてください。\n` +
            `意図的な例外なら i18n.test.ts の ALLOWLIST に理由つきで足してください。\n${report}`,
    ).toBe(0)
  })

  it('ALLOWLIST に死んだ例外が残っていない', () => {
    const findings = scanForJapanese()
    const unused = ALLOWLIST.filter(
      (a) => !findings.some((f) => f.file === a.file && f.text === a.text),
    )
    expect(
      unused.map((a) => `${a.file}: ${a.text}`),
      '直したのに例外だけ残ると、次の直書きをそのまま通してしまいます',
    ).toEqual([])
  })

  it('コメントは検出しない（この検査が「コメント禁止」になっていないこと）', () => {
    // 行頭 `//`・行末の `//`・`/* */`・JSDoc の `*` 継続行・
    // 文字列の中の `https://`（コメントと誤判定してはいけない）を 1 つずつ。
    const sample = [
      '// 行頭のコメント',
      'const a = 1 // 行末のコメント',
      '/* ブロック */',
      '/**',
      ' * JSDoc の継続行',
      ' */',
      "const url = 'https://example.com/' // 説明",
      'const b = `テンプレート`',
    ].join('\n')
    const lines = stripComments(sample)
    expect(lines.filter((l) => JAPANESE.test(l))).toEqual(['const b = `テンプレート`'])
  })
})

// ---------------------------------------------------------------------------
// 2. useTx の振る舞い
// ---------------------------------------------------------------------------

/**
 * 差し込み位置に要素を入れる `tx()` を 1 回だけ描画して、DOM を返す。
 * React の state を直接いじらず、本物の描画を通す。
 */
function renderTx(
  key: MsgKey,
  nodes: Readonly<Record<string, ReactNode>>,
  locale: Locale = 'ja',
): HTMLElement {
  useStore.setState({ locale })
  const host = document.createElement('div')
  const root = createRoot(host)
  function Probe(): React.JSX.Element {
    const tx = useTx()
    return tx(key, nodes)
  }
  act(() => root.render(createElement(Probe)))
  return host
}

/**
 * 任意の文面で振る舞いを確かめるための逃げ道。
 * `createTranslator` は**未知のキーをそのまま返す**ので、キーの位置に文面を書けば
 * 訳文として扱える。辞書に無い形（同じ差し込み名が 2 回出る等）を試すのに使う。
 * この前提が崩れたらここで落ちるよう、下の it で先に確かめている。
 */
const asTemplate = (template: string): MsgKey => template as MsgKey

describe('useTx', () => {
  it('未知のキーはそのまま返る（下のテストが使っている前提）', () => {
    expect(createTranslator('ja')(asTemplate('{a} と {a}'))).toBe('{a} と {a}')
  })

  it('差し込み位置に React 要素が入る', () => {
    // ja: '再起動後、{user} でログインできます。'
    const host = renderTx('write.next5Login', {
      user: createElement('code', null, 'ubuntu'),
    })
    const code = host.querySelector('code')
    expect(code).not.toBeNull()
    expect(code!.textContent).toBe('ubuntu')
    // 訳文の前後がそのまま残り、差し込みはその間にある
    const text = host.textContent ?? ''
    const whole = createTranslator('ja')('write.next5Login')
    const [before, after] = whole.split('{user}')
    expect(text).toBe(`${before}ubuntu${after}`)
  })

  it('差し込み値を渡し忘れると {name} がそのまま出る（消えない）', () => {
    const host = renderTx('write.next5Login', {})
    expect(host.textContent).toContain('{user}')
    expect(host.textContent).toBe(createTranslator('ja')('write.next5Login'))
  })

  it('差し込みが 1 つも無いキーでも文字列がそのまま出る', () => {
    const host = renderTx('boundary.title', {})
    const expected = createTranslator('ja')('boundary.title')
    expect(expected).not.toContain('{')
    expect(host.textContent).toBe(expected)
  })

  it('同じ差し込み名が 2 回出てきたら 2 回とも置き換わる', () => {
    const host = renderTx(asTemplate('{a} と {a}'), {
      a: createElement('b', null, 'X'),
    })
    expect(host.querySelectorAll('b')).toHaveLength(2)
    expect(host.textContent).toBe('X と X')
  })

  it('利用者の入力に {other} が含まれていても再展開されない', () => {
    // ja: 'Ubuntu {series} ({codename}) の標準サポートは {eol} に終了しました。'
    // 利用者が打った文字列が別の差し込みを引き出せてはいけない。
    const host = renderTx('iso.eolDetail', {
      series: '{eol}',
      codename: '{series}',
      eol: 'SECRET',
    })
    const text = host.textContent ?? ''
    expect(text).toContain('Ubuntu {eol} ({series})')
    // 'SECRET' は本来の {eol} の 1 か所にだけ出る
    expect(text.match(/SECRET/g)).toHaveLength(1)
  })

  it('ロケールを切り替えると訳文が変わる（store を購読している）', () => {
    const ja = renderTx('boundary.title', {}, 'ja').textContent
    const en = renderTx('boundary.title', {}, 'en').textContent
    expect(ja).toBe(createTranslator('ja')('boundary.title'))
    expect(en).toBe(createTranslator('en')('boundary.title'))
    expect(ja).not.toBe(en)
  })
})

describe('useT', () => {
  it('差し込み値を渡し忘れるとプレースホルダが残る（useTx と同じ性質）', () => {
    useStore.setState({ locale: 'ja' })
    const host = document.createElement('div')
    const root = createRoot(host)
    let t: ((key: MsgKey, params?: Readonly<Record<string, string | number>>) => string) | null =
      null
    function Probe(): null {
      t = useT()
      return null
    }
    act(() => root.render(createElement(Probe)))
    expect(t!('write.next5Login')).toContain('{user}')
    expect(t!('write.next5Login', { user: '{eol}' })).toContain('{eol}')
    // 入力に含まれる {…} は再展開されない
    expect(t!('iso.eolDetail', { series: '{eol}', codename: 'x', eol: 'SECRET' })).toContain(
      'Ubuntu {eol}',
    )
  })
})
