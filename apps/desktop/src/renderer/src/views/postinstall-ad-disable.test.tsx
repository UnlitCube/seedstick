// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultProfile, createTranslator } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { PostInstallStep, countAdvancedChanges } from './PostInstallStep.js'

// ---------------------------------------------------------------------------
// **無効に戻したら値も消す**（落とし穴 66）。
//
// Active Directory のドメイン名と管理者名は、スイッチが有効なときしか描画されない。
// 無効に戻したときに値を残すと、
//
//   - 折りたたみには「1 件変更」の Badge が残るのに、開いても直す先が無い
//   - 保存したプロファイル JSON に、使わないドメイン名が残り続ける
//     （社内のドメイン名は他人へ渡す JSON に入れたくない類の値）
//
// になる。暗号化パスフレーズ（`StorageStep`）と同じ扱いに揃えた。
//
// 本物のクリックで操作する。`useStore.setState` で値を作ると、
// スイッチの `onChange` を通らないので「消しているつもり」を検証できない。
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  // updateProfile → regenerate は window.autoinstall を触る。
  // 例外が握り潰されて緑になる紛らわしい状態を避けるため、最低限の偽物を置く。
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = {
    generateConfig: async () => null,
  }
  useStore.setState({ locale: 'ja', profile: createDefaultProfile('24.04') })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

function render(): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<PostInstallStep />))
  return host
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** 「上級者向け」の折りたたみを開く。 */
function open(el: HTMLElement): void {
  const toggle = el.querySelector('h3 button') as HTMLButtonElement | null
  expect(toggle, '「上級者向け」の折りたたみが見つからない').not.toBeNull()
  if (toggle!.getAttribute('aria-expanded') === 'false') click(toggle!)
}

/** Active Directory のスイッチ（`adv.adWarning` を説明に持つのはこれだけ）。 */
function adSwitch(el: HTMLElement): HTMLInputElement {
  const label = [...el.querySelectorAll('label')].find((l) =>
    (l.textContent ?? '').includes(t('adv.adWarning')),
  )
  expect(label, 'Active Directory のスイッチが無い').toBeDefined()
  return label!.querySelector('input[type="checkbox"]') as HTMLInputElement
}

/** ラベルの文言から `<label for>` の入力欄を引く。 */
function inputByLabel(el: HTMLElement, label: string): HTMLInputElement {
  const found = [...el.querySelectorAll('label')].find((l) => l.textContent?.includes(label))
  expect(found, `${label} の入力欄が無い`).toBeDefined()
  const id = found!.getAttribute('for')
  const input = id ? el.querySelector(`[id="${id}"]`) : null
  expect(input, `${label} の入力欄が id で引けない`).not.toBeNull()
  return input as HTMLInputElement
}

/** React の value tracker を迂回して本物の入力を送る。 */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const ad = (): { enabled: boolean; domainName: string; adminName: string } =>
  useStore.getState().profile.activeDirectory

describe('Active Directory を無効に戻したとき', () => {
  it('ドメイン名と管理者名が消える（落とし穴 66）', () => {
    const el = render()
    open(el)

    click(adSwitch(el))
    expect(ad().enabled).toBe(true)

    typeInto(inputByLabel(el, t('adv.adDomain')), 'corp.example.com')
    typeInto(inputByLabel(el, t('adv.adAdmin')), 'Administrator')
    expect(ad()).toMatchObject({ domainName: 'corp.example.com', adminName: 'Administrator' })

    // ここが本題。無効に戻すと、隠れる入力欄の値も一緒に消える。
    click(adSwitch(el))
    expect(ad().enabled).toBe(false)
    expect(ad().domainName, '無効なのにドメイン名が残っている').toBe('')
    expect(ad().adminName, '無効なのに管理者名が残っている').toBe('')
  })

  it('件数が 0 に戻る（開いても直す先が無い「1 件変更」を出さない）', () => {
    const el = render()
    open(el)
    expect(countAdvancedChanges(useStore.getState().profile)).toBe(0)

    click(adSwitch(el))
    typeInto(inputByLabel(el, t('adv.adDomain')), 'corp.example.com')
    expect(countAdvancedChanges(useStore.getState().profile)).toBeGreaterThan(0)

    click(adSwitch(el))
    expect(
      countAdvancedChanges(useStore.getState().profile),
      '無効に戻したのに件数が残っている',
    ).toBe(0)
  })

  it('入力欄も画面から消える（隠れた値が残っていないことの裏取り）', () => {
    const el = render()
    open(el)
    click(adSwitch(el))
    expect(el.textContent).toContain(t('adv.adDomain'))
    click(adSwitch(el))
    expect(el.textContent).not.toContain(t('adv.adDomain'))
  })
})

describe('countAdvancedChanges と Active Directory', () => {
  const base = createDefaultProfile('24.04')

  it('無効なら、値が残っていても数えない', () => {
    // 直接 JSON を書き換えた場合（画面を通らない経路）。無効なら効かない設定なので、
    // 「1 件変更」を出しても開いた先には何も無い。
    const p = {
      ...base,
      activeDirectory: { enabled: false, domainName: 'corp.example.com', adminName: 'root' },
    }
    expect(countAdvancedChanges(p)).toBe(0)
  })

  it('有効なら、ドメイン名と管理者名をそれぞれ数える', () => {
    const p = {
      ...base,
      activeDirectory: { enabled: true, domainName: 'corp.example.com', adminName: 'root' },
    }
    // enabled / domainName / adminName の 3 件。
    expect(countAdvancedChanges(p)).toBe(3)
  })
})
