// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useDraft, useListDraft } from './ui.js'

// カンマ／改行区切りの欄は、正規化した配列から value を作ると
// **区切り文字を打った瞬間に消える**（打つ前と同じ配列に戻るので value prop が変わらず、
// React が DOM の値を書き戻す）。貼り付けは動くのでテストでも見落としやすい。
// キーボードで 2 個目を足せるかどうかを、フックの振る舞いとして固定する。

interface Harness {
  text: string
  type: (next: string) => string[]
  setValues: (next: string[]) => void
}

function render(initial: string[], separator: ',' | '\n'): Harness {
  const host = document.createElement('div')
  const root = createRoot(host)
  const harness = {} as Harness
  let values = initial

  function Probe(): null {
    const draft = useListDraft(values, separator)
    harness.text = draft.text
    harness.type = (next) => {
      let parsed: string[] = []
      act(() => {
        parsed = draft.change(next)
      })
      return parsed
    }
    return null
  }

  act(() => root.render(<Probe />))
  harness.setValues = (next) => {
    values = next
    act(() => root.render(<Probe />))
  }
  return harness
}

describe('useListDraft', () => {
  it('区切り文字を打っても消えない（2 個目をキーボードで足せる）', () => {
    const h = render(['1.1.1.1'], ',')
    expect(h.text).toBe('1.1.1.1')

    // ここが本題。従来は打った瞬間に value が '1.1.1.1' へ戻され、
    // カンマが入力できなかった。
    const afterComma = h.type('1.1.1.1,')
    expect(h.text).toBe('1.1.1.1,')
    expect(afterComma).toEqual(['1.1.1.1'])

    const afterSecond = h.type('1.1.1.1, 8.8.8.8')
    expect(h.text).toBe('1.1.1.1, 8.8.8.8')
    expect(afterSecond).toEqual(['1.1.1.1', '8.8.8.8'])
  })

  it('改行区切り（SSH 公開鍵）でも同じ', () => {
    const h = render(['ssh-ed25519 AAAA a@x'], '\n')
    h.type('ssh-ed25519 AAAA a@x\n')
    expect(h.text).toBe('ssh-ed25519 AAAA a@x\n')
    expect(h.type('ssh-ed25519 AAAA a@x\nssh-rsa BBBB b@y')).toEqual([
      'ssh-ed25519 AAAA a@x',
      'ssh-rsa BBBB b@y',
    ])
  })

  it('外から値が差し替わったら下書きを作り直す（プロファイルを開いたとき）', () => {
    const h = render(['1.1.1.1'], ',')
    h.type('1.1.1.1,')
    h.setValues(['9.9.9.9', '8.8.4.4'])
    expect(h.text).toBe('9.9.9.9, 8.8.4.4')
  })

  it('同じ内容の再レンダリングでは入力中の下書きを壊さない', () => {
    const h = render(['1.1.1.1'], ',')
    h.type('1.1.1.1, ')
    // 親が再レンダリングされても（値は同じ）、打ちかけの ", " は残る
    h.setValues(['1.1.1.1'])
    expect(h.text).toBe('1.1.1.1, ')
  })

  it('空欄にできる', () => {
    const h = render(['1.1.1.1'], ',')
    expect(h.type('')).toEqual([])
    expect(h.text).toBe('')
  })
})

