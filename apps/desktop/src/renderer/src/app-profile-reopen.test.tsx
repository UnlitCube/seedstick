// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultProfile, createTranslator, type AutoinstallProfile } from '@autoinstall/shared'
import { App } from './App.js'
import { useStore } from './store.js'
import { countAdvancedChanges } from './views/PostInstallStep.js'

// 「同じステップに居るままプロファイルを開くと、折りたたみが閉じたまま」
//
// `Disclosure` は `changedCount` が **0 をまたいだとき**だけ開き直す。
// 件数が同じなら（2 → 2）何も起きない。
// `App` の `<ErrorBoundary key={…}>` がステップだけを見ていると、
// 同じステップに居たままプロファイルを差し替えても作り直されないので、
// **別のプロファイルの設定が折りたたみの中に隠れたまま**になる。
//
// ここは実物の `<App />` を描画して、実物の `openProfile` /
// `loadProfileFromDisk` / `newProfile` を通す。ハーネスを自作すると
// 「ハーネスは直したが App は直っていない」を見逃す。

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

/** `loadNamedProfile` / `loadProfile` が返すもの。テストごとに差し替える。 */
let nextProfile: AutoinstallProfile = createDefaultProfile('24.04')

beforeEach(() => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = {
    platform: 'win32',
    appVersion: '0.0.0-test',
    systemLocale: 'ja-JP',
    getSettings: async () => ({
      locale: 'ja',
      lastIsoDirectory: null,
      verifyAfterWrite: true,
      cidataSizeBytes: 64 * 1024 * 1024,
      auditRecord: false,
      commentLanguage: 'ja',
    }),
    saveSettings: async (s: unknown) => s,
    getWriteStatus: async () => ({ state: 'idle' }),
    onWriteStatus: () => undefined,
    onChecksumProgress: () => undefined,
    listProfiles: async () => [],
    generateConfig: async () => null,
    listDevices: async () => [],
    loadNamedProfile: async () => ({ profile: nextProfile, notes: [] }),
    loadProfile: async () => ({ profile: nextProfile, notes: [] }),
  }
  useStore.setState({
    ready: true,
    locale: 'ja',
    step: 'postinstall',
    profile: createDefaultProfile('24.04'),
    profileNotes: [],
    iso: null,
    config: null,
    writeStatus: { state: 'idle' },
    currentProfileId: null,
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
  act(() => root!.render(<App />))
  return host
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * 「上級者向け」の折りたたみボタン。`main` の中の `h3 > button` はこれだけ。
 * ヘッダやサイドバーのボタンを拾わないよう `main` に限定する。
 */
const toggleOf = (el: HTMLElement): HTMLButtonElement => {
  const buttons = [...el.querySelectorAll('main h3 button')]
  expect(buttons.length, '「上級者向け」の折りたたみがちょうど 1 つあること').toBe(1)
  return buttons[0] as HTMLButtonElement
}

const isOpen = (el: HTMLElement): boolean =>
  toggleOf(el).getAttribute('aria-expanded') === 'true'

/** 件数 2 のプロファイル A（起動オプションと生 YAML）。 */
function profileA(): AutoinstallProfile {
  const base = createDefaultProfile('24.04')
  return {
    ...base,
    advanced: { ...base.advanced, extraKernelArgs: 'nomodeset', rawOverlayYaml: 'shutdown: reboot' },
  }
}

/** 件数 2 のプロファイル B（**中身は A と全く違うが件数は同じ**）。 */
function profileB(): AutoinstallProfile {
  const base = createDefaultProfile('24.04')
  return {
    ...base,
    postInstall: { ...base.postInstall, collectLogsOnError: !base.postInstall.collectLogsOnError },
    behavior: { ...base.behavior, interactiveAll: !base.behavior.interactiveAll },
  }
}

describe('プロファイルを開き直したときの折りたたみ', () => {
  it('前提: A と B は件数が同じで中身が違う（この前提が崩れたら以下のテストは無意味）', () => {
    expect(countAdvancedChanges(profileA())).toBe(2)
    expect(countAdvancedChanges(profileB())).toBe(2)
    expect(profileA()).not.toEqual(profileB())
  })

  it('同じステップに居たまま別のプロファイルを開くと、折りたたみが開き直る', async () => {
    const el = render()

    // A を開く（件数 2 なので折りたたみは最初から開く）
    nextProfile = profileA()
    await act(async () => {
      await useStore.getState().openProfile('a')
    })
    expect(isOpen(el), 'A を開いた直後は開いている').toBe(true)

    // 利用者がたたむ
    click(toggleOf(el))
    expect(isOpen(el)).toBe(false)

    // ステップは動かさずに B を開く。件数は同じ 2 だが中身は別物。
    nextProfile = profileB()
    await act(async () => {
      await useStore.getState().openProfile('b')
    })
    expect(
      isOpen(el),
      '別のプロファイルを開いたのに閉じたまま。設定したはずのものが隠れる',
    ).toBe(true)
  })

  it('ファイルから開いた場合も同じ', async () => {
    const el = render()
    nextProfile = profileA()
    await act(async () => {
      await useStore.getState().openProfile('a')
    })
    click(toggleOf(el))
    expect(isOpen(el)).toBe(false)

    nextProfile = profileB()
    await act(async () => {
      await useStore.getState().loadProfileFromDisk()
    })
    expect(isOpen(el)).toBe(true)
  })

  it('新規プロファイルは件数 0 なので閉じたまま（開き直しても中身が無い）', async () => {
    const el = render()
    nextProfile = profileA()
    await act(async () => {
      await useStore.getState().openProfile('a')
    })
    expect(isOpen(el)).toBe(true)

    act(() => useStore.getState().newProfile())
    expect(isOpen(el), '既定に戻したのに開いたままだと「変更がある」ように見える').toBe(false)
  })

  it('画面を操作しただけでは作り直さない（入力途中の下書きを消さない）', async () => {
    const el = render()
    nextProfile = profileA()
    await act(async () => {
      await useStore.getState().openProfile('a')
    })
    click(toggleOf(el))
    expect(isOpen(el)).toBe(false)

    // 折りたたみの外にある設定を変えても、折りたたみは開かない
    act(() => {
      useStore.getState().updateProfile((p) => ({
        ...p,
        postInstall: { ...p.postInstall, presets: ['ssh-harden'] },
      }))
    })
    expect(isOpen(el), 'ただの編集で作り直すと入力途中の下書きが消える').toBe(false)
  })
})

// ---------------------------------------------------------------------------
// `key` を変えると `ErrorBoundary` ごと作り直される。その副作用を固定する。
// ---------------------------------------------------------------------------

/** React の制御された input に「本物の入力」を送る（state を直接いじらない）。 */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** 静的 IP のプロファイル。DNS 欄（`useListDraft`）を出すために必要。 */
function staticNetworkProfile(address: string): AutoinstallProfile {
  const base = createDefaultProfile('24.04')
  return {
    ...base,
    network: {
      mode: 'static',
      target: { kind: 'any' },
      address,
      gateway: '192.168.1.1',
      nameservers: ['1.1.1.1'],
      searchDomains: [],
      optional: false,
    },
  }
}

const dnsInput = (el: HTMLElement): HTMLInputElement => {
  const found = [...el.querySelectorAll<HTMLInputElement>('main input')].find((i) =>
    i.value.startsWith('1.1.1.1'),
  )
  expect(found, 'DNS の入力欄が見つからない').toBeTruthy()
  return found!
}

describe('画面を作り直す副作用', () => {
  it('入力途中の下書きは、ただの編集では消えない', () => {
    useStore.setState({
      step: 'network',
      profile: staticNetworkProfile('192.168.1.10/24'),
    })
    const el = render()
    // 区切り文字を打った直後は、正規化すると同じ配列に戻る（落とし穴 58）
    type(dnsInput(el), '1.1.1.1,')
    expect(dnsInput(el).value).toBe('1.1.1.1,')

    // 別の欄をいじる。ここで画面が作り直されると打ちかけの `,` が消える。
    act(() => {
      useStore.getState().updateProfile((p) => ({ ...p, hostname: 'srv-2' }))
    })
    expect(dnsInput(el).value, '編集のたびに画面を作り直してはいけない').toBe('1.1.1.1,')
  })

  it('プロファイルを開くと下書きは消える（そのプロファイルのものではないので正しい）', async () => {
    useStore.setState({
      step: 'network',
      profile: staticNetworkProfile('192.168.1.10/24'),
    })
    const el = render()
    type(dnsInput(el), '1.1.1.1,')

    nextProfile = staticNetworkProfile('10.0.0.5/24')
    await act(async () => {
      await useStore.getState().openProfile('other')
    })
    expect(dnsInput(el).value).toBe('1.1.1.1')
  })

  it('壊れたプロファイルで落ちた画面は、別のプロファイルを開けば戻る', async () => {
    // 「型は合っているが中身が違う」データは実際に届く（落とし穴 23）。
    // `presets` が配列でないと `new Set(...)` が投げる。
    const broken = {
      ...createDefaultProfile('24.04'),
      postInstall: { ...createDefaultProfile('24.04').postInstall, presets: 42 },
    } as unknown as AutoinstallProfile

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const el = render()
      nextProfile = broken
      await act(async () => {
        await useStore.getState().openProfile('broken')
      })
      expect(el.querySelector('main pre'), 'Error Boundary が受け止めていない').not.toBeNull()

      // ステップは動かさずに、まともなプロファイルを開く
      nextProfile = profileA()
      await act(async () => {
        await useStore.getState().openProfile('a')
      })
      expect(el.querySelector('main pre'), 'エラー表示から戻れない').toBeNull()
      expect(isOpen(el)).toBe(true)
    } finally {
      errors.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// 世代カウンタを入れても、`Disclosure` の「0 をまたいだら開く」は残す。
// ---------------------------------------------------------------------------
//
// 世代カウンタが見るのは**プロファイルの差し替え**だけ。
// 折りたたみの**外**にある操作が、折りたたみの**中**の設定を変えることがあり、
// そこは世代では拾えない。
//
// 実在するのがネットワークの「設定方法」で、`raw`（生の netplan）を選ぶと
// 件数が 0 → 1 になる。選択のラジオは折りたたみの外、YAML の編集欄は中。
// `NetworkStep` の `<Disclosure>` は `key` も `defaultOpen` も持たないので、
// `ui.tsx` の `hadChanges` の useEffect が無いと**閉じたまま**になり、
// 「生の netplan を選んだのに編集欄が無い」になる
// （`StorageStep` は同じ問題を自前の `key` で回避しているが、こちらは違う）。
//
// **このテストが落ちたら `hadChanges` の useEffect を消してはいけない。**

describe('折りたたみの外の操作で中身が変わったとき', () => {
  it('設定方法を「生の netplan」にすると、閉じていた折りたたみが開く', () => {
    useStore.setState({ step: 'network', profile: createDefaultProfile('24.04') })
    const el = render()
    expect(isOpen(el), '既定は件数 0 なので閉じている').toBe(false)

    // ラジオは `value` 属性を持たないので**表示名**で選ぶ（利用者と同じ手掛かり）。
    const ja = createTranslator('ja')
    const label = [...el.querySelectorAll('main label')].find((l) =>
      l.textContent?.includes(ja('network.modeRaw')),
    )
    expect(label, '設定方法の選択欄が見つからない').toBeTruthy()
    const raw = label!.querySelector('input[type="radio"]') as HTMLInputElement | null
    expect(raw).not.toBeNull()
    act(() => {
      raw!.click()
    })

    expect(
      isOpen(el),
      '生の netplan を選んだのに折りたたんだまま。編集欄に辿り着けない',
    ).toBe(true)
    expect(el.querySelector('main textarea'), 'YAML の編集欄が出ていない').not.toBeNull()
  })
})
