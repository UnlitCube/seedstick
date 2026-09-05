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
