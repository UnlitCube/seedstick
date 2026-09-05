// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createDefaultProfile,
  createTranslator,
  validateProfile,
  type AptSource,
  type AutoinstallProfile,
  type MsgKey,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { SoftwareStep, countSoftwareAdvancedChanges } from './SoftwareStep.js'

// 「ソフトウェア」の階層化を固定する。ここで守りたいのは 4 つ。
//
//   1. インストーラが決して聞かないもの（カーネルの種類・追加リポジトリ・
//      apt の fallback / preserve・Ubuntu Pro）だけが折りたたみに入っていること。
//      **subiquity が聞くもの（更新・snap・追加パッケージ・ミラー）と、
//      このツールの主用途である GPU は表に出したまま**であること。
//   2. 折りたたんだものが**開けば今までどおり操作できる**こと（落とし穴 61 / 66）。
//      「隠す」と「触れなくする」を取り違えると、保存済みプロファイルの設定を
//      解除できなくなる。
//   3. 既定から変わっているときは**最初から開いている**こと。
//      設定したはずのものが畳まれていると「消えた」と誤解される。
//   4. 22.04 のように**そのリリースでは効かない設定**でも、伝達が消えないこと
//      （落とし穴 64 / 67）。折りたたみに入れたせいで気づけなくなっていないか。

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')

const mounted: { host: HTMLElement; root: Root }[] = []

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    m.host.remove()
  }
  useStore.setState({ profile: createDefaultProfile('24.04'), locale: 'ja' })
})

/** そのプロファイルで `SoftwareStep` を描く。store を通すのは本番と同じ経路にするため。 */
function mount(profile: AutoinstallProfile): HTMLElement {
  useStore.setState({ profile, locale: 'ja', iso: null })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  act(() => root.render(<SoftwareStep />))
  return host
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * 制御コンポーネントに値を入れる。
 *
 * React は DOM の value を自前で追跡していて、`el.value = x` だけでは
 * 「変わっていない」と判断して onChange を呼ばないことがある。
 * プロトタイプ側の setter を直接呼んで追跡を更新してから、
 * input（テキスト）と change（select）の両方を投げる。
 */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** `Field` のラベルから入力欄を引く（`htmlFor` → `id`）。無ければ `null`。 */
function control(host: HTMLElement, key: MsgKey): HTMLElement | null {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(t(key)))
  const id = label?.getAttribute('for')
  if (!id) return null
  const el = document.getElementById(id)
  return host.contains(el) ? el : null
}

/** 「詳しい設定」の開閉ボタン。 */
function toggle(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(t('software.advancedTitle')),
  )
  expect(button, '「詳しい設定」の折りたたみが無い').toBeDefined()
  return button as HTMLButtonElement
}

const profileWith = (patch: (p: AutoinstallProfile) => AutoinstallProfile): AutoinstallProfile =>
  patch(createDefaultProfile('24.04'))

const source = (id: string): AptSource => ({ id, name: `${id}.list`, source: 'ppa:x/y', key: '' })

