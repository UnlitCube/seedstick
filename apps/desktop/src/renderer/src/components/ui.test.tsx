// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useListDraft } from './ui.js'

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
