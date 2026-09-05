// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultProfile, ja, en, formatLocalized } from '@autoinstall/shared'
import { RuntimeStep } from './RuntimeStep.js'
import { BasicsStep } from './BasicsStep.js'
import { useStore } from '../store.js'
import { summarizeStep } from '../lib/summary.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 「実行時に決める値」は、このアプリで**最も上級の概念**（起動メニューで値を差し替えて
// USB 1 本を複数台に使い回す）。Ubuntu のインストーラを通したことがある人にも前提が無く、
// ステップ名からは何のためのものか分からない。
//
// ここで固定するのは 3 つ。
//   1. **目的 → 仕組み → 設定** の順に並んでいること（説明が最後にあると、
//      読む前に選択を迫られる。以前は「仕組み」の Card がページの最後にあった）
//   2. 説明は移動しただけで、二重に出ていないこと
//   3. 画面で選んだことが、サイドバーの 1 行要約に出ること（要約が飾りでないこと）

const mounted: { host: HTMLElement; root: Root }[] = []

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    m.host.remove()
  }
  useStore.setState({
    locale: 'ja',
    profile: createDefaultProfile('24.04', 'test', '2026-01-01T00:00:00.000Z'),
  })
})

function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  act(() => root.render(node))
  return host
}

const textOf = (host: HTMLElement): string => host.textContent ?? ''

/** 訳文の一部（差し込みや改行に左右されない先頭）で位置を引く。 */
const at = (haystack: string, needle: string): number => {
  const i = haystack.indexOf(needle)
  expect(i, `画面に出ていない: ${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

describe('RuntimeStep の説明', () => {
  it('目的 → 仕組み → 設定 の順に並んでいる', () => {
    const text = textOf(mount(<RuntimeStep />))
    const purpose = at(text, ja['runtime.purposeBody'].slice(0, 24))
    const mechanism = at(text, ja['runtime.howItWorksBody'].slice(0, 24))
    // 選択肢そのもの（`runtime.modeFixed` はその名前が purposeSkip の文中にも出るので、
    // 選択肢にしか無いヒント文で位置を引く）
    const settings = at(text, ja['runtime.modeFixedHint'])
    expect(purpose).toBeLessThan(mechanism)
    expect(mechanism).toBeLessThan(settings)
  })

  it('目的は「USB 1 本を複数台に使う」から書き起こす（用語から始めない）', () => {
    const text = textOf(mount(<RuntimeStep />))
    // 目的の段落が、カーネル引数のような用語より前にあること。
    expect(at(text, ja['runtime.purposeBody'].slice(0, 24))).toBeLessThan(at(text, 'ai.hostname'))
    // 1 台だけなら触らなくてよいことも先に言う（既定のまま通せると分かる）。
    expect(text).toContain(ja['runtime.purposeSkip'].slice(0, 20))
  })

  it('仕組みの説明が二重に出ていない（移動であって複製ではない）', () => {
    const text = textOf(mount(<RuntimeStep />))
    expect(countOf(text, ja['runtime.howItWorksBody'].slice(0, 24))).toBe(1)
    expect(countOf(text, ja['runtime.howItWorks'])).toBe(1)
  })

  it('英語では日本語が残らない', () => {
    useStore.setState({ locale: 'en' })
    const text = textOf(mount(<RuntimeStep />))
    expect(text).toContain(en['runtime.purposeBody'].slice(0, 24))
    expect(/[ぁ-んァ-ヶ一-龠]/.test(text)).toBe(false)
  })
})

describe('RuntimeStep の設定と要約', () => {
  /** ラベル文字列で当該のラジオを引く（React の state を直接いじらない）。 */
  const radioFor = (host: HTMLElement, label: string): HTMLInputElement => {
    const found = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(label))
    expect(found, `ラジオが見つからない: ${label}`).toBeTruthy()
    const input = found!.querySelector('input[type="radio"]')
    return input as HTMLInputElement
  }

  it('「起動メニューから選ぶ」を選ぶと、サイドバーの要約に出る', () => {
    const host = mount(<RuntimeStep />)
    expect(
      formatLocalized('ja', summarizeStep('runtime', useStore.getState().profile)!),
    ).toContain(ja['nav.summaryRuntimeFixed'])

    // ホスト名の欄の 2 番目の選択肢（起動メニューから選ぶ）
    const hostnameField = [...host.querySelectorAll('div')].find(
      (d) => d.textContent?.startsWith(ja['runtime.fieldHostname']),
    )
    expect(hostnameField).toBeTruthy()
    act(() => {
      radioFor(hostnameField as HTMLElement, ja['runtime.modeKernelArg']).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(useStore.getState().profile.runtimeValues.hostname).toBe('kernel-arg')
    const summary = formatLocalized('ja', summarizeStep('runtime', useStore.getState().profile)!)
    expect(summary).toContain(ja['nav.summaryRuntimeFieldHostname'])
    expect(summary).not.toContain(ja['nav.summaryRuntimeFixed'])
    // 前提（固定 IP / シリアル指定）が足りないことは、その場で警告に出る
    expect(textOf(host)).toContain(ja['runtime.presetsTitle'])
  })

  it('前提が足りない選択をすると、その場で警告が出る', () => {
    const host = mount(<RuntimeStep />)
    const diskField = [...host.querySelectorAll('div')].find((d) =>
      d.textContent?.startsWith(ja['runtime.fieldDisk']),
    )
    act(() => {
      radioFor(diskField as HTMLElement, ja['runtime.modeKernelArg']).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    // 既定は「最大のディスク」なので、ディスクを起動メニューから選ぶ前提を満たさない
    expect(textOf(host)).toContain(ja['runtime.prereqTitle'])
  })
})

describe('BasicsStep', () => {
  // basics は「必ず設定する」グループ。既定という概念が無いので要約を出さない。
  // 出すように変えると、サイドバーで「既定のまま」と書かれたホスト名の欄が生まれる。
  it('要約は出さない（インストーラが必ず聞く項目しか無い）', () => {
    expect(summarizeStep('basics', useStore.getState().profile)).toBeNull()
    expect(summarizeStep('iso', useStore.getState().profile)).toBeNull()
  })

  it('4 項目すべてがそのまま操作できる（折りたたみに入れていない）', () => {
    const text = textOf(mount(<BasicsStep />))
    for (const key of ['basics.locale', 'basics.keyboard', 'basics.timezone', 'basics.hostname'] as const) {
      expect(text).toContain(ja[key])
    }
    // 「詳しい設定」の折りたたみは無い（全部インストーラが聞く項目）
    expect(document.querySelectorAll('[aria-expanded]')).toHaveLength(0)
  })
})