describe('SoftwareStep の階層', () => {
  it('既定では「詳しい設定」が畳まれていて、中身は描画されない', () => {
    const host = mount(createDefaultProfile('24.04'))
    expect(toggle(host).getAttribute('aria-expanded')).toBe('false')
    expect(control(host, 'adv.kernelTitle'), 'カーネルが表に出ている').toBeNull()
    expect(control(host, 'adv.aptFallback'), 'apt の fallback が表に出ている').toBeNull()
    expect(control(host, 'software.ubuntuProTokenLabel'), 'Ubuntu Pro が表に出ている').toBeNull()
    expect(control(host, 'adv.aptSources'), '追加リポジトリが表に出ている').toBeNull()
  })

  it('インストーラが聞くものと GPU は折りたたみの外に出したまま', () => {
    const host = mount(createDefaultProfile('24.04'))
    // 畳んだ状態で見えていること（＝表に出ている）
    expect(control(host, 'software.updates'), 'インストール時の更新が隠れている').not.toBeNull()
    expect(control(host, 'software.snapsLabel'), 'snap が隠れている').not.toBeNull()
    expect(control(host, 'software.customPackages'), '追加パッケージが隠れている').not.toBeNull()
    expect(control(host, 'software.aptProxy'), 'ミラーの設定が隠れている').not.toBeNull()
    // GPU / CUDA はインストーラには無いが、このツールの主用途で数 GB の
    // ダウンロードを伴う重い選択なので隠さない。
    expect(host.textContent, 'GPU が隠れている').toContain(t('gpu.enable'))
  })

  it('開けば、折りたたみに入れた設定を今までどおり操作できる', () => {
    const host = mount(createDefaultProfile('24.04'))
    click(toggle(host))
    expect(toggle(host).getAttribute('aria-expanded')).toBe('true')

    const kernel = control(host, 'adv.kernelTitle') as HTMLSelectElement
    expect(kernel).not.toBeNull()
    setValue(kernel, 'generic-hwe')
    expect(useStore.getState().profile.software.kernel).toEqual({
      mode: 'flavor',
      flavor: 'generic-hwe',
    })

    const fallback = control(host, 'adv.aptFallback') as HTMLSelectElement
    setValue(fallback, 'offline-install')
    expect(useStore.getState().profile.apt.fallback).toBe('offline-install')

    const token = control(host, 'software.ubuntuProTokenLabel') as HTMLInputElement
    setValue(token, 'C1a2b3')
    expect(useStore.getState().profile.software.ubuntuProToken).toBe('C1a2b3')

    // 追加リポジトリは「足す」ボタンから増やせる
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent === t('common.add'))
    expect(add, '追加リポジトリの「追加」ボタンが無い').toBeDefined()
    click(add as HTMLButtonElement)
    expect(useStore.getState().profile.apt.sources).toHaveLength(1)
  })

  it('折りたたみに入れた設定を「解除できない」状態にしない（落とし穴 61 / 66）', () => {
    // 有効にして保存されたプロファイルを開いた状態から、既定へ戻せること。
    const host = mount(
      profileWith((p) => ({ ...p, software: { ...p.software, kernel: { mode: 'flavor', flavor: 'hwe' } } })),
    )
    const kernel = control(host, 'adv.kernelTitle') as HTMLSelectElement
    expect(kernel, '変更済みなのに畳まれていて触れない').not.toBeNull()
    setValue(kernel, 'default')
    expect(useStore.getState().profile.software.kernel).toEqual({ mode: 'default' })
  })

  it('既定から変わっていれば最初から開いていて、件数が見える', () => {
    const host = mount(
      profileWith((p) => ({
        ...p,
        software: { ...p.software, ubuntuProToken: 'C1a2b3' },
        apt: { ...p.apt, sources: [source('a'), source('b'), source('c')] },
      })),
    )
    expect(toggle(host).getAttribute('aria-expanded')).toBe('true')
    expect(control(host, 'software.ubuntuProTokenLabel')).not.toBeNull()
    // リポジトリ 3 件は「1 か所を変えた」。トークンと合わせて 2 件。
    expect(toggle(host).textContent).toContain(t('nav.changedCount', { n: 2 }))
  })

  it('22.04 で効かない apt.fallback は、折りたたんでも伝達が消えない（落とし穴 64 / 67）', () => {
    const profile = profileWith((p) => ({
      ...p,
      series: '22.04' as const,
      apt: { ...p.apt, fallback: 'continue-anyway' as const },
    }))
    // 1. 検証が「効きません」と伝える（確認画面に出る）
    const issues = validateProfile(profile).issues
    expect(issues.map((i) => i.text.key)).toContain('validate.aptFallbackUnsupported')
    // 2. 既定と違うので折りたたみは開いている（畳んだまま気づけない状態にしない）
    const host = mount(profile)
    expect(toggle(host).getAttribute('aria-expanded')).toBe('true')
    expect(control(host, 'adv.aptFallback')).not.toBeNull()
  })
})

