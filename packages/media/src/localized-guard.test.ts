import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  en,
  formatLocalized,
  ja,
  localized,
  LOCALES,
  placeholdersOf,
  type LocalizedText,
  type MsgKey,
} from '@autoinstall/shared'
import { MemoryBlockDevice, SECTOR_SIZE, SparseFixtureDevice } from './blockdev/index.js'
import { buildIsoPatches, inspectIso } from './isopatch/index.js'
import { LayoutError, planUsbLayout } from './layout/plan.js'
import { classifyDevice, MAX_DEVICE_BYTES, MIN_DEVICE_BYTES } from './platform/types.js'
import type { DeviceBus, PlatformOps, RemovableDevice } from './platform/index.js'
import { assertDeviceIsWritable, DeviceRejectedError } from './worker/run.js'
import type { WorkerJob } from './worker/protocol.js'

// ===========================================================================
// GUI へ渡る文言の番人（main / @autoinstall/media 側）
// ===========================================================================
//
// main と media は利用者の言語を知らない（昇格ワーカーは別プロセスで locale を
// 持たない）ので、画面に出る文言は必ず `LocalizedText`（キー + 差し込み値）で運び、
// renderer が訳す。**新しいエラーを足すとき日本語を直書きするのが一番速い**ので、
// この規約は放っておけば必ず退行する。人が見張るのをやめ、機械に見張らせる。
//
// renderer 側の同じ趣旨の検査は
// `apps/desktop/src/renderer/src/lib/i18n.test.ts` にある。作りを合わせてある
// （ソース走査 + コメント除去 + 理由つきの許可リスト + 「死んだ例外」の検出）。
//
// このファイルが見ているもの:
//   1. **実行時の契約** — 型は `as` で抜けられるし、NDJSON から届く JSON は
//      そもそも型検査を通らない。実際に値を作らせて形とキーを確かめる。
//   2. **ソースの直書き** — `localized(` の第 1 引数、および
//      `message:` / `label:` / `blockedReason:` に日本語のリテラルが無いこと。
//
// main 側の実行時の契約（`SeedBuildError` / ISO の拒否理由）は
// `apps/desktop/src/main/localized-guard.test.ts` にある
// （media から desktop を import させないため。依存の向きは media ← desktop）。

// ---------------------------------------------------------------------------
// 共通のアサーション
// ---------------------------------------------------------------------------

/** 日本語（かな・カナ・漢字）。全角約物は shared の i18n.test.ts が別に見ている。 */
const JAPANESE = /[぀-ヿ一-鿿]/u

const dict = (locale: 'ja' | 'en'): Record<string, string | undefined> =>
  (locale === 'ja' ? ja : en) as unknown as Record<string, string | undefined>

/**
 * `LocalizedText` が「IPC / NDJSON を通せる純粋なデータ」で、かつ
 * **両方の辞書に実在するキー**であることを確かめる。
 *
 * キーが辞書に無いと `createTranslator` はキー名をそのまま返す。
 * 画面には `device.blockedFoo` のような英数字が出るので、
 * 「英語に日本語が残っていないか」だけを見る検査は**素通りする**。
 * ここで実在を見るのはそのため。
 */
