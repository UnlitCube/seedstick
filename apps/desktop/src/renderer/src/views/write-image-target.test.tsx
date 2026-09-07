// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createDefaultProfile,
  createTranslator,
  type AppSettings,
  type DeviceInfo,
  type GeneratedConfig,
  type ImageTarget,
  type IsoFileInfo,
  type WriteStatus,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { WriteStep } from './WriteStep.js'

// ---------------------------------------------------------------------------
// 書き込み画面の「イメージファイル (.img) として保存」の導線。
//
// ここで固定するのは 5 つ。
//
//   1. 使えない状況（ISO 未選択・設定エラー）でも**隠さず、理由を出す**（落とし穴 61）
//   2. 押すと `chooseImagePath` →（選ばれたら）`startImageWrite` が呼ばれる。
//      ダイアログをキャンセルしたら何も始まらない
//   3. **実デバイスの「書き込みを開始」と取り違えない。**
//      イメージのボタンは `startWrite` を呼ばず、「消去」の確認も出さない。
//      逆に実デバイスのボタンは `startImageWrite` を呼ばない
//   4. デバイスが 1 台も無い状態でも見つかる（USB を持っていない人の唯一の出口）
//   5. 終わったら**保存先のパスが画面に出る**。中止のときに
//      「USB メモリの内容は壊れています」を出さない（ファイルは main が消している）
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')

const ISO: IsoFileInfo = {
  path: 'C:\\iso\\ubuntu-24.04.3-live-server-amd64.iso',
  fileName: 'ubuntu-24.04.3-live-server-amd64.iso',
  sizeBytes: 3_000_000_000,
  volumeId: 'Ubuntu-Server 24.04.3 LTS amd64',
  diskInfo: null,
  identity: { series: '24.04', version: '24.04.3', arch: 'amd64', isLts: true },
  grubCfg: '',
  patchedGrubCfg: '',
  casperFiles: [],
  minimumDeviceBytes: 3_300_000_000,
}

const OK_CONFIG: GeneratedConfig = {
  userData: '#cloud-config\n',
  metaData: '',
  autoinstallYaml: '',
  issues: [],
  ok: true,
  unattended: true,
  payloadBytes: 0,
  missingSources: [],
  patchedGrubCfg: null,
  grubFreeBytes: 1000,
  grubTooLarge: false,
}

const SETTINGS: AppSettings = {
  locale: 'ja',
  lastIsoDirectory: null,
  verifyAfterWrite: true,
  cidataSizeBytes: 64 * 1024 * 1024,
  auditRecord: false,
  commentLanguage: 'ja',
}

const USB: DeviceInfo = {
  id: '\\\\.\\PhysicalDrive2',
  description: 'KIOXIA TransMemory',
  sizeBytes: 31_000_000_000,
  bus: 'usb',
  removable: true,
  isSystem: false,
  mountpoints: [],
  serial: 'FAKE-0001',
  selectable: true,
  blockedReason: null,
}

const TARGET: ImageTarget = {
  path: 'D:\\out\\srv-01.img',
  fileName: 'srv-01.img',
  freeBytes: 100_000_000_000,
}

interface Api {
  chooseImagePath: ReturnType<typeof vi.fn>
  startImageWrite: ReturnType<typeof vi.fn>
  startWrite: ReturnType<typeof vi.fn>
  cancelWrite: ReturnType<typeof vi.fn>
  listDevices: ReturnType<typeof vi.fn>
  generateConfig: ReturnType<typeof vi.fn>
  getSettings: ReturnType<typeof vi.fn>
  saveSettings: ReturnType<typeof vi.fn>
}

