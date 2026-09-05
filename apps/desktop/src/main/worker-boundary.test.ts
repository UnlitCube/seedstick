import { describe, expect, it } from 'vitest'
import {
  classifyDevice,
  DeviceRejectedError,
  assertDeviceIsWritable,
  type PlatformOps,
  type RemovableDevice,
  type WorkerJob,
} from '@autoinstall/media'
import { formatLocalized, isLocalizedText, localized, ja, en } from '@autoinstall/shared'
import { displayTextOf } from './worker-message.js'

// ワーカーは**別プロセス**で、画面に出す文言は NDJSON で親へ渡る。
// その境界で形を検査しているので、**検査が契約より狭いと文言が黙って捨てられる**。
//
// 実際に一度そうなった: `MsgParams` に入れ子の `LocalizedText` を許したあとも、
// ワーカー側の検査だけが `params` を `string | number` に限っていたため、
// 「\.\PhysicalDrive1 には書き込めません: OS が入っているシステムディスクです」が
// 境界で捨てられ、画面には「予期しないエラーが発生しました」だけが出ていた。
//
// **`assertDeviceIsWritable` を直接呼んで文面を見るテストは、これを検出できない。**
// 境界を通っていないからで、緑のまま画面だけが壊れる（落とし穴 56）。
// ここでは必ず境界（`displayTextOf` → JSON 往復）を通す。

function device(over: Partial<RemovableDevice> = {}): RemovableDevice {
  return classifyDevice({
    id: '\\.\PhysicalDrive1',
    description: 'KIOXIA TransMemory',
    sizeBytes: 32_000_000_000,
    bus: 'usb',
    removable: true,
    readOnly: false,
    isSystem: false,
    serial: 'SERIAL-1',
    mountpoints: [],
    ...over,
  })
}

function job(over: Partial<WorkerJob> = {}): WorkerJob {
  return {
    jobId: 'j',
    isoPath: 'x.iso',
    devicePath: '\\.\PhysicalDrive1',
    deviceSizeBytes: 32_000_000_000,
    deviceSerial: 'SERIAL-1',
    deviceDescription: 'KIOXIA TransMemory',
    ...over,
  } as WorkerJob
}

function fakePlatform(devices: RemovableDevice[]): PlatformOps {
  return {
    listDevices: async () => devices,
    hasWriteAccess: async () => true,
    prepareForWrite: async () => undefined,
    finishWrite: async () => undefined,
  } as unknown as PlatformOps
}

/** ワーカーが実際に送る形にする（`displayTextOf` → NDJSON の JSON 往復）。 */
function throughBoundary(err: Error): unknown {
  return JSON.parse(JSON.stringify(displayTextOf(err)))
}

describe('ワーカー境界を通っても文言が残る', () => {
  it('入れ子の理由つき拒否が、境界で「予期しないエラー」に落ちない', async () => {
    const blocked = device({ isSystem: true })
    let err: Error | null = null
    try {
      await assertDeviceIsWritable(fakePlatform([blocked]), job())
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(DeviceRejectedError)

    const sent = throughBoundary(err!)
    // 汎用のキーに落ちていないこと（落ちると「なぜ止めたか」が画面から消える）
    expect(sent).not.toEqual(localized('error.unknown'))
    expect(isLocalizedText(sent, true)).toBe(true)

    // 両方の言語で、**理由まで**読めること
    const text = sent as Parameters<typeof formatLocalized>[1]
    expect(formatLocalized('ja', text)).toContain(ja['device.blockedSystemDisk'])
    expect(formatLocalized('en', text)).toContain(en['device.blockedSystemDisk'])
    expect(formatLocalized('en', text)).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
  })

  it('入れ子でない拒否も従来どおり通る', async () => {
    let err: Error | null = null
    try {
      await assertDeviceIsWritable(fakePlatform([device({ serial: 'OTHER' })]), job())
    } catch (e) {
      err = e as Error
    }
    const sent = throughBoundary(err!)
    expect(sent).not.toEqual(localized('error.unknown'))
    expect(isLocalizedText(sent, true)).toBe(true)
  })

  it('総括を持たない素の Error は「予期しないエラー」に落とす', () => {
    // ここは落とすのが正しい（生の内容は detail で別に運ばれる）
    expect(throughBoundary(new Error('ENOENT: no such file'))).toEqual(localized('error.unknown'))
  })

  it('text を名乗る壊れた値は通さない', () => {
    for (const bad of [{}, null, 'text', { key: 42 }, { key: 'k', params: [1] }, { key: '' }]) {
      const e = Object.assign(new Error('x'), { text: bad })
      expect(throughBoundary(e), JSON.stringify(bad)).toEqual(localized('error.unknown'))
    }
  })

  it('深すぎる入れ子は通さない（展開できない形を送らない）', () => {
    let text: unknown = localized('common.next')
    for (let i = 0; i < 8; i++) text = { key: 'device.rejectedNotWritable', params: { path: 'p', reason: text } }
    const e = Object.assign(new Error('x'), { text })
    expect(throughBoundary(e)).toEqual(localized('error.unknown'))
  })
})
