// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Disclosure } from './ui.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// GUI の E2E ヘルパ（`.e2e/drive.mjs` の `openDisclosure`）が頼っている目印を固定する。
//
// **なぜ要るか。** 設定を折りたたみに入れたとき、`.e2e/full-run.mjs` と
// `full-run2.mjs` は swap の欄を開かずに触るままだった。`npm run e2e` は
// この経路を通らないので、**壊れたまま緑**だった（`.e2e/` はテストが 1 つも無い）。
// ここは jsdom なので CDP の経路そのものは通せないが、ヘルパが立っている土台
// ——「`[data-disclosure]` で見出しが引ける」「`aria-expanded` で開閉が分かる」
// 「閉じている間は中身が DOM に無い」——は固定できる。
// この 3 つのどれが崩れても `openDisclosure` は動かない。

const mounted: { host: HTMLElement; root: Root }[] = []
afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    m.host.remove()
  }
})

function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  act(() => root.render(node))
  return host
}

/**
 * `.e2e/drive.mjs` の `openDisclosure` と同じ手順。
 * 「閉じているものだけクリックする」ところまで写す（開いているものを押すと閉じる）。
 * @returns 実際に開いた数
 */
function openDisclosure(root: ParentNode, nth: number | null = null): number {
  const all = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-disclosure]')]
  const total = all().length
  if (total === 0) throw new Error('折りたたみが 1 つも見つかりません')
  const targets = nth === null ? [...Array(total).keys()] : [nth]
  let opened = 0
  for (const i of targets) {
    const el = all()[i]
    if (!el) throw new Error(`折りたたみ ${i} 番目がありません`)
    if (el.getAttribute('aria-expanded') === 'true') continue
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    if (all()[i]?.getAttribute('aria-expanded') !== 'true') {
      throw new Error(`折りたたみ ${i} 番目を開けませんでした`)
    }
    opened += 1
  }
  return opened
}

describe('E2E ヘルパの目印 (data-disclosure)', () => {
  it('見出しの button に付いていて、aria-expanded で開閉が読める', () => {
    const host = mount(
      <Disclosure title="詳しい設定">
        <input placeholder="4G" />
      </Disclosure>,
    )
    const marker = host.querySelector('[data-disclosure]')
    expect(marker, 'この目印が無いと .e2e/drive.mjs の openDisclosure が探せない').not.toBeNull()
    // 目印は**押せるもの**に付いていなければならない。ラッパの div に付いていると
    // クリックしても開かない。
    expect(marker!.tagName).toBe('BUTTON')
    expect(marker!.getAttribute('aria-expanded')).toBe('false')
  })

  it('閉じている間は中身が DOM に無く、目印から開くと触れるようになる', () => {
    const host = mount(
      <Disclosure title="詳しい設定">
        <input placeholder="4G" />
      </Disclosure>,
    )
    // これが `.e2e` で起きていた失敗そのもの（開かずに触ると見つからない）。
    expect(host.querySelector('[placeholder="4G"]')).toBeNull()
    expect(openDisclosure(host)).toBe(1)
    expect(host.querySelector('[placeholder="4G"]')).not.toBeNull()
  })

  it('既に開いているものは押さない（押すと閉じるので、開いたつもりで閉じてしまう）', () => {
    const host = mount(
      <Disclosure title="詳しい設定" defaultOpen>
        <input placeholder="4G" />
      </Disclosure>,
    )
    expect(openDisclosure(host)).toBe(0)
    expect(host.querySelector('[placeholder="4G"]'), '開いていたものを閉じてしまった').not.toBeNull()
  })

  it('引数を省くと画面上の折りたたみを全部開く', () => {
    const host = mount(
      <div>
        <Disclosure title="A">
          <input placeholder="a" />
        </Disclosure>
        <Disclosure title="B">
          <input placeholder="b" />
        </Disclosure>
      </div>,
    )
    expect(openDisclosure(host)).toBe(2)
    expect(host.querySelector('[placeholder="a"]')).not.toBeNull()
    expect(host.querySelector('[placeholder="b"]')).not.toBeNull()
    // 番号指定もできる（2 個目だけ開く）
  })

  it('番号を指定すると、その 1 つだけを開く', () => {
    const host = mount(
      <div>
        <Disclosure title="A">
          <input placeholder="a" />
        </Disclosure>
        <Disclosure title="B">
          <input placeholder="b" />
        </Disclosure>
      </div>,
    )
    expect(openDisclosure(host, 1)).toBe(1)
    expect(host.querySelector('[placeholder="a"]')).toBeNull()
    expect(host.querySelector('[placeholder="b"]')).not.toBeNull()
  })
})
