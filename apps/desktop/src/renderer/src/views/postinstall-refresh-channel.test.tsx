// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createDefaultProfile,
  createTranslator,
  formatLocalized,
  generateUserData,
  validateProfile,
  type AutoinstallProfile,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { PostInstallStep, countAdvancedChanges } from './PostInstallStep.js'
import { summarizeStep } from '../lib/summary.js'

// ---------------------------------------------------------------------------
// **`refreshInstallerChannel` は 6 巡目の high の生き残りだった。**
//
// 6 巡目に `summarizePostInstall` へ `refreshInstaller` を足したが、
// channel は足し忘れていた。7 巡目で再現したときの状態
// （`refreshInstaller: true` + channel を入れてから、スイッチだけ切る）:
//
//   (a) 要約   : 「既定のまま（何もしない）」          ← 嘘
//   (b) 件数   : 1 件変更
//   (c) YAML   : refresh-installer: {update: false, channel: stable/ubuntu-24.04}
//   (d) 入力欄 : ない（`refreshInstaller` が true のときしか描画されない）
//
// つまり 6 巡目に直した 3 つの症状（要約の嘘 / 数えるのに直せない / 値が残る）が
// 1 つの設定に全部そろっていた。Active Directory と `useWholeDisk` と
// **同じ扱い**に揃える。ここで固定するのは 4 つ。
//
//   1. スイッチを切ると channel も消える（落とし穴 66）
//   2. 件数は `refreshInstaller === true` のときだけ channel を数える
//   3. 要約は channel まで出す（有効なとき）
//   4. 画面を通らずに残った channel は、検証が「効きません」と言う（落とし穴 50 / 67）
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
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

/** 「インストーラを最新に更新する」のスイッチ。 */
function refreshSwitch(el: HTMLElement): HTMLInputElement {
  const label = [...el.querySelectorAll('label')].find((l) =>
    (l.textContent ?? '').includes(t('adv.refreshInstallerHint')),
  )
  expect(label, 'インストーラ更新のスイッチが無い').toBeDefined()
  return label!.querySelector('input[type="checkbox"]') as HTMLInputElement
}

/** channel の入力欄（placeholder で一意に決まる）。 */
const channelInput = (el: HTMLElement): HTMLInputElement | null =>
  el.querySelector('input[placeholder="stable/ubuntu-24.04"]')

/** React の value tracker を迂回して本物の入力を送る。 */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const behavior = (): AutoinstallProfile['behavior'] => useStore.getState().profile.behavior

const summaryJa = (p: AutoinstallProfile): string =>
  formatLocalized('ja', summarizeStep('postinstall', p)!)

/** 手で編集した JSON / 古いプロファイル（画面を通らずに channel だけが残った状態）。 */
function leftover(): AutoinstallProfile {
  const base = createDefaultProfile('24.04')
  return {
    ...base,
    behavior: {
      ...base.behavior,
      refreshInstaller: false,
      refreshInstallerChannel: 'stable/ubuntu-24.04',
    },
  }
}

describe('インストーラ更新を無効に戻したとき', () => {
  it('channel も消える（落とし穴 66）', () => {
    const el = render()
    open(el)

    click(refreshSwitch(el))
    expect(behavior().refreshInstaller).toBe(true)

    const input = channelInput(el)
    expect(input, '有効なのに channel の欄が無い').not.toBeNull()
    typeInto(input!, 'stable/ubuntu-24.04')
    expect(behavior().refreshInstallerChannel).toBe('stable/ubuntu-24.04')

    // ここが本題。切ると、隠れる入力欄の値も一緒に消える。
    click(refreshSwitch(el))
    expect(behavior().refreshInstaller).toBe(false)
    expect(behavior().refreshInstallerChannel, '無効なのに channel が残っている').toBe('')
  })

  it('件数が 0 に戻る（開いても直す先が無い「1 件変更」を出さない）', () => {
    const el = render()
    open(el)
    expect(countAdvancedChanges(useStore.getState().profile)).toBe(0)

    click(refreshSwitch(el))
    typeInto(channelInput(el)!, 'stable/ubuntu-24.04')
    // refreshInstaller と channel の 2 件。
    expect(countAdvancedChanges(useStore.getState().profile)).toBe(2)

    click(refreshSwitch(el))
    expect(
      countAdvancedChanges(useStore.getState().profile),
      '無効に戻したのに件数が残っている',
    ).toBe(0)
  })

  it('YAML からも channel が消える', () => {
    const el = render()
    open(el)
    click(refreshSwitch(el))
    typeInto(channelInput(el)!, 'stable/ubuntu-24.04')
    expect(generateUserData(useStore.getState().profile)).toContain('stable/ubuntu-24.04')

    click(refreshSwitch(el))
    expect(
      generateUserData(useStore.getState().profile),
      '切ったのに YAML に channel が残っている',
    ).not.toContain('stable/ubuntu-24.04')
  })
})

describe('countAdvancedChanges と channel', () => {
  it('無効なら、channel が残っていても数えない', () => {
    expect(countAdvancedChanges(leftover())).toBe(0)
  })

  it('有効なら、channel も数える', () => {
    const base = createDefaultProfile('24.04')
    const p = {
      ...base,
      behavior: {
        ...base.behavior,
        refreshInstaller: true,
        refreshInstallerChannel: 'stable/ubuntu-24.04',
      },
    }
    expect(countAdvancedChanges(p)).toBe(2)
  })
})

describe('要約は channel まで見る', () => {
  const base = createDefaultProfile('24.04')

  it('channel を指定していると、そう分かる文になる', () => {
    const withChannel = {
      ...base,
      behavior: {
        ...base.behavior,
        refreshInstaller: true,
        refreshInstallerChannel: 'stable/ubuntu-24.04',
      },
    }
    const plain = {
      ...base,
      behavior: { ...base.behavior, refreshInstaller: true, refreshInstallerChannel: '' },
    }
    expect(summaryJa(withChannel)).not.toBe(summaryJa(plain))
    expect(summaryJa(withChannel)).toBe(t('nav.summaryRefreshChannel'))
    expect(summaryJa(plain)).toBe(t('nav.summaryRefreshInstaller'))
  })
})

describe('画面を通らずに残った channel', () => {
  it('検証が「効きません」と伝える（黙って消さない。落とし穴 50 / 67）', () => {
    const issues = validateProfile(leftover()).issues.filter(
      (i) => i.text.key === 'validate.refreshChannelIgnored',
    )
    expect(issues, 'channel が残っているのに検証が何も言わない').toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.field).toBe('behavior.refreshInstallerChannel')
  })

  it('有効なら何も言わない（効いている設定に警告を出さない）', () => {
    const base = createDefaultProfile('24.04')
    const p = {
      ...base,
      behavior: {
        ...base.behavior,
        refreshInstaller: true,
        refreshInstallerChannel: 'stable/ubuntu-24.04',
      },
    }
    expect(
      validateProfile(p).issues.filter((i) => i.text.key === 'validate.refreshChannelIgnored'),
    ).toHaveLength(0)
  })
})
