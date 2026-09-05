// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Disclosure, useListDraft } from './ui.js'

// React に「ここは act() が使える環境だ」と伝える。付けないと act() の中の
// 更新がフラッシュされず、開閉のような state 変化を追えない
// （警告は出るがテストは緑になりうるので、無いことに気づきにくい）。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `Disclosure` は「詳しい設定」の折りたたみ。ここで固定するのは 3 つ。
//
//   1. キーボードで開閉できること（`<button>` であること・`aria-expanded` が動くこと）
//   2. 閉じているときは**中身を描画しない**こと（その代償も一緒に固定する）
//   3. 既定から変わっている設定を、たたんだまま気づけない状態にしないこと
//
// 2 は「描画しない」と「`hidden` で残す」のどちらが正しいかを実際に試して決めた。
// 決め手は `ui.tsx` の JSDoc に書いてある。ここではその**代償**（閉じている間に
// 入力途中の下書きが消える）を明示的に固定しておく。挙動を変えるならこのテストが
// 落ちるので、「気づかないうちに変わっていた」にはならない。

/**
 * **テストごとに必ず片付ける。**
 * 片付けないと前のテストの DOM が `document.body` に残り、同じ id
 * （`#dns`）が 2 つになる。jsdom の `querySelector('#id')` は
 * `document.getElementById` で 1 つ目を引いてから包含関係を見る実装なので、
 * **自分の host の中にあるのに `null` が返る**。
 * 実装は正しいのにテストだけが落ち、原因が実装側にあるように見える。
 */
const mounted: { host: HTMLElement; root: Root }[] = []

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    m.host.remove()
  }
})

function mount(node: React.ReactNode): { host: HTMLElement; root: Root; render: (n: React.ReactNode) => void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  act(() => root.render(node))
  return { host, root, render: (n) => act(() => root.render(n)) }
}

const toggleOf = (host: HTMLElement): HTMLButtonElement => {
  const button = host.querySelector('button')
  expect(button, '開閉するのは <button> でなければならない（div + onClick では Tab で届かない）').not.toBeNull()
  return button as HTMLButtonElement
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('Disclosure', () => {
  it('button で開閉でき、aria-expanded と aria-controls が付いている', () => {
    const { host } = mount(
      <Disclosure title="advanced">
        <p id="inner">body</p>
      </Disclosure>,
    )
    const button = toggleOf(host)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    const controlled = button.getAttribute('aria-controls')
    expect(controlled, 'aria-controls が無い').toBeTruthy()
    // 参照先は閉じていても存在すること（宙に浮いた aria-controls にしない）
    expect(document.getElementById(controlled!)).not.toBeNull()

    click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('#inner')).not.toBeNull()

    click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('閉じているときは中身を描画しない', () => {
    const { host } = mount(
      <Disclosure title="advanced">
        <p id="inner">body</p>
      </Disclosure>,
    )
    // `hidden` で残すのではなく、DOM に存在しないこと
    expect(host.querySelector('#inner')).toBeNull()
    const region = host.querySelector('[role="region"]')
    expect(region?.hasAttribute('hidden')).toBe(true)
  })

  it('changedCount > 0 なら既定で開く（たたんだまま気づけないのを防ぐ）', () => {
    const { host } = mount(
      <Disclosure title="advanced" changedCount={3}>
        <p id="inner">body</p>
      </Disclosure>,
    )
    expect(toggleOf(host).getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('#inner')).not.toBeNull()
    // 件数は Badge で見える
    expect(host.textContent).toContain('3')
  })

  it('defaultOpen を明示すればそちらが優先される', () => {
    const { host } = mount(
      <Disclosure title="advanced" changedCount={0} defaultOpen>
        <p id="inner">body</p>
      </Disclosure>,
    )
    expect(toggleOf(host).getAttribute('aria-expanded')).toBe('true')
  })

  it('閉じたまま changedCount が 0 から増えたら開く（プロファイルを開いたとき）', () => {
    const { host, render } = mount(
      <Disclosure title="advanced" changedCount={0}>
        <p id="inner">body</p>
      </Disclosure>,
    )
    expect(toggleOf(host).getAttribute('aria-expanded')).toBe('false')
    render(
      <Disclosure title="advanced" changedCount={2}>
        <p id="inner">body</p>
      </Disclosure>,
    )
    expect(toggleOf(host).getAttribute('aria-expanded')).toBe('true')
  })

  it('changedCount が 0 に戻っても勝手に閉じない（操作中の画面を畳まない）', () => {
    const { host, render } = mount(
      <Disclosure title="advanced" changedCount={2}>
        <p id="inner">body</p>
      </Disclosure>,
    )
    expect(toggleOf(host).getAttribute('aria-expanded')).toBe('true')
    render(
      <Disclosure title="advanced" changedCount={0}>
        <p id="inner">body</p>
      </Disclosure>,
    )
    expect(toggleOf(host).getAttribute('aria-expanded')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// 「閉じたら描画しない」の代償
// ---------------------------------------------------------------------------
//
// 中に `useListDraft` を持つ欄があると、閉じている間に**入力途中の下書き**が消える。
// 消えるのは正規化を通らない部分だけで、`change()` で確定した値は消えない。
// これを知らずに変えると「区切り文字が打てない」（落とし穴 58）の再発に見えるので、
// 何が消えて何が消えないかをここで固定する。

function DraftProbe({ report }: { report: (d: { text: string; change: (v: string) => string[] }) => void }): React.JSX.Element {
  const draft = useListDraft(['1.1.1.1'], ',')
  report(draft)
  return <input id="dns" readOnly value={draft.text} />
}

describe('Disclosure の中の下書き', () => {
  it('開いている間は下書きが保たれる（区切り文字を打てる）', () => {
    let draft = { text: '', change: (_v: string) => [] as string[] }
    const { host } = mount(
      <Disclosure title="advanced" defaultOpen>
        <DraftProbe report={(d) => (draft = d)} />
      </Disclosure>,
    )
    act(() => {
      draft.change('1.1.1.1,')
    })
    expect((host.querySelector('#dns') as HTMLInputElement).value).toBe('1.1.1.1,')
  })

  it('閉じて開くと、確定していない途中の入力だけが消える', () => {
    let draft = { text: '', change: (_v: string) => [] as string[] }
    const { host } = mount(
      <Disclosure title="advanced" defaultOpen>
        <DraftProbe report={(d) => (draft = d)} />
      </Disclosure>,
    )
    act(() => {
      draft.change('1.1.1.1,')
    })
    const button = toggleOf(host)
    click(button)
    click(button)
    // 打ちかけの `,` は消えるが、確定していた `1.1.1.1` は残る
    // （下書きの元になる値はプロファイル側にあるため）。
    expect((host.querySelector('#dns') as HTMLInputElement).value).toBe('1.1.1.1')
  })
})