// 構造を持つ値（snaps）や空白区切りも同じ形。useDraft はそれらを扱う。
describe('useDraft', () => {
  interface H {
    text: string
    type: (next: string) => unknown
    setValue: (next: unknown) => void
  }

  function renderDraft(
    initial: unknown,
    toText: (v: never) => string,
    parse: (t: string) => unknown,
  ): H {
    const host = document.createElement('div')
    const root = createRoot(host)
    const h = {} as H
    let value = initial

    function Probe(): null {
      const d = useDraft(value as never, toText, parse as (t: string) => never)
      h.text = d.text
      h.type = (next) => {
        let out: unknown
        act(() => {
          out = d.change(next)
        })
        return out
      }
      return null
    }

    act(() => root.render(<Probe />))
    h.setValue = (next) => {
      value = next
      act(() => root.render(<Probe />))
    }
    return h
  }

  const snapText = (list: { name: string; channel?: string; classic?: boolean }[]): string =>
    list
      .map((sp) => [sp.name, sp.channel, sp.classic ? '--classic' : ''].filter(Boolean).join(' '))
      .join('\n')

  const snapParse = (text: string): { name: string; channel?: string; classic?: boolean }[] =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/)
        const name = parts[0]!
        const classic = parts.includes('--classic')
        const channel = parts.slice(1).find((x) => !x.startsWith('--'))
        return { name, ...(channel ? { channel } : {}), ...(classic ? { classic: true } : {}) }
      })

  it('snap の行を打ち切る途中でも消えない', () => {
    const h = renderDraft([{ name: 'lxd' }], snapText as never, snapParse)
    expect(h.text).toBe('lxd')
    // 改行を打つ → 正規化すると同じ配列に戻るので、素朴な実装だと消える
    h.type('lxd\n')
    expect(h.text).toBe('lxd\n')
    // 2 行目を打てる
    expect(h.type('lxd\nmicrok8s --classic')).toEqual([
      { name: 'lxd' },
      { name: 'microk8s', classic: true },
    ])
  })

  it('空白区切り（パッケージ名）でも区切りが打てる', () => {
    const h = renderDraft(
      ['nginx'],
      ((list: string[]) => list.join(' ')) as never,
      (t: string) => t.split(/[\s,]+/).filter(Boolean),
    )
    h.type('nginx ')
    expect(h.text).toBe('nginx ')
    expect(h.type('nginx jq')).toEqual(['nginx', 'jq'])
  })

  it('外から差し替わったら作り直す', () => {
    const h = renderDraft([{ name: 'lxd' }], snapText as never, snapParse)
    h.type('lxd\n')
    h.setValue([{ name: 'core' }])
    expect(h.text).toBe('core')
  })
})

// ---------------------------------------------------------------------------
// 複数値フィールドの見張り（落とし穴 58）
// ---------------------------------------------------------------------------
//
// 落とし穴 58 の壊れ方は 2 つある。どちらか片方だけを見ていると、
// 「見張りは緑なのに区切り文字が打てない欄」が普通に増える。
//
//   (a) 元の形 …… `value={list.join(', ')}` +
//                  `onChange={split → trim → filter(Boolean)}`。
//                  下書きを一度も通さない。**下 (B) で見る。**
//   (b) 半分だけ直した形 …… `value={xDraft.text}` と書きながら
//                  `onChange` で自前に `split()` して値を作る。`setDraft` が
//                  一度も走らないので下書きが初期値のまま固まり、(a) と
//                  同じ壊れ方に戻る。**下 (A) で見る。**
//                  実際、13 か所のうち 2 か所がこの形で残っていた
//                  （`PostInstallStep` の late-commands と first-boot-commands）。
//
// 目視で数えるのをやめ、ソースを数える（落とし穴 73）。

