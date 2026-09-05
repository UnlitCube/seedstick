import { describe, expect, it } from 'vitest'
import { en, formatLocalized, ja, localized, type MsgKey } from '@autoinstall/shared'
import { assertDeviceIsWritable, DeviceRejectedError, runWorkerJob, type WorkerReporter } from './run.js'
import type { PlatformOps, RemovableDevice } from '../platform/index.js'
import type { WorkerJob, WorkerMessage } from './protocol.js'

// 昇格ワーカーは通常権限のユーザーが書ける JSON を唯一の入力として受け取る。
// UAC の確認が出ている間にそれを差し替えられても、書く前に止まらなければ
// 「ユーザーの『はい』」がシステムディスクの破壊に化ける。
// ここでは再検証のふるまいを、偽のプラットフォームで確かめる。

const DEVICE_PATH = '\\\\.\\PhysicalDrive9'
const DEVICE_SIZE = 32_000_000_000
const DEVICE_SERIAL = 'TESTSERIAL'
const DEVICE_DESCRIPTION = 'KIOXIA TransMemory 31GB'

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    jobId: 'j1',
    isoPath: 'C:/nonexistent.iso',
    devicePath: DEVICE_PATH,
    deviceSizeBytes: DEVICE_SIZE,
    deviceSerial: DEVICE_SERIAL,
    deviceDescription: DEVICE_DESCRIPTION,
    patches: [],
    seedFiles: [],
    cidataSizeBytes: 64 * 1024 * 1024,
    hideIsoPartitionFromWindows: true,
    verify: false,
    timestampIso: '2026-09-04T00:00:00.000Z',
    randomSeedBase64: 'AAAA',
    reportPort: 1,
    reportToken: 't',
    ...overrides,
  }
}

/** ジョブと一致する「正しい書き込み先」。各テストは 1 か所だけずらす。 */
function device(overrides: Partial<RemovableDevice> = {}): RemovableDevice {
  return {
    id: DEVICE_PATH,
    description: DEVICE_DESCRIPTION,
    sizeBytes: DEVICE_SIZE,
    bus: 'usb',
    removable: true,
    isSystem: false,
    mountpoints: ['F:\\'],
    serial: DEVICE_SERIAL,
    readOnly: false,
    selectable: true,
    blockedReason: null,
    ...overrides,
  }
}

/** 列挙だけを差し替えたフェイク。書き込み系は呼ばれたら分かるようにしておく。 */
function fakePlatform(devices: RemovableDevice[]): PlatformOps & { listCalls: number } {
  const ops = {
    listCalls: 0,
    listDevices: async (): Promise<RemovableDevice[]> => {
      ops.listCalls += 1
      return devices
    },
    prepareForWrite: async (): Promise<void> => {
      throw new Error('デバイス検証のテストで prepareForWrite が呼ばれた')
    },
    finishWrite: async (): Promise<void> => {
      throw new Error('デバイス検証のテストで finishWrite が呼ばれた')
    },
    hasWriteAccess: async (): Promise<boolean> => true,
  }
  return ops
}

/** 拒否されることを前提に、その例外を取り出す。通ってしまったらテストを落とす。 */
async function rejectionOf(platform: PlatformOps, j: WorkerJob): Promise<Error> {
  try {
    await assertDeviceIsWritable(platform, j)
  } catch (e) {
    return e as Error
  }
  throw new Error('assertDeviceIsWritable が拒否しなかった（書き込みに進んでしまう）')
}

/**
 * 文面そのものは固定しない（実装の形をテストで固めない）。求めるのは 3 つ。
 *  - `DeviceRejectedError` で止まること
 *  - 画面に出る総括が**訳せる形**で運ばれ、期待したキーであること
 *    （日本語の文字列を直接持たせると英語表示で日本語のまま出る）
 *  - 開発者向けの `message` に「どのデバイスが・何と食い違ったのか」が残ること
 */
function expectRejected(err: Error, key: MsgKey, mustMention: string[]): void {
  expect(err).toBeInstanceOf(DeviceRejectedError)
  const rejected = err as DeviceRejectedError
  expect(rejected.text.key).toBe(key)
  // どちらの言語でも「どのデバイスか」は出る（文面は固定しない）
  expect(formatLocalized('ja', rejected.text)).toContain(DEVICE_PATH)
  expect(formatLocalized('en', rejected.text)).toContain(DEVICE_PATH)
  // 英語の**ひな型**に日本語が残らないこと（訳し忘れの検出）。
  // 差し込む値そのもの（デバイスの表示名など）は日本語でありうるので、
  // params を外したひな型だけを見る。
  expect(formatLocalized('en', localized(rejected.text.key))).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
  // IPC / NDJSON を通るので JSON 往復で同じものになること
  expect(JSON.parse(JSON.stringify(rejected.text))).toEqual(rejected.text)
  expect(err.message.length).toBeGreaterThan(0)
  expect(err.message).toContain(DEVICE_PATH)
  for (const s of mustMention) expect(err.message).toContain(s)
}

function collector(): { reporter: WorkerReporter; messages: WorkerMessage[] } {
  const messages: WorkerMessage[] = []
  return {
    messages,
    reporter: {
      send: (m) => messages.push(m),
      onControl: () => {},
      close: () => {},
    },
  }
}

describe('DeviceRejectedError', () => {
  it('書き込みを止めるためのエラー型が公開されている', () => {
    const e = new DeviceRejectedError('x', localized('device.rejectedNotFound', { path: 'p' }))
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('DeviceRejectedError')
    // 開発者向けの message は残す（ログとワーカーの stderr が読む）
    expect(e.message).toBe('x')
    // 画面用は訳せる形で別に持つ
    expect(e.text).toEqual({ key: 'device.rejectedNotFound', params: { path: 'p' } })
  })
})