function assertLocalized(text: unknown, where: string, depth = 0): asserts text is LocalizedText {
  expect(depth, `${where}: 差し込みの入れ子が深すぎる`).toBeLessThan(4)
  expect(typeof text, `${where}: LocalizedText ではない`).toBe('object')
  expect(text, `${where}: null`).not.toBeNull()
  expect(Array.isArray(text), `${where}: 配列`).toBe(false)
  const t = text as { key?: unknown; params?: unknown }
  expect(typeof t.key, `${where}: key が文字列でない`).toBe('string')
  // 余計なキーを持たないこと（JSON 往復で落ちるものを持ち込ませない）
  expect(Object.keys(t as object).sort(), `${where}: 想定外のプロパティ`).toEqual(
    t.params === undefined ? ['key'] : ['key', 'params'],
  )
  const key = t.key as string
  expect(dict('ja')[key], `${where}: ja に "${key}" が無い（画面にキー名が出る）`).toBeTypeOf(
    'string',
  )
  expect(dict('en')[key], `${where}: en に "${key}" が無い（画面にキー名が出る）`).toBeTypeOf(
    'string',
  )
  if (t.params !== undefined) {
    expect(typeof t.params, `${where}: params がオブジェクトでない`).toBe('object')
    expect(t.params, `${where}: params が null`).not.toBeNull()
    expect(Array.isArray(t.params), `${where}: params が配列`).toBe(false)
    for (const [name, value] of Object.entries(t.params as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') continue
      // 入れ子の LocalizedText だけを許す（関数・undefined・配列は JSON で別物になる）
      assertLocalized(value, `${where}.params.${name}`, depth + 1)
    }
  }
  // JSON を往復しても同じもの（IPC と NDJSON を必ず通る）
  expect(JSON.parse(JSON.stringify(text)) as unknown, `${where}: JSON 往復で変わる`).toEqual(text)
}

/**
 * その `LocalizedText` が両言語で「読める文」になり、英語に日本語が残らないこと。
 *
 * 日本語の検査は**差し込みを外したひな型**で行う。差し込む値（デバイスの表示名、
 * パーティション名など）は利用者の環境由来で日本語でありうるので、
 * 差し込んだ結果を見ると誤検出になる。
 */
function expectRenders(text: LocalizedText, where: string): void {
  assertLocalized(text, where)
  for (const locale of LOCALES) {
    const rendered = formatLocalized(locale, text)
    expect(rendered, `${where} (${locale}): キー名がそのまま出ている`).not.toBe(text.key)
    expect(rendered.trim().length, `${where} (${locale}): 空`).toBeGreaterThan(0)
    // 差し込み忘れは `{name}` が残る（interpolate は空文字に落とさない）
    expect(placeholdersOf(rendered), `${where} (${locale}): 差し込みが埋まっていない`).toEqual([])
  }
  expect(
    formatLocalized('en', localized(text.key)),
    `${where}: en のひな型に日本語が残っている`,
  ).not.toMatch(JAPANESE)
}

/** 辞書のうち、この接頭辞を持つキー。 */
const keysWithPrefix = (prefix: string): string[] =>
  Object.keys(ja)
    .filter((k) => k.startsWith(prefix))
    .sort()

// ---------------------------------------------------------------------------
// 1. classifyDevice — すべての拒否パターン
// ---------------------------------------------------------------------------

const BASE_DEVICE = {
  id: '/dev/sdb',
  description: 'SanDisk Ultra',
  sizeBytes: 16_000_000_000,
  bus: 'usb' as DeviceBus,
  removable: true,
  isSystem: false,
  mountpoints: [] as string[],
  serial: 'ABC123',
  readOnly: false,
}

/**
 * 「この入力を通すとこのキーになる」表。
 * 下の it が **辞書の `device.blocked*` と完全に一致すること**まで見るので、
 * ブロック理由を 1 つ足して入力を書き忘れたら落ちる。
 */
const BLOCK_CASES: Record<string, Partial<typeof BASE_DEVICE>> = {
  'device.blockedSystemDisk': { isSystem: true },
  'device.blockedReadOnly': { readOnly: true },
  'device.blockedUnknownSize': { sizeBytes: 0 },
  'device.blockedVirtual': { bus: 'virtual' },
  'device.blockedNotRemovable': { bus: 'unknown', removable: false },
  'device.blockedTooSmall': { sizeBytes: MIN_DEVICE_BYTES - 1 },
  'device.blockedTooLarge': { sizeBytes: MAX_DEVICE_BYTES + 1 },
}

describe('classifyDevice が返す blockedReason', () => {
  it('すべての拒否パターンが訳せる形で、辞書に実在するキーを運ぶ', () => {
    for (const [key, overrides] of Object.entries(BLOCK_CASES)) {
      const d = classifyDevice({ ...BASE_DEVICE, ...overrides })
      expect(d.selectable, key).toBe(false)
      expect(d.blockedReason, key).not.toBeNull()
      expect(d.blockedReason!.key, `${key} の入力が別の分岐に落ちている`).toBe(key)
      expectRenders(d.blockedReason!, `classifyDevice ${key}`)
    }
  })

  it('辞書の device.blocked* を 1 つも取りこぼしていない', () => {
    // ここが「union に 1 つ足したら落ちる」役。ブロック理由は判別可能ユニオンでは
    // なく辞書のキーなので、型ではなく辞書との突き合わせで網羅を強制する。
    expect(Object.keys(BLOCK_CASES).sort()).toEqual(keysWithPrefix('device.blocked'))
  })

  it('通ったデバイスは blockedReason を持たない（null であって空オブジェクトではない）', () => {
    const d = classifyDevice(BASE_DEVICE)
    expect(d.selectable).toBe(true)
    expect(d.blockedReason).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. WriteScript の全 op のラベル
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/research/iso-probe/fixtures',
)
const FIXTURE = 'ubuntu-24.04.4-live-server-amd64'
const USB_SIZE = 16 * 1000 * 1000 * 1000
const SEED_FILES = [
  { name: 'user-data', content: Buffer.from('#cloud-config\n', 'utf8') },
  { name: 'meta-data', content: Buffer.from('instance-id: x\n', 'utf8') },
]
const TS = new Date('2026-09-05T00:00:00Z')

function fixedRandom(): (n: number) => Buffer {
  let s = 1
  return (n: number) => {
    const b = Buffer.allocUnsafe(n)
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      b[i] = (s >> 16) & 0xff
    }
    return b
  }
}

const isoFixture = (): SparseFixtureDevice =>
  SparseFixtureDevice.fromFile(join(FIXTURE_DIR, `${FIXTURE}.json`))

/**
 * `writeOp.*` のうち、レイアウト計画ではなく**書き込みの実行**が出すもの。
 * ここに書いたものだけが「計画に無くてよい」。増やすときは理由を添えること。
 */
const WRITER_ONLY_OPS: readonly string[] = [
  // writer/execute.ts が読み戻し検証の間に出す
  'writeOp.verifying',
  // writer/execute.ts が最後の flush で出す
  'writeOp.flushing',
]

describe('planUsbLayout が返す WriteOp のラベル', () => {
  it('すべての op が訳せる形で、辞書に実在するキーを運ぶ', async () => {
    const iso = isoFixture()
    const inspection = await inspectIso(iso)
    const plan = await planUsbLayout({
      isoDevice: iso,
      diskSizeBytes: USB_SIZE,
      patches: buildIsoPatches(inspection, { args: ['autoinstall'] }).patches,
      seedFiles: SEED_FILES,
      random: fixedRandom(),
      timestamp: TS,
    })
    const ops = [...plan.ops, ...plan.finalOps]
    expect(ops.length).toBeGreaterThan(0)
    for (const op of ops) expectRenders(op.label, `WriteOp ${op.kind} @${op.diskOffset}`)

    // 辞書の writeOp.* を取りこぼしていない（計画が出すもの + 書き込みが出すもの）
    const produced = [...new Set(ops.map((o) => o.label.key as string))]
    expect([...produced, ...WRITER_ONLY_OPS].sort()).toEqual(keysWithPrefix('writeOp.'))
  })

  it('書き込みだけが出すラベルも辞書にあり、両言語で読める', () => {
    for (const key of WRITER_ONLY_OPS) {
      expectRenders(localized(key as MsgKey), `writer ${key}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. LayoutError — reason のすべての値
// ---------------------------------------------------------------------------

/**
 * `LayoutError['reason']` の**すべての値**に対応するキー。
 *
 * `satisfies Record<LayoutError['reason'], MsgKey>` なので、
 * **union に 1 つ足すとここがコンパイルエラーになる**（キー不足）。
 * 下の it は「表のすべての reason が実際に投げられること」まで見るので、
 * 表に足しただけで実装を書き忘れても落ちる。
 */
const LAYOUT_ERROR_KEYS = {
  'not-protective-mbr': 'layout.notProtectiveMbr',
  'no-gpt': 'layout.noGpt',
  'iso-truncated': 'layout.isoTruncated',
  'disk-too-small': 'layout.diskTooSmall',
  'cidata-too-small': 'layout.cidataTooSmall',
} satisfies Record<LayoutError['reason'], MsgKey>

/** protective MBR はあるが GPT が無いディスク（`no-gpt` を出させるための最小構成）。 */
function protectiveMbrOnly(): MemoryBlockDevice {
  const dev = new MemoryBlockDevice(64 * 1024 * 1024)
  const sector = Buffer.alloc(SECTOR_SIZE)
  sector[446 + 4] = 0xee // 第 1 エントリの type = GPT protective
  sector.writeUInt16LE(0xaa55, 510)
  void dev.write(0, sector)
  return dev
}

/** 計画を投げさせて `LayoutError` を取り出す（巨大なオブジェクトを expect に渡さない）。 */
async function layoutErrorOf(
  options: Parameters<typeof planUsbLayout>[0],
): Promise<LayoutError> {
  try {
    await planUsbLayout(options)
  } catch (err) {
    if (err instanceof LayoutError) return err
    throw err
  }
  throw new Error('planUsbLayout が LayoutError を投げなかった')
}

describe('LayoutError の文言', () => {
  it('reason のすべての値が、辞書に実在するキーを運ぶ', async () => {
    const common = {
      patches: [],
      seedFiles: SEED_FILES,
      random: fixedRandom(),
      timestamp: TS,
    }

    // ISO ですらないもの → protective MBR が無い
    const notMbr = await layoutErrorOf({
      ...common,
      isoDevice: new MemoryBlockDevice(64 * 1024 * 1024),
      diskSizeBytes: USB_SIZE,
    })

    // protective MBR はあるが GPT が無い
    const noGpt = await layoutErrorOf({
      ...common,
      isoDevice: protectiveMbrOnly(),
      diskSizeBytes: USB_SIZE,
    })

    // 途中までしか落ちてこなかった ISO（パーティション表だけが元のまま大きい）
    const whole = isoFixture()
    const truncatedDev = Object.create(Object.getPrototypeOf(whole) as object) as SparseFixtureDevice
    Object.assign(truncatedDev, whole)
    Object.defineProperty(truncatedDev, 'size', { value: 100 * 1024 * 1024, configurable: true })
    const truncated = await layoutErrorOf({
      ...common,
      isoDevice: truncatedDev,
      diskSizeBytes: USB_SIZE,
    })

    // 24.04.4 は 3.405 GB。CIDATA 64 MiB を足すと 3.4 GB には入らない
    const tooSmall = await layoutErrorOf({
      ...common,
      isoDevice: isoFixture(),
      diskSizeBytes: 3_400_000_000,
    })

    // CIDATA が 1 MiB 未満（容量は足りているので disk-too-small には落ちない）
    const cidataTooSmall = await layoutErrorOf({
      ...common,
      isoDevice: isoFixture(),
      diskSizeBytes: USB_SIZE,
      cidataSizeBytes: 512 * 1024,
    })

    const seen: LayoutError[] = [notMbr, noGpt, truncated, tooSmall, cidataTooSmall]
    for (const err of seen) {
      const expected = LAYOUT_ERROR_KEYS[err.reason]
      expect(err.text.key, `reason=${err.reason} のキー`).toBe(expected)
      expectRenders(err.text, `LayoutError ${err.reason}`)
      // 開発者向けの message は日本語のまま残す。LocalizedText を素で埋めていないこと
      expect(err.message, `reason=${err.reason} の message`).not.toContain('[object Object]')
      expect(err.message.length).toBeGreaterThan(0)
    }

    // 表に書いたすべての reason を実際に踏んでいること（表だけ増やしても落ちる）
    expect([...seen.map((e) => e.reason)].sort()).toEqual(Object.keys(LAYOUT_ERROR_KEYS).sort())
    // 辞書の layout.* を取りこぼしていない
    expect(Object.values(LAYOUT_ERROR_KEYS).sort()).toEqual(keysWithPrefix('layout.'))
  })
})

// ---------------------------------------------------------------------------
// 4. DeviceRejectedError — 昇格ワーカーの再検証
// ---------------------------------------------------------------------------

const JOB_PATH = '\\\\.\\PhysicalDrive9'
const JOB_SIZE = 32_000_000_000
const JOB_SERIAL = 'TESTSERIAL'
const JOB_DESCRIPTION = 'KIOXIA TransMemory 31GB'

function makeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    jobId: 'j1',
    isoPath: 'C:/nonexistent.iso',
    devicePath: JOB_PATH,
    deviceSizeBytes: JOB_SIZE,
    deviceSerial: JOB_SERIAL,
    deviceDescription: JOB_DESCRIPTION,
    patches: [],
    seedFiles: [],
    cidataSizeBytes: 64 * 1024 * 1024,
    hideIsoPartitionFromWindows: true,
    verify: false,
    timestampIso: TS.toISOString(),
    randomSeedBase64: 'AAAA',
    reportPort: 1,
    reportToken: 't',
    ...overrides,
  }
}

function makeDevice(overrides: Partial<RemovableDevice> = {}): RemovableDevice {
  return {
    id: JOB_PATH,
    description: JOB_DESCRIPTION,
    sizeBytes: JOB_SIZE,
    bus: 'usb',
    removable: true,
    isSystem: false,
    mountpoints: [],
    serial: JOB_SERIAL,
    readOnly: false,
    selectable: true,
    blockedReason: null,
    ...overrides,
  }
}

function fakePlatform(devices: RemovableDevice[]): PlatformOps {
  return {
    listDevices: () => Promise.resolve(devices),
    prepareForWrite: () => Promise.reject(new Error('検証テストで prepareForWrite が呼ばれた')),
    finishWrite: () => Promise.reject(new Error('検証テストで finishWrite が呼ばれた')),
    hasWriteAccess: () => Promise.resolve(true),
  }
}

/** 拒否のすべての形。`device.rejected*` を辞書と突き合わせて網羅を強制する。 */
const REJECT_CASES: Record<string, { devices: RemovableDevice[]; job?: Partial<WorkerJob> }> = {
  'device.rejectedNotFound': {
    devices: [makeDevice({ id: '\\\\.\\PhysicalDrive0', serial: 'OTHER' })],
  },
  'device.rejectedNotWritable': {
    devices: [
      makeDevice({ selectable: false, blockedReason: localized('device.blockedSystemDisk') }),
    ],
  },
  'device.rejectedNotWritableUnknown': {
    // 列挙側が理由を付け忘れた（あるいは差し替えられた）とき。
    // `{reason}` を持つキーを使うと画面に `{reason}` がそのまま出るので別キーになる。
    devices: [makeDevice({ selectable: false, blockedReason: null })],
  },
  'device.rejectedSizeMismatch': {
    devices: [makeDevice({ sizeBytes: JOB_SIZE + 4096 })],
  },
  'device.rejectedSerialMismatch': {
    devices: [makeDevice({ serial: 'DIFFERENT' })],
  },
  'device.rejectedSerialMissing': {
    devices: [makeDevice({ serial: null })],
  },
  'device.rejectedDescriptionMismatch': {
    // シリアルを返さない USB ブリッジ。表示名で見分ける。
    devices: [makeDevice({ serial: null, description: '別のディスク' })],
    job: { deviceSerial: null },
  },
}

describe('DeviceRejectedError の文言', () => {
  it('すべての拒否パターンが訳せる形で、辞書に実在するキーを運ぶ', async () => {
    for (const [key, c] of Object.entries(REJECT_CASES)) {
      let err: unknown = null
      try {
        await assertDeviceIsWritable(fakePlatform(c.devices), makeJob(c.job))
      } catch (e) {
        err = e
      }
      expect(err, `${key}: 拒否されなかった（書き込みに進んでしまう）`).toBeInstanceOf(
        DeviceRejectedError,
      )
      const rejected = err as DeviceRejectedError
      expect(rejected.text.key, `${key} の入力が別の分岐に落ちている`).toBe(key)
      expectRenders(rejected.text, `DeviceRejectedError ${key}`)
      // 開発者向けの message は日本語のまま残すが、LocalizedText を素で埋めない
      expect(rejected.message, `${key} の message`).not.toContain('[object Object]')
      expect(rejected.message).toContain(JOB_PATH)
    }
  })

  it('辞書の device.rejected* を 1 つも取りこぼしていない', () => {
    expect(Object.keys(REJECT_CASES).sort()).toEqual(keysWithPrefix('device.rejected'))
  })

  it('入れ子の理由も辞書に実在するキーで運ばれる（英語の画面に日本語を混ぜない）', async () => {
    // `device.rejectedNotWritable` は列挙側が作った別の訳文を差し込みに入れる。
    // 入れ子ごと訳せないと、英語の画面に日本語の理由が出るか、理由が消える。
    let err: unknown = null
    try {
      await assertDeviceIsWritable(
        fakePlatform([
          makeDevice({ selectable: false, blockedReason: localized('device.blockedSystemDisk') }),
        ]),
        makeJob(),
      )
    } catch (e) {
      err = e
    }
    const text = (err as DeviceRejectedError).text
    const nested = text.params?.reason
    assertLocalized(nested, '入れ子の blockedReason')
    expect(formatLocalized('en', text)).toContain(en['device.blockedSystemDisk'])
    expect(formatLocalized('en', text)).not.toMatch(JAPANESE)
  })
})

// ===========================================================================
// 5. ソースの直書き
// ===========================================================================
//
// **この検査がどこまで見ているか（正直な範囲）**
//
//   走査するのは `packages/media/src` と `apps/desktop/src/main`（`*.test.ts` を除く）。
//   renderer は自前の検査（`renderer/src/lib/i18n.test.ts`）が、shared の辞書は
//   `packages/shared/src/i18n/i18n.test.ts` が見ている。`scripts/` は
//   製品に入らないので**見ていない**。
//
//   見ているのは次の 3 つだけ:
//     (1) `localized(` の第 1 引数に日本語が無く、そこに現れる文字列リテラルが
//         すべて辞書に実在するキーであること（三項演算子は**値の側**だけを見る。
//         `what === 'file' ? …` の `'file'` は条件であってキーではない）。
//     (2) `message:` / `label:` / `blockedReason:` に日本語の文字列リテラルを
//         渡していないこと。
//     (3) `device.` / `layout.` / `writeOp.` / `seed.` のキーが、main / media の
//         ソースのどこかから参照されていること（死んだキーの検出）。
//
//   見ていないもの（**取りこぼしがある**と分かったうえでそうしている）:
//     (a) **位置引数の日本語**。`new LayoutError('…日本語…', reason, text)` の
//         第 1 引数は「開発者向けの診断」として意図的に日本語で書く規約なので、
//         ここで一律に禁止できない。つまり「診断のつもりで書いた日本語が
//         実は画面に出ていた」型の間違いは、この検査では捕まらない。
//         捕まえているのは上の 1〜4（実行時の契約）のほう。
//     (b) `detail:` は開発者向けなので**対象外**（規約どおり）。
//     (c) 完全な字句解析はしていない。正規表現リテラルの中の素の `//` は
//         行コメントの開始と誤読する（＝取りこぼし。誤検出ではない）。
//         現在のソースにそのような正規表現は無い。
//     (d) テンプレートリテラルの `${ … }` を「コード」に戻さない。
//     (e) 変数経由でキーを組み立てる書き方（`localized(k)`）は、リテラルが
//         1 つも無いので (1) で落ちる。許可リストに理由つきで足すこと。

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const SCAN_DIRS = ['packages/media/src', 'apps/desktop/src/main']

interface Allowed {
  /** リポジトリルートからの相対パス（`/` 区切り）。 */
  readonly file: string
  /** 許可する日本語そのもの。ファイル単位ではなく**この文字列だけ**を許す。 */
  readonly text: string
  readonly reason: string
}

/**
 * 意図的な例外。1 件ずつ理由を書く。ファイル丸ごとの除外はしない
 * （同じファイルに新しい直書きが増えたら、それは検出したい）。
 */
const ALLOWLIST: readonly Allowed[] = [
  {
    file: 'packages/media/src/isopatch/index.ts',
    text: 'grub.cfg の内容',
    reason:
      'ISO のインプレース改変 1 か所ぶんの名前 (`Patch.label`)。画面には出ない。' +
      'ジョブ JSON と読み戻し検証の失敗メッセージ（開発者向けの `message`）にだけ現れる。' +
      '進捗バーに出るのは `WriteOp.label`（LocalizedText）のほうで、別物。',
  },
]

function listSources(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
      out.push(full)
    }
  }
  for (const d of SCAN_DIRS) walk(join(REPO_ROOT, d))
  return out.sort()
}

/**
 * コメントを空白に潰す（行数とオフセットは保つ）。
 * renderer の `i18n.test.ts` と同じ近似。行をまたげるのはブロックコメントと
 * テンプレートリテラルだけで、`'` / `"` は行末で必ず閉じる。
 */
function stripComments(source: string): string {
  let out = ''
  let inBlock = false
  let quote: "'" | '"' | '`' | null = null
  for (const raw of source.split('\n')) {
    let kept = ''
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!
      const next = raw[i + 1]
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false
          kept += '  '
          i++
          continue
        }
        kept += ' '
        continue
      }
      if (quote !== null) {
        kept += c
        if (c === '\\') {
          kept += next ?? ''
          i++
          continue
        }
        if (c === quote) quote = null
        continue
      }
      if (c === '/' && next === '*') {
        inBlock = true
        kept += '  '
        i++
        continue
      }
      // 直前が `\` なら正規表現内のエスケープされたスラッシュ（`\/\/`）とみなす
      if (c === '/' && next === '/' && raw[i - 1] !== '\\') {
        kept += ' '.repeat(raw.length - i)
        break
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c
        kept += c
        continue
      }
      kept += c
    }
    if (quote === "'" || quote === '"') quote = null
    out += `${kept}\n`
  }
  return out
}

/** `localized(` の直後から、第 1 引数の終わり（トップレベルの `,` か `)`）まで。 */
function firstArgument(text: string, start: number): string {
  let depth = 0
  let quote: "'" | '"' | '`' | null = null
  let i = start
  for (; i < text.length; i++) {
    const c = text[i]!
    if (quote !== null) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if (c === ',' && depth === 0) break
  }
  return text.slice(start, i)
}

/**
 * 三項演算子の「値の側」だけを返す。
 *
 * `localized(what === 'file' ? 'seed.reservedNameFile' : 'seed.reservedNameDeployment')`
 * の `'file'` は**条件の一部**であってキーではない。条件まで「キーであること」を
 * 求めると、正しいコードが落ちる。トップレベルの `?` があればその後ろだけを見る。
 * `?.`（オプショナルチェーン）と `??`（null 合体）は三項ではないので飛ばす。
 */
function conditionalValues(arg: string): string {
  let depth = 0
  let quote: "'" | '"' | '`' | null = null
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i]!
    if (quote !== null) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === '?' && depth === 0) {
      if (arg[i + 1] === '.' || arg[i + 1] === '?' || arg[i - 1] === '?') continue
      return arg.slice(i + 1)
    }
  }
  return arg
}

/** 文字列リテラルの中身を取り出す（エスケープは解かない。キーは ASCII なので十分）。 */
const STRING_LITERAL = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g

const lineOf = (text: string, index: number): number =>
  text.slice(0, index).split('\n').length

interface Finding {
  readonly file: string
  readonly line: number
  readonly what: string
  readonly text: string
}

const relPath = (full: string): string => relative(REPO_ROOT, full).split(sep).join('/')

describe('main / media のソースに、画面へ出る日本語の直書きが残っていない', () => {
  const files = listSources().map((full) => ({
    file: relPath(full),
    code: stripComments(readFileSync(full, 'utf8')),
  }))

  it('走査対象を実際に読めている（空だと何も検証しないので確認する）', () => {
    const names = files.map((f) => f.file)
    expect(names.length).toBeGreaterThan(15)
    expect(names).toContain('packages/media/src/layout/plan.ts')
    expect(names).toContain('packages/media/src/platform/types.ts')
    expect(names).toContain('packages/media/src/worker/run.ts')
    expect(names).toContain('apps/desktop/src/main/seed-builder.ts')
    expect(names).toContain('apps/desktop/src/main/iso-service.ts')
    expect(names.filter((n) => n.includes('.test.'))).toEqual([])
    // コメント除去が働いていること。**実在する文面**で確かめる
    // （このリポジトリに無い語で書くと、除去が壊れていても通る空の検査になる。
    //   実際、最初は plan.ts に無い語を書いてしまい、変異させても落ちなかった）。
    const plan = files.find((f) => f.file === 'packages/media/src/layout/plan.ts')!
    expect(plan.code).toContain("localized('writeOp.clearTable')")
    // `// USB のレイアウトを決め…`（行コメント）
    expect(plan.code, '行コメントが残っている').not.toContain('USB のレイアウトを決め')
    // `/** 1 手順ぶんの書き込み指示。 */`（ブロックコメント）
    expect(plan.code, 'ブロックコメントが残っている').not.toContain('1 手順ぶんの書き込み指示')
  })

  it('localized() の第 1 引数は、辞書に実在するキーのリテラルだけ', () => {
    const bad: Finding[] = []
    let calls = 0
    for (const { file, code } of files) {
      for (const m of code.matchAll(/\blocalized\s*\(/g)) {
        calls++
        const arg = firstArgument(code, m.index + m[0].length)
        const line = lineOf(code, m.index)
        if (JAPANESE.test(arg)) {
          bad.push({ file, line, what: '第 1 引数に日本語', text: arg.trim() })
          continue
        }
        const values = conditionalValues(arg)
        const literals = [...values.matchAll(STRING_LITERAL)].map((s) => s[1] ?? s[2] ?? s[3] ?? '')
        if (literals.length === 0) {
          bad.push({ file, line, what: 'キーがリテラルでない', text: arg.trim() })
          continue
        }
        for (const key of literals) {
          if (dict('ja')[key] === undefined || dict('en')[key] === undefined) {
            bad.push({ file, line, what: `辞書に無いキー "${key}"`, text: arg.trim() })
          }
        }
      }
    }
    // 呼び出しが 1 つも取れていないと、この検査は何も見ていない
    expect(calls, 'localized() の呼び出しが見つからない（走査か正規表現が壊れている）').toBeGreaterThan(40)
    expect(bad, report(bad)).toEqual([])
  })

  it('message: / label: / blockedReason: に日本語のリテラルを渡していない', () => {
    // `detail:` は開発者向けの診断なので対象外（規約どおり）。
    const bad: Finding[] = []
    for (const { file, code } of files) {
      for (const m of code.matchAll(
        /\b(message|label|blockedReason)\s*:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g,
      )) {
        const literal = m[2]!.slice(1, -1)
        if (!JAPANESE.test(literal)) continue
        const finding = {
          file,
          line: lineOf(code, m.index),
          what: `${m[1]!}: に日本語`,
          text: literal,
        }
        if (ALLOWLIST.some((a) => a.file === file && a.text === literal)) continue
        bad.push(finding)
      }
    }
    expect(bad, report(bad)).toEqual([])
  })

  it('ALLOWLIST に死んだ例外が残っていない', () => {
    const unused = ALLOWLIST.filter((a) => {
      const f = files.find((x) => x.file === a.file)
      return f === undefined || !f.code.includes(a.text)
    })
    expect(
      unused.map((a) => `${a.file}: ${a.text}`),
      '直したのに例外だけ残ると、次の直書きをそのまま通してしまいます',
    ).toEqual([])
  })

  it('main / media が持つ接頭辞の辞書キーに、誰も参照しないものが無い', () => {
    // 使われないキーが辞書に残っていると、「あるはずの文言」を探した人が
    // それを使い、実際には別の経路が生の文字列を出し続ける。
    const all = files.map((f) => f.code).join('\n')
    const dead: string[] = []
    for (const prefix of ['device.', 'layout.', 'writeOp.', 'seed.']) {
      for (const key of keysWithPrefix(prefix)) {
        if (!all.includes(`'${key}'`) && !all.includes(`"${key}"`)) dead.push(key)
      }
    }
    expect(
      dead,
      '辞書にあるのに main / media のどこからも引かれていないキーです。\n' +
        '使う場所を足すか、ja.ts / en.ts から消してください。',
    ).toEqual([])
  })
})

function report(bad: Finding[]): string {
  if (bad.length === 0) return ''
  return (
    `画面に出る文言の直書きが ${bad.length} 件あります。\n` +
    'ja.ts / en.ts にキーを足し、localized(key, params) で運んでください。\n' +
    '意図的な例外なら localized-guard.test.ts の ALLOWLIST に理由つきで足してください。\n' +
    bad.map((b) => `  ${b.file}:${b.line}\n    ${b.what}\n    ${b.text}`).join('\n')
  )
}
