import { beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { LOCALES, formatLocalized, ja, en, placeholdersOf, type LocalizedText } from '@autoinstall/shared'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MemoryBlockDevice, SparseFixtureDevice, SECTOR_SIZE } from './blockdev/index.js'
import { readIsoStructure, readFile, resolvePath } from './iso9660/reader.js'
import { GPT_ATTR, PARTITION_TYPE, parseMbr, readGpt } from './gpt/index.js'
import { buildIsoPatches, inspectIso, type IsoInspection, type IsoPatchPlan } from './isopatch/index.js'
import { planUsbLayout, minimumDiskSize, LayoutError, CIDATA_LABEL, type UsbLayoutPlan } from './layout/plan.js'
import {
  executeWritePlan,
  survivingRanges,
  WriteCancelledError,
  VerificationError,
  type WriteResult,
} from './writer/execute.js'
import { readFatImage } from './fat/read.js'
import { DeviceWriteStalledError } from './blockdev/raw.js'

// 実 ISO のフィクスチャに対して「検査 → 計画 → 書き込み → 読み戻し」を丸ごと通す統合テスト。
// これが通れば、実機に書く前にレイアウトと改変ロジックの正しさが担保される。
//
// 3 GB 級のイメージを扱うので、バージョンごとに 1 回だけ書き込んで結果を共有する。

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/research/iso-probe/fixtures')

const USER_DATA = `#cloud-config
autoinstall:
  version: 1
  identity:
    hostname: test-server
    username: ubuntu
    password: "$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1"
`
const META_DATA = 'instance-id: autoinstall-test\n'
const SEED_FILES = [
  { name: 'user-data', content: Buffer.from(USER_DATA, 'utf8') },
  { name: 'meta-data', content: Buffer.from(META_DATA, 'utf8') },
]
const TS = new Date('2026-09-03T12:00:00Z')
const USB_SIZE = 16 * 1000 * 1000 * 1000
const CASES = [
  'ubuntu-22.04.5-live-server-amd64',
  'ubuntu-24.04.4-live-server-amd64',
  'ubuntu-25.10-live-server-amd64',
  'ubuntu-26.04.1-live-server-amd64',
  'ubuntu-26.10-live-server-amd64',
] as const

/**
 * md5sum.txt が grub.cfg を載せているか（実測）。26.10 から載らなくなった。
 * 載っていなければ書き換える行が無いので、md5sum.txt のパッチは出ない。
 */
const MD5_LISTS_GRUB_CFG: Record<(typeof CASES)[number], boolean> = {
  'ubuntu-22.04.5-live-server-amd64': true,
  'ubuntu-24.04.4-live-server-amd64': true,
  'ubuntu-25.10-live-server-amd64': true,
  'ubuntu-26.04.1-live-server-amd64': true,
  'ubuntu-26.10-live-server-amd64': false,
}

/** テストを決定的にするための固定乱数源 */
function fixedRandom(seed = 1): (n: number) => Buffer {
  let s = seed
  return (n: number) => {
    const b = Buffer.allocUnsafe(n)
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      b[i] = (s >> 16) & 0xff
    }
    return b
  }
}

function isoDevice(name: string): SparseFixtureDevice {
  return SparseFixtureDevice.fromFile(join(FIXTURE_DIR, `${name}.json`))
}

async function makePlan(
  name: string,
  diskSizeBytes = USB_SIZE,
): Promise<{
  iso: SparseFixtureDevice
  inspection: IsoInspection
  patchPlan: IsoPatchPlan
  plan: UsbLayoutPlan
}> {
  const iso = isoDevice(name)
  const inspection = await inspectIso(iso)
  const patchPlan = buildIsoPatches(inspection, { args: ['autoinstall'], markTitle: true })
  const plan = await planUsbLayout({
    isoDevice: iso,
    diskSizeBytes,
    patches: patchPlan.patches,
    seedFiles: SEED_FILES,
    random: fixedRandom(),
    timestamp: TS,
  })
  return { iso, inspection, patchPlan, plan }
}

interface Written {
  iso: SparseFixtureDevice
  inspection: IsoInspection
  patchPlan: IsoPatchPlan
  plan: UsbLayoutPlan
  usb: MemoryBlockDevice
  result: WriteResult
}

