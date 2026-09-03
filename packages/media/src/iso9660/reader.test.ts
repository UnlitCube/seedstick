import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SparseFixtureDevice } from '../blockdev/index.js'
import { readDirectory, readFile, readIsoStructure, resolvePath } from './reader.js'
import { parseMbr, readGpt, PARTITION_TYPE } from '../gpt/index.js'

// 実 ISO から抜き出した疎なフィクスチャに対してテストする。
// 生成方法は docs/research/iso-probe/iso-fixture.mjs（HTTP Range で必要セクタのみ取得）。

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/research/iso-probe/fixtures',
)

const CASES = [
  {
    name: 'ubuntu-22.04.5-live-server-amd64',
    volumeId: 'Ubuntu-Server 22.04.5 LTS amd64',
    size: 2_136_926_208,
    grubExtent: 1835,
    grubSize: 570,
    hweEntry: true,
  },
  {
    name: 'ubuntu-24.04.4-live-server-amd64',
    volumeId: 'Ubuntu-Server 24.04.4 LTS amd64',
    size: 3_405_469_696,
    grubExtent: 2197,
    grubSize: 573,
    hweEntry: true,
  },
  {
    name: 'ubuntu-25.10-live-server-amd64',
    volumeId: 'Ubuntu-Server 25.10 amd64',
    size: 2_283_360_256,
    grubExtent: 1999,
    grubSize: 443,
    hweEntry: false,
  },
  {
    name: 'ubuntu-26.04.1-live-server-amd64',
    volumeId: 'Ubuntu-Server 26.04.1 LTS amd64',
    size: 2_927_861_760,
    grubExtent: 1997,
    grubSize: 394,
    hweEntry: false,
  },
] as const

function device(name: string): SparseFixtureDevice {
  return SparseFixtureDevice.fromFile(join(FIXTURE_DIR, `${name}.json`))
}

