import { beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
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
] as const

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

  it('パッチは grub.cfg セクタ / レコード 2 つ / md5sum の 4 か所だけ', () => {
    expect(w.patchPlan.patches.map((p) => p.label)).toEqual([
      'grub.cfg の内容',
      'grub.cfg のサイズ (ISO9660)',
      'grub.cfg のサイズ (Joliet)',
      'md5sum.txt の grub.cfg 行',
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

  it('md5sum.txt の grub.cfg 行が新しい内容の MD5 に更新される', async () => {
    const structure = await readIsoStructure(w.usb)
    const md5 = await resolvePath(w.usb, structure.pvd.rootRecord, '/md5sum.txt')
    const text = (await readFile(w.usb, md5!.record)).toString('utf8')
    const line = text.split('\n').find((l) => l.endsWith('  ./boot/grub/grub.cfg'))
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
    expect(err.message).toMatch(/容量が足りません/)
    // 必要な容量が具体的に示される（ユーザーがどの USB を用意すべきか分かる）
    expect(err.message).toMatch(/少なくとも [\d.]+ GB 必要/)
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
    expect(plan.finalOps.map((o) => o.label)).toEqual([
      'GPT パーティションエントリ',
      'GPT ヘッダ',
      'protective MBR (GRUB ブートコード込み)',
    ])
    expect(plan.finalOps.at(-1)!.diskOffset).toBe(0)
  })

  it('すべての書き込みが 512 バイト境界に揃っている', async () => {
    const { plan } = await makePlan('ubuntu-24.04.4-live-server-amd64')
    for (const op of [...plan.ops, ...plan.finalOps]) {
      const len = op.kind === 'bytes' ? op.data.length : op.length
      expect(op.diskOffset % SECTOR_SIZE, `${op.label} のオフセット`).toBe(0)
      expect(len % SECTOR_SIZE, `${op.label} の長さ`).toBe(0)
    }
  })

  it('書き込み範囲が互いに重ならない（最後のテーブル書きを除く）', async () => {
    const { plan } = await makePlan('ubuntu-24.04.4-live-server-amd64')
    const ranges = plan.ops
      .filter((o) => o.diskOffset !== 0)
      .map((o) => ({
        s: o.diskOffset,
        e: o.diskOffset + (o.kind === 'bytes' ? o.data.length : o.length),
        l: o.label,
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