/** バージョンごとに 1 回だけ実行する（3 GB の書き込みを毎テスト繰り返さないため）。 */
async function writeOnce(name: string, verify: boolean): Promise<Written> {
  const { iso, inspection, patchPlan, plan } = await makePlan(name)
  const usb = new MemoryBlockDevice(USB_SIZE)
  const result = await executeWritePlan({
    plan,
    isoDevice: iso,
    targetDevice: usb,
    patches: patchPlan.patches,
    verify,
  })
  return { iso, inspection, patchPlan, plan, usb, result }
}

describe.each(CASES)('%s の USB 作成', (name) => {
  let w: Written

  beforeAll(async () => {
    // 22.04 のケースだけ読み戻し検証も実行する（全バージョンでやると時間がかかりすぎる）
    w = await writeOnce(name, name.includes('22.04'))
  }, 300_000)

  it('ISO を検査して grub.cfg と casper を見つける', () => {
    expect(w.inspection.volumeId).toMatch(/^Ubuntu-Server /)
    expect(w.inspection.diskInfo).toMatch(/^Ubuntu-Server /)
    expect(w.inspection.casperFiles).toContain('vmlinuz')
    expect(w.inspection.casperFiles).toContain('initrd')
    expect(w.inspection.md5sum).not.toBeNull()
    expect(w.inspection.grubCfgJoliet).not.toBeNull()
  })

  it('パッチは grub.cfg セクタ / レコード 2 つ /（載っていれば）md5sum の行だけ', () => {
    expect(w.patchPlan.patches.map((p) => p.label)).toEqual([
      'grub.cfg contents',
      'grub.cfg size (ISO9660)',
      'grub.cfg size (Joliet)',
      ...(MD5_LISTS_GRUB_CFG[name] ? ['grub.cfg line in md5sum.txt'] : []),
    ])
    expect(w.patchPlan.newGrubCfg).toContain('autoinstall')
    expect(w.patchPlan.patchedKernelLines).toBeGreaterThan(0)
  })

  it('CIDATA は ISO 末尾の次の 1 MiB 境界に置かれる', () => {
    const isoSectors = Math.ceil(w.inspection.sizeBytes / SECTOR_SIZE)
    expect(w.plan.cidata.startLba).toBeGreaterThanOrEqual(isoSectors)
    expect((w.plan.cidata.startLba * SECTOR_SIZE) % (1024 * 1024)).toBe(0)
    expect(w.plan.cidata.sizeBytes).toBe(64 * 1024 * 1024)
  })

  it('書き込み量は ISO サイズ + CIDATA 程度に収まる（ディスク全体を消さない）', () => {
    expect(w.plan.totalBytes).toBeGreaterThan(w.inspection.sizeBytes * 0.99)
    expect(w.plan.totalBytes).toBeLessThan(w.inspection.sizeBytes + 80 * 1024 * 1024)
    expect(w.result.bytesWritten).toBe(w.plan.totalBytes)
  })

  it('GPT に 4 パーティションがあり CRC が正しい', async () => {
    const gpt = await readGpt(w.usb)
    expect(gpt).not.toBeNull()
    expect(gpt!.headerCrcValid).toBe(true)
    expect(gpt!.entriesCrcValid).toBe(true)
    expect(gpt!.entries).toHaveLength(4)
    expect(gpt!.entries.map((e) => e.name)).toEqual(['ISO9660', 'Appended2', 'Gap1', CIDATA_LABEL])

    const diskSectors = Math.floor(USB_SIZE / SECTOR_SIZE)
    expect(gpt!.header.myLba).toBe(1)
    expect(gpt!.header.alternateLba).toBe(diskSectors - 1)
    expect(gpt!.header.lastUsableLba).toBe(diskSectors - 64)
  })

  it('バックアップ GPT がディスク末尾にあり、ISO 末尾の古いものは消えている', async () => {
    const diskSectors = Math.floor(USB_SIZE / SECTOR_SIZE)
    const backup = await readGpt(w.usb, diskSectors - 1)
    expect(backup).not.toBeNull()
    expect(backup!.headerCrcValid).toBe(true)
    expect(backup!.entriesCrcValid).toBe(true)
    expect(backup!.header.myLba).toBe(diskSectors - 1)
    expect(backup!.header.alternateLba).toBe(1)
    expect(backup!.entries).toHaveLength(4)

    const staleLba = Math.ceil(w.inspection.sizeBytes / SECTOR_SIZE) - 1
    const stale = await w.usb.read(staleLba * SECTOR_SIZE, 8)
    expect(stale.toString('latin1')).not.toBe('EFI PART')
  })

  it('protective MBR が GRUB のブートコードごと保たれ、サイズが更新される', async () => {
    const mbr = parseMbr(await w.usb.read(0, SECTOR_SIZE))
    expect(mbr.valid).toBe(true)
    expect(mbr.isProtective).toBe(true)
    expect(mbr.hasBootCode).toBe(true)
    expect(mbr.entries[0]!.startLba).toBe(1)
    expect(mbr.entries[0]!.sectors).toBe(Math.floor(USB_SIZE / SECTOR_SIZE) - 1)
    // ブートコードは ISO のものと 1 バイトも変わらない
    expect((await w.usb.read(0, 440)).equals(await w.iso.read(0, 440))).toBe(true)
  })

  it('ISO9660 パーティションは Windows から隠され、CIDATA は見える', async () => {
    const gpt = await readGpt(w.usb)
    const iso9660 = gpt!.entries.find((e) => e.name === 'ISO9660')!
    const cidata = gpt!.entries.find((e) => e.name === CIDATA_LABEL)!
    expect(iso9660.attributes & GPT_ATTR.NO_DRIVE_LETTER).toBe(GPT_ATTR.NO_DRIVE_LETTER)
    expect(cidata.attributes & GPT_ATTR.NO_DRIVE_LETTER).toBe(0n)
    expect(cidata.typeGuid).toBe(PARTITION_TYPE.MICROSOFT_BASIC_DATA)
  })

  it('CIDATA パーティションから user-data と meta-data を読み戻せる', async () => {
    const gpt = await readGpt(w.usb)
    const cidata = gpt!.entries.find((e) => e.name === CIDATA_LABEL)!
    const bytes = (cidata.endLba - cidata.startLba + 1) * SECTOR_SIZE
    const fsImage = await w.usb.read(cidata.startLba * SECTOR_SIZE, bytes)
    const fs = readFatImage(fsImage)

    expect(fs.label).toBe('CIDATA')
    expect(fs.files.map((f) => f.name).sort()).toEqual(['meta-data', 'user-data'])
    expect(fs.files.find((f) => f.name === 'user-data')!.content.toString('utf8')).toBe(USER_DATA)
    expect(fs.files.find((f) => f.name === 'meta-data')!.content.toString('utf8')).toBe(META_DATA)
    // BPB の HiddSec がパーティション開始 LBA と一致する（ここがずれると Windows が誤認する）
    expect(fsImage.readUInt32LE(28)).toBe(cidata.startLba)
  })

  it('USB 上の ISO9660 を読むと grub.cfg に autoinstall が入っている', async () => {
    const structure = await readIsoStructure(w.usb)
    expect(structure.pvd.volumeId).toMatch(/^Ubuntu-Server /)
    const grub = await resolvePath(w.usb, structure.pvd.rootRecord, '/boot/grub/grub.cfg')
    expect(grub).not.toBeNull()
    // Data Length が新しいサイズに更新されている
    expect(grub!.record.size).toBe(Buffer.byteLength(w.patchPlan.newGrubCfg, 'utf8'))
    const text = (await readFile(w.usb, grub!.record)).toString('utf8')
    expect(text).toBe(w.patchPlan.newGrubCfg)
    expect(text).toContain('autoinstall')
    expect(text).toContain('[Autoinstall]')
  })

  it('Joliet ツリーから読んでも同じ grub.cfg が得られる', async () => {
    const structure = await readIsoStructure(w.usb)
    const j = await resolvePath(w.usb, structure.joliet!.rootRecord, '/boot/grub/grub.cfg', true)
    expect(j).not.toBeNull()
    expect(j!.record.size).toBe(Buffer.byteLength(w.patchPlan.newGrubCfg, 'utf8'))
    expect((await readFile(w.usb, j!.record)).toString('utf8')).toBe(w.patchPlan.newGrubCfg)
  })

  it('md5sum.txt の grub.cfg 行が新しい内容の MD5 に更新される（載っていれば）', async () => {
    const structure = await readIsoStructure(w.usb)
    const md5 = await resolvePath(w.usb, structure.pvd.rootRecord, '/md5sum.txt')
    const text = (await readFile(w.usb, md5!.record)).toString('utf8')
    const line = text.split('\n').find((l) => l.endsWith('  ./boot/grub/grub.cfg'))
    if (!MD5_LISTS_GRUB_CFG[name]) {
      // 載っていないリリースでは、行を足していない（md5sum.txt は 1 バイトも変えない）
      expect(line).toBeUndefined()
      const original = await resolvePath(w.iso, (await readIsoStructure(w.iso)).pvd.rootRecord, '/md5sum.txt')
      expect(text).toBe((await readFile(w.iso, original!.record)).toString('utf8'))
      return
    }
    expect(line).toBeDefined()
    const expected = createHash('md5').update(Buffer.from(w.patchPlan.newGrubCfg, 'utf8')).digest('hex')
    expect(line!.slice(0, 32)).toBe(expected)
    // 他の行は壊れていない
    expect(text.split('\n').filter((l) => /^[0-9a-f]{32} {2}\.\//.test(l)).length).toBeGreaterThan(50)
  })

  it('パッチ以外のセクタは 1 バイトも変わらない', async () => {
    const patchRanges = w.patchPlan.patches.map((p) => ({ start: p.offset, end: p.offset + p.data.length }))
    const samples = [
      { off: 16 * 2048, len: 2048, what: 'PVD' },
      { off: w.inspection.structure.pvd.rootRecord.extent * 2048, len: 2048, what: 'ルートディレクトリ' },
      { off: w.inspection.structure.elTorito!.catalogLba * 2048, len: 2048, what: 'El Torito boot catalog' },
      { off: 38 * 2048, len: 2048, what: 'boot ディレクトリ' },
    ]
    for (const s of samples) {
      const overlaps = patchRanges.some((r) => r.start < s.off + s.len && r.end > s.off)
      expect(overlaps, `${s.what} はパッチ対象ではないはず`).toBe(false)
      const before = await w.iso.read(s.off, s.len)
      const after = await w.usb.read(s.off, s.len)
      expect(after.equals(before), `${s.what} が変更されている`).toBe(true)
    }
  })
})

describe('読み戻し検証', () => {
  it('検証を有効にすると全範囲が一致する（22.04 で実施）', async () => {
    const w = await writeOnce('ubuntu-22.04.5-live-server-amd64', true)
    expect(w.result.verified).toBe(true)
    expect(w.result.digest).toMatch(/^[0-9a-f]{64}$/)
  }, 300_000)

  it('書き込んだ内容が壊れていれば検証で検出する', async () => {
    const { iso, plan, patchPlan } = await makePlan('ubuntu-22.04.5-live-server-amd64')
    const usb = new MemoryBlockDevice(USB_SIZE)
    const cidataOffset = plan.cidata.startLba * SECTOR_SIZE
    const original = usb.write.bind(usb)
    let corrupted = false
    usb.write = (offset: number, data: Buffer) => {
      if (!corrupted && offset === cidataOffset) {
        corrupted = true
        const bad = Buffer.from(data)
        bad[100] = bad[100]! ^ 0xff
        return original(offset, bad)
      }
      return original(offset, data)
    }
    await expect(
      executeWritePlan({ plan, isoDevice: iso, targetDevice: usb, patches: patchPlan.patches, verify: true }),
    ).rejects.toThrow(VerificationError)
  }, 300_000)
})

describe('survivingRanges', () => {
  it('後から上書きされる範囲を除外する', () => {
    // LBA 0 をゼロにしてから最後に MBR を書く場合、ゼロ書きは 1 バイトも残らない
    expect(survivingRanges({ diskOffset: 0, length: 512 }, [{ diskOffset: 0, length: 512 }])).toEqual([])
  })

  it('部分的な上書きでは残りを 2 つに割る', () => {
    expect(
      survivingRanges({ diskOffset: 0, length: 1000 }, [{ diskOffset: 400, length: 200 }]),
    ).toEqual([
      { start: 0, end: 400 },
      { start: 600, end: 1000 },
    ])
  })

  it('重ならなければそのまま残る', () => {
    expect(survivingRanges({ diskOffset: 0, length: 512 }, [{ diskOffset: 512, length: 512 }])).toEqual([
      { start: 0, end: 512 },
    ])
  })

  it('複数の後続書き込みを順に適用する', () => {
    expect(
      survivingRanges({ diskOffset: 0, length: 1000 }, [
        { diskOffset: 0, length: 100 },
        { diskOffset: 900, length: 100 },
      ]),
    ).toEqual([{ start: 100, end: 900 }])
  })
})

/**
 * 計画が失敗することを確かめる。
 * `expect(...).rejects` を使うと、失敗しなかったときに vitest が巨大な plan（64 MiB の
 * FAT イメージを含む）を整形しようとしてメモリを使い切るので、自前で捕まえる。
 */
async function expectPlanRejects(name: string, diskSizeBytes: number): Promise<Error> {
  try {
    await makePlan(name, diskSizeBytes)
  } catch (err) {
    return err as Error
  }
  throw new Error(`${diskSizeBytes} バイトのディスクで計画が成功してしまいました（失敗するはず）`)
}

/** 計画が成功することを確かめる（巨大なオブジェクトを assertion に渡さない）。 */
async function expectPlanResolves(name: string, diskSizeBytes: number): Promise<void> {
  const { plan } = await makePlan(name, diskSizeBytes)
  expect(plan.cidata.sizeBytes).toBeGreaterThan(0)
}

describe('レイアウトの安全性', () => {
  it('容量不足なら書き込み前に分かるエラーを出す', async () => {
    // 24.04.4 は 3.405 GB。CIDATA 64 MiB を足すと約 3.47 GB 必要なので 3.4 GB には入らない。
    const err = await expectPlanRejects('ubuntu-24.04.4-live-server-amd64', 3_400_000_000)
    expect(err).toBeInstanceOf(LayoutError)
    expect((err as LayoutError).reason).toBe('disk-too-small')
    // 画面に出るのは訳される側 (text)。文面ではなくキーと差し込み値を確かめる
    // （日本語の文面を正として固定すると、英語 UI が壊れても気づけない：落とし穴 56）。
    const text = (err as LayoutError).text
    expect(text.key).toBe('layout.diskTooSmall')
    // 必要な容量が具体的に示される（ユーザーがどの USB を用意すべきか分かる）
    expect(text.params?.required).toMatch(/^[\d.]+ GB$/)
    expect(text.params?.deviceSize).toMatch(/^[\d.]+ GB$/)
    expect(formatLocalized('en', text)).toMatch(/needs at least [\d.]+ GB/)
    // 開発者向けの message は日本語のまま残す（ログとバグ報告の突き合わせに使う）
    expect(err.message).toMatch(/too small/)
  })

  it('途中で切れた ISO を拒否する（重なった GPT を作らない）', async () => {
    // 途中までしかダウンロードできていない ISO を再現する。
    // ファイルサイズは小さいのに、ISO 由来のパーティション表は元のまま大きい。
    const iso = isoDevice('ubuntu-24.04.4-live-server-amd64')
    const truncated = Object.create(Object.getPrototypeOf(iso) as object) as typeof iso
    Object.assign(truncated, iso)
    Object.defineProperty(truncated, 'size', { value: 100 * 1024 * 1024, configurable: true })

    const inspection = await inspectIso(iso)
    const patchPlan = buildIsoPatches(inspection, { args: ['autoinstall'] })
    const err = await planUsbLayout({
      isoDevice: truncated,
      diskSizeBytes: USB_SIZE,
      patches: patchPlan.patches,
      seedFiles: SEED_FILES,
      random: fixedRandom(),
      timestamp: TS,
    }).then(
      () => null,
      (e: unknown) => e,
    )

    // 通してしまうと CIDATA が ISO9660 パーティションの内側に置かれた GPT ができ、
    // 読み戻し検証は「書いたものが読める」ので成功し、起動しない USB が出来上がる。
    expect(err).toBeInstanceOf(LayoutError)
    expect((err as LayoutError).reason).toBe('iso-truncated')
    const text = (err as LayoutError).text
    expect(text.key).toBe('layout.isoTruncated')
    expect(text.params?.partition).toBe('ISO9660')
    expect(text.params?.fileSize).toBe('0.10 GB')
    // 英語 UI でも「どこまで続いているはずか」が読める
    expect(formatLocalized('en', text)).toMatch(/truncated.*ISO9660.*only 0\.10 GB/s)
    expect((err as LayoutError).message).toMatch(/truncated/)
  })

  it('必要容量の計算が実際の計画と整合する', async () => {
    const iso = isoDevice('ubuntu-24.04.4-live-server-amd64')
    const min = minimumDiskSize(iso.size)
    expect(min).toBeGreaterThan(iso.size)
    await expectPlanResolves('ubuntu-24.04.4-live-server-amd64', min)
    const err = await expectPlanRejects('ubuntu-24.04.4-live-server-amd64', min - 1024 * 1024)
    expect(err).toBeInstanceOf(LayoutError)
  })

  it('最初の書き込みで MBR を消し、パーティションテーブルは最後に書く', async () => {
    const { plan } = await makePlan('ubuntu-24.04.4-live-server-amd64')
    expect(plan.ops[0]).toMatchObject({ kind: 'zero', diskOffset: 0, length: SECTOR_SIZE })
    // ラベルは訳される前のキーで確かめる（日本語の文面を固定しない：落とし穴 56）
    expect(plan.finalOps.map((o) => o.label.key)).toEqual([
      'writeOp.gptEntries',
      'writeOp.gptHeader',
      'writeOp.protectiveMbr',
    ])
    expect(plan.finalOps.at(-1)!.diskOffset).toBe(0)
  })

  it('すべての書き込みが 512 バイト境界に揃っている', async () => {
    const { plan } = await makePlan('ubuntu-24.04.4-live-server-amd64')
    for (const op of [...plan.ops, ...plan.finalOps]) {
      const len = op.kind === 'bytes' ? op.data.length : op.length
      expect(op.diskOffset % SECTOR_SIZE, `${op.label.key} のオフセット`).toBe(0)
      expect(len % SECTOR_SIZE, `${op.label.key} の長さ`).toBe(0)
    }
  })

  it('書き込み範囲が互いに重ならない（最後のテーブル書きを除く）', async () => {
    const { plan } = await makePlan('ubuntu-24.04.4-live-server-amd64')
    const ranges = plan.ops
      .filter((o) => o.diskOffset !== 0)
      .map((o) => ({
        s: o.diskOffset,
        e: o.diskOffset + (o.kind === 'bytes' ? o.data.length : o.length),
        l: o.label.key,
      }))
      .sort((a, b) => a.s - b.s)
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.s, `${ranges[i - 1]!.l} と ${ranges[i]!.l} が重複`).toBeGreaterThanOrEqual(
        ranges[i - 1]!.e,
      )
    }
  })

  it('中断すると MBR が消えたままになり、起動可能な USB に見えない', async () => {
    const { iso, plan, patchPlan } = await makePlan('ubuntu-24.04.4-live-server-amd64')
    const usb = new MemoryBlockDevice(USB_SIZE)
    const controller = new AbortController()
    let seen = 0
    await expect(
      executeWritePlan({
        plan,
        isoDevice: iso,
        targetDevice: usb,
        patches: patchPlan.patches,
        verify: false,
        onProgress: () => {
          if (++seen === 3) controller.abort()
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow(WriteCancelledError)

    // 経路が変わっても「USB は壊れている・作り直しが必要」が消えないように文言も持っている
    expect(new WriteCancelledError().text.key).toBe('write.cancelledBody')

    expect((await usb.read(0, SECTOR_SIZE)).every((b) => b === 0)).toBe(true)
    expect(await readGpt(usb)).toBeNull()
  }, 300_000)

  it('進捗が単調増加し、最後は総バイト数に一致する', async () => {
    const { iso, plan, patchPlan } = await makePlan('ubuntu-25.10-live-server-amd64')
    const usb = new MemoryBlockDevice(USB_SIZE)
    const seen: number[] = []
    let lastPhase = ''
    await executeWritePlan({
      plan,
      isoDevice: iso,
      targetDevice: usb,
      patches: patchPlan.patches,
      verify: false,
      onProgress: (p) => {
        seen.push(p.bytesDone)
        lastPhase = p.phase
        expect(p.bytesDone).toBeLessThanOrEqual(p.bytesTotal)
      },
    })
    expect(seen.length).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!)
    expect(seen.at(-1)).toBe(plan.totalBytes)
    expect(lastPhase).toBe('done')
  }, 300_000)
})

// 実機（Windows + KIOXIA 31GB）で見つかった不具合の回帰テスト。
//
// パーティションテーブルを書いた瞬間に Windows がディスクを再スキャンして
// CIDATA (FAT) を自動マウントし、`System Volume Information` を作る。
// 検証をその後に回していたため、正常に書けた USB でもハッシュが一致せず
// 「書き込みに失敗しました」になっていた。
// 対策は「本体の照合をパーティションテーブルより先に済ませる」こと。
describe('OS がマウントして書き込んでくる環境', () => {
  /**
   * LBA0 に有効なパーティションテーブルが書かれた瞬間、OS が CIDATA を
   * マウントしてディレクトリエントリを 1 つ作る、という状況を再現するデバイス。
   */
  class AutoMountingDevice extends MemoryBlockDevice {
    mounted = false
    /** CIDATA の先頭オフセット。ここに OS が書き込む。 */
    constructor(
      size: number,
      private readonly cidataOffset: number,
    ) {
      super(size)
    }

    override async write(offset: number, data: Buffer): Promise<void> {
      await super.write(offset, data)
      // MBR/GPT が書かれたらディスクが「使える」状態になり、OS がマウントする
      if (!this.mounted && offset === 0 && data.length >= SECTOR_SIZE) {
        this.mounted = true
        // OS が FAT のどこかに書き込む（System Volume Information の作成に相当）
        const dirt = Buffer.alloc(SECTOR_SIZE, 0x5a)
        await super.write(this.cidataOffset + 64 * SECTOR_SIZE, dirt)
      }
    }
  }

  it('テーブルを書く前に本体を照合するので、マウントされても検証は通る', async () => {
    const { iso, patchPlan, plan } = await makePlan(CASES[0]!)
    const usb = new AutoMountingDevice(USB_SIZE, plan.cidata.startLba * SECTOR_SIZE)
    const result = await executeWritePlan({
      plan,
      isoDevice: iso,
      targetDevice: usb,
      patches: patchPlan.patches,
      verify: true,
    })
    expect(result.verified).toBe(true)
    // 実際にマウントされた（＝テストが状況を再現できている）ことを確かめる
    expect(usb.mounted).toBe(true)
  })

  it('本体の照合はパーティションテーブルの書き込みより前に行われる', async () => {
    const { iso, patchPlan, plan } = await makePlan(CASES[0]!)
    const cidataOffset = plan.cidata.startLba * SECTOR_SIZE

    const order: string[] = []
    class RecordingDevice extends MemoryBlockDevice {
      override async write(offset: number, data: Buffer): Promise<void> {
        // finalOps は LBA0 から始まる（protective MBR + GPT）
        if (offset === 0 && data.length >= SECTOR_SIZE) order.push('write-table')
        await super.write(offset, data)
      }

      override async read(offset: number, length: number): Promise<Buffer> {
        if (offset >= cidataOffset && offset < cidataOffset + plan.cidata.sizeBytes) {
          order.push('verify-cidata')
        }
        return super.read(offset, length)
      }
    }

    const usb = new RecordingDevice(USB_SIZE)
    await executeWritePlan({
      plan,
      isoDevice: iso,
      targetDevice: usb,
      patches: patchPlan.patches,
      verify: true,
    })

    const firstVerify = order.indexOf('verify-cidata')
    // 最初の LBA0 書き込みは「テーブルを消す」ゼロ埋め。テーブルを書くのは最後。
    const lastTableWrite = order.lastIndexOf('write-table')
    expect(firstVerify).toBeGreaterThanOrEqual(0)
    expect(lastTableWrite).toBeGreaterThanOrEqual(0)
    expect(firstVerify).toBeLessThan(lastTableWrite)
  })

  it('本当に壊れていれば検証は落ちる（マウント対策で見逃さない）', async () => {
    const { iso, patchPlan, plan } = await makePlan(CASES[0]!)
    const cidataOffset = plan.cidata.startLba * SECTOR_SIZE
    class FlakyDevice extends MemoryBlockDevice {
      override async write(offset: number, data: Buffer): Promise<void> {
        // CIDATA の先頭セクタだけ書けていない不良メディアを模す
        if (offset === cidataOffset) return
        await super.write(offset, data)
      }
    }
    const usb = new FlakyDevice(USB_SIZE)
    let error: unknown = null
    try {
      await executeWritePlan({
        plan,
        isoDevice: iso,
        targetDevice: usb,
        patches: patchPlan.patches,
        verify: true,
      })
    } catch (e) {
      error = e
    }
    // 巨大なオブジェクトを expect に渡すと vitest が OOM するので自前で判定する
    expect(error).toBeInstanceOf(VerificationError)
    expect((error as VerificationError).diskOffset).toBe(cidataOffset)
    // 画面に出るのは text。訳される側にオフセットが乗っていることまで見る
    const text = (error as VerificationError).text
    expect(text.key).toBe('write.verifyMismatch')
    expect(text.params?.offset).toBe(cidataOffset)
    expect(formatLocalized('en', text)).toContain(`offset ${cidataOffset}`)
    // 開発者向けの message は日本語のまま。LocalizedText を素で埋めていないこと
    expect((error as VerificationError).message).not.toContain('[object Object]')
    expect((error as VerificationError).message).toContain('writeOp.cidata')
  })
})

// ---------------------------------------------------------------------------
// 画面に出る文言（LocalizedText）
// ---------------------------------------------------------------------------

/** その LocalizedText が両言語で「読める文」になることを確かめる。 */
function expectRenders(text: LocalizedText, where: string): void {
  // 辞書に無いキーは createTranslator がキー名をそのまま返すので、それを検出する
  expect(ja[text.key], `${where}: ja に ${text.key} が無い`).toBeTypeOf('string')
  expect(en[text.key], `${where}: en に ${text.key} が無い`).toBeTypeOf('string')
  for (const locale of LOCALES) {
    const rendered = formatLocalized(locale, text)
    expect(rendered, `${where} (${locale})`).not.toBe(text.key)
    // 差し込み忘れは `{name}` が残る（interpolate は空文字に落とさない）
    expect(
      placeholdersOf(rendered),
      `${where} (${locale}): 差し込みが埋まっていない`,
    ).toEqual([])
  }
  // 英語に日本語が残っていないこと（ここが日本語だと英語 UI で意味が通らない）
  expect(formatLocalized('en', text), `${where}: en に日本語`).not.toMatch(
    /[぀-ヿ一-鿿]/,
  )
}

describe('書き込み経路の文言が両言語で出せる', () => {
  it('すべての WriteOp のラベルが ja / en の両方で読める', async () => {
    const { plan } = await makePlan(CASES[0]!)
    const ops = [...plan.ops, ...plan.finalOps]
    expect(ops.length).toBeGreaterThan(0)
    for (const op of ops) expectRenders(op.label, `WriteOp ${op.kind}`)
  })

  it('進捗ラベルは JSON を往復しても同じもの（IPC と NDJSON を通る）', async () => {
    const { iso, plan, patchPlan } = await makePlan(CASES[0]!)
    const usb = new MemoryBlockDevice(USB_SIZE)
    const labels: LocalizedText[] = []
    const phases = new Set<string>()
    await executeWritePlan({
      plan,
      isoDevice: iso,
      targetDevice: usb,
      patches: patchPlan.patches,
      verify: true,
      onProgress: (pr) => {
        phases.add(pr.phase)
        if (!labels.some((l) => l.key === pr.label.key)) labels.push(pr.label)
      },
    })
    // 進捗・検証・完了の 3 系統のラベルが出ている
    expect(phases.has('writing')).toBe(true)
    expect(labels.map((l) => l.key)).toContain('writeOp.verifying')
    expect(labels.map((l) => l.key)).toContain('write.done')
    for (const label of labels) {
      // 関数・Symbol・undefined を持たないこと。持つと NDJSON で別物になる
      const roundTripped = JSON.parse(JSON.stringify(label)) as LocalizedText
      expect(roundTripped).toEqual(label)
      expect(formatLocalized('ja', roundTripped)).toBe(formatLocalized('ja', label))
      expectRenders(label, `進捗 ${label.key}`)
    }
  }, 300_000)

  it('レイアウトの失敗はすべて両言語で読める文言を持つ', async () => {
    // 24.04.4 は 3.405 GB。CIDATA を足すと 3.4 GB には入らない
    const tooSmall = await expectPlanRejects('ubuntu-24.04.4-live-server-amd64', 3_400_000_000)
    expectRenders((tooSmall as LayoutError).text, 'disk-too-small')

    // GPT / protective MBR が無い ISO は「対応していない形式」として弾かれる
    const blank = new MemoryBlockDevice(64 * 1024 * 1024)
    const err = await planUsbLayout({
      isoDevice: blank,
      diskSizeBytes: USB_SIZE,
      patches: [],
      seedFiles: SEED_FILES,
      random: fixedRandom(),
      timestamp: TS,
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(LayoutError)
    expect((err as LayoutError).reason).toBe('not-protective-mbr')
    expect((err as LayoutError).text.key).toBe('layout.notProtectiveMbr')
    expectRenders((err as LayoutError).text, 'not-protective-mbr')
  })

  it('USB が抜けて書き込みが止まったときの文言が両言語で読める', () => {
    // 実運用で最も起きやすい失敗。`RawBlockDevice` はアプリ本体で USB を書く唯一の
    // 実装（落とし穴 32）なので、ここが日本語のままだと英語 UI で意味不明になる。
    const stalled = new DeviceWriteStalledError(1024)
    expect(stalled.name).toBe('DeviceWriteStalledError')
    // 「抜けたかもしれない・挿し直して作り直す」と伝える文言であること。
    // 単に「両言語で読める」だけだと、別のキーに差し替わっても気づけない。
    expect(stalled.text.key).toBe('write.deviceStalled')
    expectRenders(stalled.text, 'device-write-stalled')
    // 開発者向けの message にはオフセットが残る（訳文には載せない）
    expect(stalled.message).toContain('offset=1024')
    expect(stalled.text.params).toBeUndefined()
  })
})