const RENDERER_SOURCES = import.meta.glob(
  ['../**/*.tsx', '!../**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as unknown as Record<string, string>

/** `value={<名前>.text}` の <名前> を集める。判定用と置換用は分ける（落とし穴 63）。 */
const DRAFT_VALUE_RE = /value=\{\s*([A-Za-z_$][\w$]*)\.text\s*\}/g

/**
 * コメントを空白へ潰す（長さと改行は保つので、あとから行番号を数えられる）。
 *
 * これをやらないと、`useListDraft` の JSDoc に書いてある
 * 「`value={list.join(', ')}` はこう壊れる」という**説明文そのもの**を
 * 違反として拾ってしまう。
 *
 * 正規表現リテラルは追わない。この配下に `/*` や `//` を含む正規表現は無く
 * （`/[\s,]+/` `/^[a-z_][a-z0-9_-]{0,31}$/` `/\s+/` など）、
 * 追わなかったせいで走査が空振りしていないことは
 * 「value 式が 90 個以上見つかる」ことで別に確かめている。
 */
function blankComments(source: string): string {
  const out = [...source]
  type Mode = 'code' | 'line' | 'block' | "'" | '"' | '`'
  let mode: Mode = 'code'
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    const next = source[i + 1]
    if (mode === 'line') {
      if (c === '\n') mode = 'code'
      else out[i] = ' '
      continue
    }
    if (mode === 'block') {
      if (c !== '\n') out[i] = ' '
      if (c === '*' && next === '/') {
        out[i + 1] = ' '
        i++
        mode = 'code'
      }
      continue
    }
    if (mode !== 'code') {
      if (c === '\\') i++
      else if (c === mode) mode = 'code'
      continue
    }
    if (c === '/' && next === '/') {
      out[i] = ' '
      out[i + 1] = ' '
      i++
      mode = 'line'
    } else if (c === '/' && next === '*') {
      out[i] = ' '
      out[i + 1] = ' '
      i++
      mode = 'block'
    } else if (c === "'" || c === '"' || c === '`') {
      mode = c
    }
  }
  return out.join('')
}

/**
 * JSX の `value={…}` の中身を、括弧の対応を数えて取り出す。
 * 1 行の正規表現では複数行にまたがる式（`SoftwareStep` の 3 状態 Select など）を
 * 取りこぼす。取りこぼした形で新しい欄が書かれると見張りが黙る。
 */
function valueExpressions(source: string): { expr: string; index: number }[] {
  const code = blankComments(source)
  const found: { expr: string; index: number }[] = []
  // 属性位置の value= だけ（オブジェクトのキーは `value:` なので当たらない）
  const attr = /(?:^|[\s{])value=\{/g
  for (const m of code.matchAll(attr)) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let quote: string | null = null
    for (let i = open; i < code.length; i++) {
      const c = code[i]!
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        found.push({ expr: code.slice(open + 1, i), index: open })
        break
      }
    }
  }
  return found
}

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length

/**
 * 「配列から毎回組み立てている value」の正当な例外。
 *
 * ここに入れてよいのは **読み取り専用の表示**か、**配列ではない単一値の整形**だけ。
 * 「今こう書いてあるから」は理由にならない（落とし穴 56）。
 * 使われなくなった例外はそのまま残さない — 下のテストが落ちる。
 */
const ARRAY_VALUE_ALLOW: { file: string; contains: string; why: string }[] = []

// 下書きを value に使っている欄の実数。減ったときだけ落とす。
//
// `toBe(13)` にすると新しい欄を足すたびに落ちるので、「見張りを黙らせるために
// 数を書き換える」が習慣になる（そのうち本当に減った回も書き換えられる）。
// 一方 `toBeGreaterThan(10)` だと 2 件までは黙って消せる。
// 実数以上を要求する形なら、増えるのは自由・減ったら必ず止まる。
const DRAFT_FIELDS_MIN = 13

// 数だけでは「A の欄が消えて B の欄が増えた」を見逃す。
// 下書きが要る画面そのものが素通しへ戻っていないかも見る。
const DRAFT_FIELD_FILES = [
  // ネットワークの nameservers / search domains。**単一 NIC と bond で同じ部品**を
  // 使うので、`NetworkStep.tsx` から `sections/NetworkFields.tsx` へ移した
  // （写しを 2 つ持つと片方だけ直る）。見張る欄は変わっていない。
  'NetworkFields.tsx',
  'PostInstallStep.tsx', // late / first-boot / error commands
  'SoftwareStep.tsx', // custom packages / snaps
  'UserStep.tsx', // ssh keys / groups
  'AdditionalUsers.tsx', // groups / ssh keys
  'Services.tsx', // environment / after
]

describe('下書きの使われ方', () => {
  it('走査対象のファイルが実際に読めている', () => {
    // glob が 0 件だと以下のテストは「常に緑」になる。まずそこを固定する。
    const files = Object.keys(RENDERER_SOURCES)
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((f) => f.endsWith('PostInstallStep.tsx'))).toBe(true)
    expect(files.every((f) => !f.endsWith('.test.tsx'))).toBe(true)
  })

  it('value 式の取り出しが空振りしていない', () => {
    // (B) は「0 件であること」を要求するテストなので、取り出しが壊れると
    // 何も見ずに緑になる。コメント潰しが行き過ぎていないことをここで固定する。
    const all = Object.values(RENDERER_SOURCES).flatMap((s) => valueExpressions(s))
    expect(all.length, 'value={…} を取り出せていない（コメント潰しか括弧数えが壊れた）').toBeGreaterThan(90)
    // 説明文の中の `value={list.join(', ')}` を拾っていないこと
    const uiPath = Object.keys(RENDERER_SOURCES).find((f) => f.endsWith('/ui.tsx'))
    expect(uiPath, 'ui.tsx が走査対象に入っていない').toBeDefined()
    const ui = RENDERER_SOURCES[uiPath!]!
    expect(valueExpressions(ui).some((v) => v.expr.includes('.join('))).toBe(false)
  })

  it('(A) value に下書きを使っている欄は、同じファイルで change() も呼んでいる', () => {
    const missing: string[] = []
    const files = new Set<string>()
    let checked = 0
    for (const [path, source] of Object.entries(RENDERER_SOURCES)) {
      for (const m of blankComments(source).matchAll(DRAFT_VALUE_RE)) {
        const name = m[1]!
        checked++
        files.add(path.split('/').pop()!)
        if (!source.includes(`${name}.change(`)) {
          missing.push(`${path}:${lineOf(source, m.index)} — value={${name}.text} なのに ${name}.change( が無い`)
        }
      }
    }
    // 走査そのものが空振りしていないことも同時に確かめる
    expect(
      checked,
      `下書きを value に使っている欄が ${DRAFT_FIELDS_MIN} 件を下回った（${checked} 件）。` +
        '欄を素通しへ戻していないか確認する。意図して減らしたなら DRAFT_FIELDS_MIN を下げる。',
    ).toBeGreaterThanOrEqual(DRAFT_FIELDS_MIN)
    expect([...DRAFT_FIELD_FILES].filter((f) => !files.has(f)), '下書きの欄が消えた画面がある').toEqual([])
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('(B) 配列から毎回組み立てた value を使っていない（下書きを通す）', () => {
    const offenders: { key: string; where: string; expr: string }[] = []
    const used = new Set<string>()
    for (const [path, source] of Object.entries(RENDERER_SOURCES)) {
      const file = path.split('/').pop()!
      for (const { expr, index } of valueExpressions(source)) {
        // 配列から文字列を組み立てている value は、正規化した値を毎回作り直している。
        // 途中の入力（区切り文字）が打った瞬間に消える形（落とし穴 58）。
        if (!/\.(join|map)\(/.test(expr)) continue
        const flat = expr.replace(/\s+/g, ' ').trim()
        const allow = ARRAY_VALUE_ALLOW.find((a) => a.file === file && flat.includes(a.contains))
        if (allow) {
          used.add(`${allow.file}|${allow.contains}`)
          continue
        }
        offenders.push({
          key: `${file}|${flat.slice(0, 40)}`,
          where: `${path}:${lineOf(source, index)}`,
          expr: flat.length > 120 ? `${flat.slice(0, 120)}…` : flat,
        })
      }
    }
    expect(
      offenders,
      offenders
        .map(
          (o) =>
            `${o.where} — value={${o.expr}} は配列から毎回組み立てている。` +
            'useListDraft / useDraft を通すか、読み取り専用なら ARRAY_VALUE_ALLOW に理由付きで入れる。',
        )
        .join('\n'),
    ).toEqual([])

    // 死んだ例外を残さない。直したのに許可だけ残ると、次に同じ形を書いたとき黙る。
    const dead = ARRAY_VALUE_ALLOW.filter((a) => !used.has(`${a.file}|${a.contains}`))
    expect(dead.map((a) => `${a.file}: ${a.contains}（${a.why}）`), '当たらない例外が残っている').toEqual([])
  })
})