describe('countSoftwareAdvancedChanges', () => {
  it('既定のプロファイルは 0 件', () => {
    expect(countSoftwareAdvancedChanges(createDefaultProfile('24.04'))).toBe(0)
    expect(countSoftwareAdvancedChanges(createDefaultProfile('22.04'))).toBe(0)
  })

  it('折りたたみの中だけを数える（表に出ている設定では増えない）', () => {
    const front = profileWith((p) => ({
      ...p,
      software: {
        ...p.software,
        packages: ['nginx'],
        snaps: [{ name: 'lxd' }],
        updates: 'all',
        installDrivers: true,
        gpu: { ...p.software.gpu, enabled: true },
      },
      apt: { ...p.apt, mode: 'custom', primaryUri: 'http://example.invalid/ubuntu' },
    }))
    expect(countSoftwareAdvancedChanges(front)).toBe(0)
  })

  it('リストは要素数ではなく「既定と違うか」で 1 件', () => {
    const one = profileWith((p) => ({ ...p, apt: { ...p.apt, sources: [source('a')] } }))
    const three = profileWith((p) => ({
      ...p,
      apt: { ...p.apt, sources: [source('a'), source('b'), source('c')] },
    }))
    expect(countSoftwareAdvancedChanges(one)).toBe(1)
    expect(countSoftwareAdvancedChanges(three)).toBe(1)
  })

  it('折りたたみの中の 5 項目をそれぞれ数える', () => {
    const all = profileWith((p) => ({
      ...p,
      software: {
        ...p.software,
        kernel: { mode: 'package', package: 'linux-generic-hwe-24.04' },
        ubuntuProToken: 'C1a2b3',
      },
      apt: {
        ...p.apt,
        sources: [source('a')],
        fallback: 'offline-install',
        preserveSourcesList: true,
      },
    }))
    expect(countSoftwareAdvancedChanges(all)).toBe(5)
  })

  it('判別可能ユニオンは判別子だけで見る（落とし穴 22 / 29）', () => {
    // flavor だけ違う 2 つは、どちらも「既定 (default) ではない」1 件。
    const generic = profileWith((p) => ({
      ...p,
      software: { ...p.software, kernel: { mode: 'flavor', flavor: 'generic' } },
    }))
    const lowlatency = profileWith((p) => ({
      ...p,
      software: { ...p.software, kernel: { mode: 'flavor', flavor: 'lowlatency' } },
    }))
    expect(countSoftwareAdvancedChanges(generic)).toBe(1)
    expect(countSoftwareAdvancedChanges(lowlatency)).toBe(1)
  })

  it('読めない値は「変わっている」側に数える（0 と数えて隠さない）', () => {
    // 手で編集されたプロファイルは実際に届く（落とし穴 23）。
    // 0 と数えると、壊れた設定が折りたたまれたまま書き込みまで進む。
    const brokenKernel = profileWith((p) => ({
      ...p,
      software: { ...p.software, kernel: null as unknown as AutoinstallProfile['software']['kernel'] },
    }))
    expect(countSoftwareAdvancedChanges(brokenKernel)).toBe(1)

    const brokenSources = profileWith((p) => ({
      ...p,
      apt: { ...p.apt, sources: 'ppa:x/y' as unknown as AptSource[] },
    }))
    expect(countSoftwareAdvancedChanges(brokenSources)).toBe(1)

    // セクションごと壊れていても投げない（サイドバーと違い Error Boundary の
    // 中ではあるが、数えるだけで落ちるのは避ける）。
    const brokenApt = profileWith((p) => ({
      ...p,
      apt: null as unknown as AutoinstallProfile['apt'],
    }))
    expect(() => countSoftwareAdvancedChanges(brokenApt)).not.toThrow()
    expect(countSoftwareAdvancedChanges(brokenApt)).toBe(3)
  })
})