describe('assertDeviceIsWritable — 差し替えられたジョブを拒否する', () => {
  it('指示書のデバイスが列挙に無い', async () => {
    // 抜かれた／そもそも候補として出せないデバイスを指しているジョブ。
    // 別のデバイスは見えているので「列挙が空だから落ちた」ではない。
    const platform = fakePlatform([device({ id: '\\\\.\\PhysicalDrive0', serial: 'OTHER' })])
    const err = await rejectionOf(platform, job())
    expectRejected(err, 'device.rejectedNotFound', [])
  })

  it('列挙にはあるが selectable: false（システムディスク等）', async () => {
    const blocked = device({ selectable: false, blockedReason: localized('device.blockedSystemDisk') })
    const err = await rejectionOf(fakePlatform([blocked]), job())
    expectRejected(err, 'device.rejectedNotWritable', ['OS が入っているシステムディスクです'])
    // **理由まで画面に届くこと。** ここは「差し替えられたジョブを止めた」ことを
    // 説明する最後の場所で、理由が無いと利用者は次の操作を選べない。
    // 一度、理由を開発者向けの message にだけ残す形にして、英語の画面から
    // 理由が消えていた。両方の言語で理由が出ることを固定する。
    const text = (err as DeviceRejectedError).text
    expect(formatLocalized('ja', text)).toContain(ja['device.blockedSystemDisk'])
    expect(formatLocalized('en', text)).toContain(en['device.blockedSystemDisk'])
    expect(formatLocalized('en', text)).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
  })

  it('拒否理由が取れないときは、理由を含まないキーに落とす', () => {
    // 理由が無いのに `{reason}` を持つキーを使うと、画面に `{reason}` が出る。
    expect(formatLocalized('en', localized('device.rejectedNotWritableUnknown', { path: 'p' })))
      .not.toContain('{')
  })

  it('容量が指示書と違う', async () => {
    const err = await rejectionOf(fakePlatform([device({ sizeBytes: DEVICE_SIZE + 4096 })]), job())
    // 開発者向けには生のバイト数（どちらが変わったのか judge できる）
    expectRejected(err, 'device.rejectedSizeMismatch', [String(DEVICE_SIZE), String(DEVICE_SIZE + 4096)])
    // 画面には読める単位で出すが、生のバイト数も併記する。
    // 単位だけだと数 KB の食い違いが「32.0 GB / 32.0 GB」になり、
    // 「なぜ止まったのか分からない」画面になる。
    const shown = formatLocalized('en', (err as DeviceRejectedError).text)
    expect(shown).toContain('32.0 GB')
    expect(shown).toContain(String(DEVICE_SIZE))
    expect(shown).toContain(String(DEVICE_SIZE + 4096))
  })

  it('容量は同じだがシリアルが違う（挿し替えられた）', async () => {
    const swapped = device({ serial: 'DIFFERENT-SERIAL' })
    const err = await rejectionOf(fakePlatform([swapped]), job())
    expectRejected(err, 'device.rejectedSerialMismatch', [DEVICE_SERIAL, 'DIFFERENT-SERIAL'])
    // 両方のシリアルが画面にも出る
    const shown = formatLocalized('en', (err as DeviceRejectedError).text)
    expect(shown).toContain(DEVICE_SERIAL)
    expect(shown).toContain('DIFFERENT-SERIAL')
  })

  it('シリアルが指示書にあるのに列挙で読めない', async () => {
    // 「実際 不明」を差し込みで作ると英語表示に日本語が混ざるので、別のキーになる。
    const err = await rejectionOf(fakePlatform([device({ serial: null })]), job())
    expectRejected(err, 'device.rejectedSerialMissing', [DEVICE_SERIAL])
  })

  it('シリアルが取れない環境で description が違う', async () => {
    // 一部の USB ブリッジはシリアルを返さない。ジョブ側も null になるので、
    // 代わりに表示名で見分ける。
    const swapped = device({ serial: null, description: '別のディスク' })
    const err = await rejectionOf(fakePlatform([swapped]), job({ deviceSerial: null }))
    expectRejected(err, 'device.rejectedDescriptionMismatch', [DEVICE_DESCRIPTION, '別のディスク'])
  })
})

describe('assertDeviceIsWritable — 正しい相手には通す', () => {
  it('すべて一致すれば通る', async () => {
    const platform = fakePlatform([device({ id: '\\\\.\\PhysicalDrive0', serial: 'OTHER' }), device()])
    await expect(assertDeviceIsWritable(platform, job())).resolves.toBeUndefined()
    // 「何も見ずに通した」のではないこと
    expect(platform.listCalls).toBe(1)
  })

  it('シリアルが null で description が一致すれば通る', async () => {
    // ここを塞ぐと、シリアルを返さない USB ブリッジでは一切書き込めなくなる。
    const platform = fakePlatform([device({ serial: null })])
    await expect(assertDeviceIsWritable(platform, job({ deviceSerial: null }))).resolves.toBeUndefined()
  })
})

describe('ジョブの差し替え検知（経路）', () => {
  // ISO を開く前にデバイス検証まで到達しないので、ここでは
  // 「ISO が開けない」で落ちること＝検証が ISO の後にあることの確認に留める。
  // 実際の検証ロジックは上の assertDeviceIsWritable のテストで確かめる。
  it('存在しない ISO では書き込みに進まない', async () => {
    const { reporter, messages } = collector()
    await expect(runWorkerJob(job(), reporter)).rejects.toBeInstanceOf(Error)
    expect(messages.some((m) => m.type === 'hello')).toBe(true)
  })
})
