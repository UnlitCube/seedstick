// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createDefaultProfile,
  createTranslator,
  localized,
  type GeneratedConfig,
  type WriteStatus,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { ReadyToReview } from './ReadyToReview.js'

// ---------------------------------------------------------------------------
// 「必ず設定する」を通り終えた人に、残り 5 ステップを飛ばして確認へ行く道を出す。
//
// **押せないボタンにしない。** 設定にエラーがあるときに出すと、
// 押せない理由がこの場所からは分からない（理由は確認画面と各ステップにある）。
// だから「出すが無効」ではなく「出さない」。
// 書き込み中も出さない（`App.tsx` がステップ移動を禁じているのに、
// ここだけ移動できると規則が 2 つになる）。
//
// ここで固定するのは**出る条件と、押した先**の 2 つ。文面は固定しない
// （落とし穴 56）。
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')

const config = (ok: boolean): GeneratedConfig => ({
  userData: '#cloud-config\n',
  metaData: '',
  autoinstallYaml: 'version: 1\n',
  issues: ok
    ? []
    : [{ severity: 'error', field: 'identity.username', text: localized('validate.diskMatchAny') }],
  ok,
  unattended: true,
  payloadBytes: 0,
  missingSources: [],
  patchedGrubCfg: null,
  grubFreeBytes: 0,
  grubTooLarge: false,
})

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  // setStep('review') は regenerate を呼ぶ。window.autoinstall が無いと
  // 例外が握り潰され、「何も起きていないのに緑」になる。
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = {
    generateConfig: async () => config(true),
  }
  useStore.setState({
    locale: 'ja',
    step: 'user',
    profile: createDefaultProfile('24.04'),
    config: config(true),
    writeStatus: { state: 'idle' },
  })
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
  act(() => root!.render(<ReadyToReview />))
  return host
}

/** 「確認へ進む」のボタン。出ていなければ null。 */
const button = (el: HTMLElement): HTMLButtonElement | null =>
  [...el.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(t('nav.readyButton')),
  ) ?? null

const shown = (el: HTMLElement): boolean => el.childElementCount > 0

describe('ReadyToReview を出す条件', () => {
  it('設定が通っていて書き込み中でなければ出る', () => {
    const el = render()
    expect(shown(el)).toBe(true)
    expect(el.textContent).toContain(t('nav.readyTitle'))
    expect(button(el), '押せるボタンが無い').not.toBeNull()
    expect(button(el)!.disabled, '押せないボタンにしない').toBe(false)
  })

  it('設定にエラーがあるときは出さない（押せないボタンにしない）', () => {
    useStore.setState({ config: config(false) })
    const el = render()
    expect(shown(el), 'エラーがあるのに導線が出ている').toBe(false)
    expect(button(el)).toBeNull()
  })

  it('まだ生成できていない（config が null）ときは出さない', () => {
    // 起動直後や生成に失敗した直後。ok かどうか分からないものを ok として扱わない。
    useStore.setState({ config: null })
    expect(shown(render())).toBe(false)
  })

  it('書き込み中は出さない', () => {
    const writing: WriteStatus = {
      state: 'writing',
      phase: 'iso',
      bytesDone: 1,
      bytesTotal: 2,
      label: localized('write.title'),
      bytesPerSecond: null,
      etaSeconds: null,
    }
    useStore.setState({ writeStatus: writing })
    expect(shown(render()), '書き込み中にステップ移動の導線が出ている').toBe(false)
  })

  it('書き込みの準備中も出さない', () => {
    useStore.setState({
      writeStatus: { state: 'preparing', message: localized('write.title') },
    })
    expect(shown(render()), '準備中にステップ移動の導線が出ている').toBe(false)
  })

  it('状態が変われば出たり消えたりする（初期描画だけの見せかけにしない）', () => {
    const el = render()
    expect(shown(el)).toBe(true)
    act(() => useStore.setState({ config: config(false) }))
    expect(shown(el)).toBe(false)
    act(() => useStore.setState({ config: config(true) }))
    expect(shown(el)).toBe(true)
  })
})

describe('ReadyToReview のボタン', () => {
  it('押すと確認のステップへ移る', () => {
    const el = render()
    expect(useStore.getState().step).toBe('user')
    act(() => {
      button(el)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(useStore.getState().step).toBe('review')
  })
})