let api: Api
let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  api = {
    chooseImagePath: vi.fn(async () => TARGET),
    startImageWrite: vi.fn(async () => ({ started: true })),
    startWrite: vi.fn(async () => ({ started: true })),
    cancelWrite: vi.fn(async () => undefined),
    listDevices: vi.fn(async () => []),
    generateConfig: vi.fn(async () => OK_CONFIG),
    getSettings: vi.fn(async () => SETTINGS),
    saveSettings: vi.fn(async () => SETTINGS),
  }
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = api
  useStore.setState({
    locale: 'ja',
    profile: createDefaultProfile('24.04'),
    iso: ISO,
    config: OK_CONFIG,
    settings: SETTINGS,
    devices: [],
    devicesBusy: false,
    selectedDeviceId: null,
    writeStatus: { state: 'idle' },
    imageTarget: null,
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
  act(() => root!.render(<WriteStep />))
  return host
}

const buttons = (el: HTMLElement): HTMLButtonElement[] => [
  // モーダルは createPortal で document.body に出るので、そちらも見る。
  ...(el.querySelectorAll('button') as unknown as HTMLButtonElement[]),
]

function byLabel(el: HTMLElement, label: string): HTMLButtonElement | null {
  return buttons(el).find((b) => (b.textContent ?? '').includes(label)) ?? null
}

/** 「イメージファイルとして保存…」のボタン。 */
function imageButton(el: HTMLElement): HTMLButtonElement {
  const b = byLabel(el, t('image.saveButton'))
  expect(b, 'イメージ保存のボタンが無い').not.toBeNull()
  return b!
}

/** 実デバイスの「書き込みを開始」（確認モーダルを開く方）。 */
function deviceButton(el: HTMLElement): HTMLButtonElement {
  const b = byLabel(el, t('write.start'))
  expect(b, '「書き込みを開始」のボタンが無い').not.toBeNull()
  return b!
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** クリックの結果、非同期のストア処理が終わるまで待つ。 */
async function clickAsync(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

function setStatus(writeStatus: WriteStatus): void {
  act(() => {
    useStore.setState({ writeStatus })
  })
}

describe('使えない状況でも隠さず、理由を出す（落とし穴 61）', () => {
  it('ISO を選んでいないとき: ボタンはあるが押せず、理由が出る', () => {
    useStore.setState({ iso: null })
    const el = render()
    expect(imageButton(el).disabled).toBe(true)
    expect(el.textContent, '押せない理由が画面に無い').toContain(t('image.needIso'))
  })

  it('設定にエラーがあるとき: 押せず、直す場所が分かる文が出る', () => {
    useStore.setState({ config: { ...OK_CONFIG, ok: false } })
    const el = render()
    expect(imageButton(el).disabled).toBe(true)
    expect(el.textContent).toContain(t('image.needConfig'))
    // ISO はあるので ISO の理由は出さない（理由を 2 つ並べない）
    expect(el.textContent).not.toContain(t('image.needIso'))
  })

  it('ISO と設定がそろえば押せる（デバイスを 1 台も選んでいなくても）', () => {
    const el = render()
    expect(useStore.getState().selectedDeviceId).toBeNull()
    expect(imageButton(el).disabled).toBe(false)
  })

  it('書き込み中は押せない（2 本目を割り込ませない）', () => {
    const el = render()
    setStatus({
      state: 'writing',
      phase: 'writing',
      bytesDone: 1,
      bytesTotal: 2,
      label: { key: 'write.writing' },
      bytesPerSecond: null,
      etaSeconds: null,
    })
    expect(imageButton(el).disabled).toBe(true)
  })
})

describe('押したときに呼ばれるもの', () => {
  it('保存先を選ぶと startImageWrite が設定どおりの引数で呼ばれる', async () => {
    const el = render()
    await clickAsync(imageButton(el))

    expect(api.chooseImagePath).toHaveBeenCalledTimes(1)
    // 既定のファイル名の希望はホスト名。安全な名前に直すのは main の仕事。
    expect(api.chooseImagePath.mock.calls[0]![0]).toBe(
      useStore.getState().profile.basics.hostname,
    )

    expect(api.startImageWrite).toHaveBeenCalledTimes(1)
    expect(api.startImageWrite.mock.calls[0]![0]).toMatchObject({
      isoPath: ISO.path,
      imagePath: TARGET.path,
      verify: SETTINGS.verifyAfterWrite,
      cidataSizeBytes: SETTINGS.cidataSizeBytes,
      auditRecord: SETTINGS.auditRecord,
    })
  })

  it('保存ダイアログをキャンセルしたら何も始まらない', async () => {
    api.chooseImagePath.mockResolvedValue(null)
    const el = render()
    await clickAsync(imageButton(el))
    expect(api.chooseImagePath).toHaveBeenCalledTimes(1)
    expect(api.startImageWrite, 'キャンセルしたのに書き出しが始まった').not.toHaveBeenCalled()
    expect(useStore.getState().imageTarget).toBeNull()
  })

  it('始められなかったら理由が画面に出る（黙って無反応にしない）', async () => {
    api.startImageWrite.mockResolvedValue({
      started: false,
      message: { key: 'image.noSpace', params: { required: '3.3 GB', free: '1.0 GB' } },
      detail: null,
    })
    const el = render()
    await clickAsync(imageButton(el))
    expect(el.textContent).toContain(t('image.noSpace', { required: '3.3 GB', free: '1.0 GB' }))
  })
})

describe('実デバイスの「書き込みを開始」と取り違えない', () => {
  it('イメージのボタンは startWrite を呼ばず、「消去」の確認も出さない', async () => {
    useStore.setState({ devices: [USB], selectedDeviceId: USB.id })
    const el = render()
    await clickAsync(imageButton(el))

    expect(api.startWrite, 'イメージのボタンがデバイスへ書き込もうとした').not.toHaveBeenCalled()
    // 確認モーダルは createPortal で document.body に出る。開いていないこと。
    expect(document.body.textContent).not.toContain(t('write.confirmTypeHint'))
  })

  it('実デバイスのボタンは確認モーダルを開くだけで、startImageWrite を呼ばない', () => {
    useStore.setState({ devices: [USB], selectedDeviceId: USB.id })
    const el = render()
    click(deviceButton(el))

    expect(document.body.textContent, '「消去」の確認が出ていない').toContain(
      t('write.confirmTypeHint'),
    )
    expect(api.startImageWrite).not.toHaveBeenCalled()
    expect(api.startWrite, '確認を通す前に書き込みが始まった').not.toHaveBeenCalled()
  })

  it('2 つのボタンは別物として区別できる（同じ見た目にしない）', () => {
    useStore.setState({ devices: [USB], selectedDeviceId: USB.id })
    const el = render()
    const image = imageButton(el)
    const device = deviceButton(el)
    expect(image).not.toBe(device)
    // 実デバイス側は danger（赤）、イメージ側は secondary（枠だけ）。
    expect(device.className, '実デバイスのボタンが danger でない').toContain('bg-rose-600')
    expect(image.className, 'イメージのボタンが実デバイスと同じ赤になっている').not.toContain(
      'bg-rose-600',
    )
  })
})

describe('デバイスが 1 台も無いとき', () => {
  it('イメージ保存の導線が見つかる（USB を持っていない人の唯一の出口）', () => {
    useStore.setState({ devices: [], devicesBusy: false })
    const el = render()
    expect(el.textContent).toContain(t('write.noDevices'))
    // 「デバイスがありません」で行き止まりにしない
    expect(el.textContent, 'イメージ保存への案内が無い').toContain(t('write.noDevicesImage'))
    expect(imageButton(el).disabled).toBe(false)
  })
})

describe('終わったあとの表示', () => {
  it('保存先のパスが出る（どこに保存されたか分からない、を作らない）', () => {
    const el = render()
    setStatus({
      state: 'done',
      digest: 'x',
      bytesWritten: 3_300_000_000,
      verified: true,
      elapsedMs: 61_000,
      outputPath: TARGET.path,
    })
    expect(el.textContent).toContain(TARGET.path)
    expect(el.textContent).toContain(t('image.doneTitle'))
    // USB を「取り外して挿す」案内は出さない（焼いてから挿す）
    expect(el.textContent).toContain(t('image.next1'))
    expect(el.textContent).not.toContain(t('write.next1'))
  })

  it('デバイスへ書いたときは今までどおりの完了画面（outputPath は載らない）', () => {
    const el = render()
    setStatus({
      state: 'done',
      digest: 'x',
      bytesWritten: 3_300_000_000,
      verified: true,
      elapsedMs: 61_000,
    })
    expect(el.textContent).toContain(t('write.done'))
    expect(el.textContent).toContain(t('write.next1'))
    expect(el.textContent).not.toContain(t('image.doneTitle'))
    expect(el.textContent).not.toContain(t('image.next1'))
  })

  it('イメージを中止したら「USB の内容は壊れています」と言わない', async () => {
    const el = render()
    await clickAsync(imageButton(el))
    setStatus({ state: 'cancelled' })
    expect(el.textContent).toContain(t('image.cancelledBody'))
    expect(el.textContent, '消したファイルの心配をさせている').not.toContain(
      t('write.cancelledBody'),
    )
  })

  it('デバイスを中止したときは今までどおりの文面', () => {
    useStore.setState({ devices: [USB], selectedDeviceId: USB.id })
    const el = render()
    setStatus({ state: 'cancelled' })
    expect(el.textContent).toContain(t('write.cancelledBody'))
    expect(el.textContent).not.toContain(t('image.cancelledBody'))
  })

  it('イメージを作ったあとにデバイスへ書くと、文面はデバイス向けに戻る', async () => {
    useStore.setState({ devices: [USB], selectedDeviceId: USB.id })
    const el = render()
    // 1 本目: イメージファイル
    await clickAsync(imageButton(el))
    expect(useStore.getState().imageTarget).not.toBeNull()

    // 2 本目: 実デバイス（確認モーダルは別のテストで見ているのでストア経由で始める）
    await act(async () => {
      await useStore.getState().startWrite()
    })
    expect(api.startWrite).toHaveBeenCalledTimes(1)
    expect(
      useStore.getState().imageTarget,
      'デバイスへ書き始めたのに、前回の書き出し先が残っている',
    ).toBeNull()

    setStatus({ state: 'cancelled' })
    expect(el.textContent, '消したはずのイメージファイルの話をしている').not.toContain(
      t('image.cancelledBody'),
    )
    expect(el.textContent).toContain(t('write.cancelledBody'))
  })
})

describe('準備中の表示', () => {
  it('イメージでは権限の話を出さない（昇格しないので UAC は出ない）', async () => {
    const el = render()
    await clickAsync(imageButton(el))
    setStatus({ state: 'preparing', message: { key: 'image.statusPreparing' } })
    expect(el.textContent).toContain(t('image.statusPreparing'))
    expect(el.textContent, '出ない UAC を待たせている').not.toContain(t('write.elevationAllow'))
    expect(el.textContent).toContain(t('image.destination', { path: TARGET.path }))
  })

  it('デバイスでは今までどおり権限の案内を出す', () => {
    useStore.setState({ devices: [USB], selectedDeviceId: USB.id })
    const el = render()
    setStatus({ state: 'preparing', message: { key: 'write.statusCheckingPrivileges' } })
    expect(el.textContent).toContain(t('write.elevationAllow'))
  })
})