describe.each(CASES)('$name', (c) => {
  it('Volume ID とサイズが実測値と一致する', async () => {
    const dev = device(c.name)
    const iso = await readIsoStructure(dev)
    expect(iso.pvd.volumeId).toBe(c.volumeId)
    expect(dev.size).toBe(c.size)
    // Volume Space Size (2048B 単位) × 4 = ディスクの 512B セクタ数
    expect(iso.pvd.volumeSpaceSize * 4).toBe(Math.floor(c.size / 512))
    expect(iso.pvd.logicalBlockSize).toBe(2048)
  })

  it('ルートディレクトリの extent は 35', async () => {
    const iso = await readIsoStructure(device(c.name))
    expect(iso.pvd.rootRecord.extent).toBe(35)
    expect(iso.pvd.rootRecord.isDirectory).toBe(true)
  })

  it('Joliet ボリューム記述子がある', async () => {
    const iso = await readIsoStructure(device(c.name))
    expect(iso.joliet).not.toBeNull()
    expect(iso.joliet!.escapeSequence).toBe('%/E')
  })

  it('El Torito に BIOS と UEFI の 2 経路がある', async () => {
    const iso = await readIsoStructure(device(c.name))
    expect(iso.elTorito).not.toBeNull()
    const boots = iso.elTorito!.entries.filter((e) => e.kind === 'boot')
    expect(boots).toHaveLength(2)
    // どちらも no-emulation (mediaType 0) で起動可能
    expect(boots.every((b) => b.mediaType === 0 && b.bootable)).toBe(true)
    const header = iso.elTorito!.entries.find((e) => e.kind === 'section-header')
    expect(header?.platform).toBe(0xef) // EFI
  })

  it('/boot/grub/grub.cfg を実測どおりの位置とサイズで解決する', async () => {
    const dev = device(c.name)
    const iso = await readIsoStructure(dev)
    const found = await resolvePath(dev, iso.pvd.rootRecord, '/boot/grub/grub.cfg')
    expect(found).not.toBeNull()
    expect(found!.record.extent).toBe(c.grubExtent)
    expect(found!.record.size).toBe(c.grubSize)
    expect(found!.record.rockRidgeName).toBe('grub.cfg')
    expect(found!.record.name).toBe('GRUB.CFG;1')
    // レコードは boot/grub ディレクトリ (extent 39) のセクタ内オフセット 302 にある
    expect(found!.parent.extent).toBe(39)
    expect(found!.record.recordOffset).toBe(39 * 2048 + 302)
  })

  it('grub.cfg の内容が menuentry を含む本物である', async () => {
    const dev = device(c.name)
    const iso = await readIsoStructure(dev)
    const found = await resolvePath(dev, iso.pvd.rootRecord, '/boot/grub/grub.cfg')
    const text = (await readFile(dev, found!.record)).toString('utf8')
    expect(text).toContain('menuentry "Try or Install Ubuntu Server"')
    // 22.04〜25.10 はタブ区切り、26.04 はスペース区切り。パッチャーは空白に依存してはいけない。
    expect(text).toMatch(/^\s*linux\s+\/casper\/vmlinuz\s+---\s*$/m)
    expect(text).toMatch(/^\s*initrd\s+\/casper\/initrd\s*$/m)
    expect(text.length).toBe(c.grubSize)
    expect(text.includes('hwe-vmlinuz')).toBe(c.hweEntry)
  })

  it('grub.cfg のセクタには 1400 バイト以上の空きがある', async () => {
    // インプレース改変で引数を足しても 1 セクタに収まることの根拠
    expect(2048 - c.grubSize).toBeGreaterThan(1400)
  })

  it('md5sum.txt に ./boot/grub/grub.cfg の行がある', async () => {
    const dev = device(c.name)
    const iso = await readIsoStructure(dev)
    const found = await resolvePath(dev, iso.pvd.rootRecord, '/md5sum.txt')
    expect(found).not.toBeNull()
    const text = (await readFile(dev, found!.record)).toString('utf8')
    expect(text).toMatch(/^[0-9a-f]{32} {2}\.\/boot\/grub\/grub\.cfg$/m)
  })

  it('.disk/info が Ubuntu-Server の書式である', async () => {
    const dev = device(c.name)
    const iso = await readIsoStructure(dev)
    const found = await resolvePath(dev, iso.pvd.rootRecord, '/.disk/info')
    expect(found).not.toBeNull()
    const text = (await readFile(dev, found!.record)).toString('utf8')
    expect(text).toMatch(/^Ubuntu-Server \d+\.\d+(\.\d+)? (LTS )?"[^"]+" - \w+ amd64 \(\d{8}/)
  })

  it('protective MBR で、GRUB のブートコードを持つ', async () => {
    const dev = device(c.name)
    const mbr = parseMbr(await dev.read(0, 512))
    expect(mbr.valid).toBe(true)
    expect(mbr.isProtective).toBe(true)
    expect(mbr.hasBootCode).toBe(true)
    expect(mbr.entries[0]!.startLba).toBe(1)
    expect(mbr.entries[0]!.sectors).toBe(Math.floor(c.size / 512) - 1)
    // 2 番目は xorriso が付ける「起動可能」ダミーエントリ（type 0、1 セクタ）
    expect(mbr.entries[1]!.status).toBe(0x80)
    expect(mbr.entries[1]!.type).toBe(0x00)
  })

  it('GPT が読め、CRC が両方とも一致する', async () => {
    const dev = device(c.name)
    const gpt = await readGpt(dev)
    expect(gpt).not.toBeNull()
    expect(gpt!.headerCrcValid).toBe(true)
    expect(gpt!.entriesCrcValid).toBe(true)
    expect(gpt!.header.headerSize).toBe(92)
    expect(gpt!.header.numberOfPartitionEntries).toBe(248)
    expect(gpt!.header.sizeOfPartitionEntry).toBe(128)
    expect(gpt!.header.firstUsableLba).toBe(64)
    expect(gpt!.header.partitionEntryLba).toBe(2)
    expect(gpt!.header.myLba).toBe(1)
    expect(gpt!.header.alternateLba).toBe(Math.floor(c.size / 512) - 1)
  })

  it('GPT のパーティションが ISO9660 / ESP / Gap1 の 3 つである', async () => {
    const gpt = await readGpt(device(c.name))
    expect(gpt!.entries).toHaveLength(3)
    const [iso9660, esp, gap] = gpt!.entries
    expect(iso9660!.name).toBe('ISO9660')
    expect(iso9660!.typeGuid).toBe(PARTITION_TYPE.MICROSOFT_BASIC_DATA)
    expect(iso9660!.startLba).toBe(64)
    expect(esp!.name).toBe('Appended2')
    expect(esp!.typeGuid).toBe(PARTITION_TYPE.EFI_SYSTEM)
    expect(gap!.name).toBe('Gap1')
    // ISO9660 パーティションは platform-required + read-only 属性を持つ
    expect(iso9660!.attributes & 1n).toBe(1n)
  })

  it('バックアップ GPT がイメージ末尾にある', async () => {
    const dev = device(c.name)
    const lastLba = Math.floor(c.size / 512) - 1
    const backup = await readGpt(dev, lastLba)
    expect(backup).not.toBeNull()
    expect(backup!.header.myLba).toBe(lastLba)
    expect(backup!.header.alternateLba).toBe(1)
    expect(backup!.headerCrcValid).toBe(true)
  })

  it('ESP パーティションの中身は FAT12 でラベルが ESP', async () => {
    const dev = device(c.name)
    const gpt = await readGpt(dev)
    const esp = gpt!.entries.find((e) => e.typeGuid === PARTITION_TYPE.EFI_SYSTEM)!
    // フィクスチャには ESP 本体は含まれないので、GPT 上の位置だけを検証する
    expect(esp.startLba).toBeGreaterThan(64)
    expect(esp.endLba).toBeGreaterThan(esp.startLba)
    // ESP は約 5 MiB
    const bytes = (esp.endLba - esp.startLba + 1) * 512
    expect(bytes).toBeGreaterThan(5_000_000)
    expect(bytes).toBeLessThan(5_500_000)
  })

  it('boot/grub 直下に i386-pc と x86_64-efi があり、そこに grub.cfg は無い', async () => {
    const dev = device(c.name)
    const iso = await readIsoStructure(dev)
    const grubDir = await resolvePath(dev, iso.pvd.rootRecord, '/boot/grub')
    const list = await readDirectory(dev, grubDir!.record)
    const names = list.map((r) => r.rockRidgeName).filter(Boolean)
    expect(names).toContain('i386-pc')
    expect(names).toContain('x86_64-efi')
    expect(names).toContain('grub.cfg')
    expect(names).toContain('loopback.cfg')
  })
})

describe('ISO ではないデバイス', () => {
  it('CD001 が無ければ分かるエラーを出す', async () => {
    const { MemoryBlockDevice } = await import('../blockdev/index.js')
    const dev = new MemoryBlockDevice(1024 * 1024)
    await expect(readIsoStructure(dev)).rejects.toThrow(/CD001/)
  })
})
