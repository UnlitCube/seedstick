import { crc32 } from 'node:zlib'
import { SECTOR_SIZE, type BlockDevice } from '../blockdev/index.js'

// GPT / protective MBR の読み書き。UEFI 仕様 2.x の GPT ヘッダ定義に従う。
// CRC32 は IEEE 802.3（多項式 0xEDB88320、初期値・最終 XOR とも 0xFFFFFFFF）で、
// zlib の crc32 と同一なので node:zlib の実装をそのまま使う。

export const GPT_SIGNATURE = 'EFI PART'
export const GPT_HEADER_SIZE = 92
export const GPT_ENTRY_SIZE = 128

/** よく使う Partition Type GUID */
export const PARTITION_TYPE = {
  EFI_SYSTEM: 'C12A7328-F81F-11D2-BA4B-00A0C93EC93B',
  MICROSOFT_BASIC_DATA: 'EBD0A0A2-B9E5-4433-87C0-68B6B72699C7',
  LINUX_FILESYSTEM: '0FC63DAF-8483-4772-8E79-3D69D8477DE4',
} as const

/** GPT の属性ビット */
export const GPT_ATTR = {
  /** bit 0: プラットフォーム必須（OS が勝手に消してはいけない） */
  PLATFORM_REQUIRED: 1n << 0n,
  /** bit 60: 読み取り専用 */
  READ_ONLY: 1n << 60n,
  /** bit 63: Windows でドライブレターを割り当てない */
  NO_DRIVE_LETTER: 1n << 63n,
} as const

export interface GptPartitionEntry {
  readonly index: number
  readonly typeGuid: string
  readonly uniqueGuid: string
  readonly startLba: number
  /** 最終 LBA（この LBA を含む） */
  readonly endLba: number
  readonly attributes: bigint
  readonly name: string
}

export interface GptHeader {
  readonly revision: number
  readonly headerSize: number
  readonly headerCrc32: number
  readonly myLba: number
  readonly alternateLba: number
  readonly firstUsableLba: number
  readonly lastUsableLba: number
  readonly diskGuid: string
  readonly partitionEntryLba: number
  readonly numberOfPartitionEntries: number
  readonly sizeOfPartitionEntry: number
  readonly partitionEntryArrayCrc32: number
}

export interface GptInfo {
  readonly header: GptHeader
  readonly entries: readonly GptPartitionEntry[]
  /** ヘッダの CRC32 が一致したか */
  readonly headerCrcValid: boolean
  /** エントリ配列の CRC32 が一致したか */
  readonly entriesCrcValid: boolean
}

export interface MbrPartitionEntry {
  readonly status: number
  readonly type: number
  readonly startLba: number
  readonly sectors: number
}

export interface MbrInfo {
  readonly hasBootCode: boolean
  readonly diskSignature: number
  readonly entries: readonly MbrPartitionEntry[]
  readonly valid: boolean
  /** エントリ 1 が 0xEE なら protective MBR（Windows は GPT を採用する） */
  readonly isProtective: boolean
}

// ---------------------------------------------------------------------------
// GUID（mixed-endian）
// ---------------------------------------------------------------------------

/**
 * GPT の GUID はテキスト表記と格納バイト順が違う。
 * 最初の 3 グループ (4/2/2 バイト) はリトルエンディアン、残り 8 バイトはそのまま。
 */
export function guidToString(buf: Buffer): string {
  const rev = (s: number, e: number): string =>
    Buffer.from(buf.subarray(s, e)).reverse().toString('hex')
  return [
    rev(0, 4),
    rev(4, 6),
    rev(6, 8),
    buf.subarray(8, 10).toString('hex'),
    buf.subarray(10, 16).toString('hex'),
  ]
    .join('-')
    .toUpperCase()
}

export function guidToBuffer(guid: string): Buffer {
  const hex = guid.replace(/-/g, '').toLowerCase()
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`GUID の形式が不正です: ${guid}`)
  }
  const raw = Buffer.from(hex, 'hex')
  const out = Buffer.alloc(16)
  Buffer.from(raw.subarray(0, 4)).reverse().copy(out, 0)
  Buffer.from(raw.subarray(4, 6)).reverse().copy(out, 4)
  Buffer.from(raw.subarray(6, 8)).reverse().copy(out, 6)
  raw.subarray(8, 16).copy(out, 8)
  return out
}

/** ランダムな GUID（RFC 4122 version 4）を作る。 */
export function randomGuid(random: (n: number) => Buffer): string {
  const b = random(16)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = b.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ]
    .join('-')
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

export function parseMbr(buf: Buffer): MbrInfo {
  const entries: MbrPartitionEntry[] = []
  for (let i = 0; i < 4; i++) {
    const o = 446 + i * 16
    entries.push({
      status: buf[o]!,
      type: buf[o + 4]!,
      startLba: buf.readUInt32LE(o + 8),
      sectors: buf.readUInt32LE(o + 12),
    })
  }
  return {
    hasBootCode: buf.subarray(0, 440).some((x) => x !== 0),
    diskSignature: buf.readUInt32LE(440),
    entries,
    valid: buf.readUInt16LE(510) === 0xaa55,
    isProtective: entries[0]!.type === 0xee,
  }
}

function parseGptHeader(buf: Buffer): GptHeader {
  return {
    revision: buf.readUInt32LE(8),
    headerSize: buf.readUInt32LE(12),
    headerCrc32: buf.readUInt32LE(16),
    myLba: Number(buf.readBigUInt64LE(24)),
    alternateLba: Number(buf.readBigUInt64LE(32)),
    firstUsableLba: Number(buf.readBigUInt64LE(40)),
    lastUsableLba: Number(buf.readBigUInt64LE(48)),
    diskGuid: guidToString(buf.subarray(56, 72)),
    partitionEntryLba: Number(buf.readBigUInt64LE(72)),
    numberOfPartitionEntries: buf.readUInt32LE(80),
    sizeOfPartitionEntry: buf.readUInt32LE(84),
    partitionEntryArrayCrc32: buf.readUInt32LE(88),
  }
}

function parseGptEntries(buf: Buffer, count: number, entrySize: number): GptPartitionEntry[] {
  const out: GptPartitionEntry[] = []
  for (let i = 0; i < count; i++) {
    const e = buf.subarray(i * entrySize, (i + 1) * entrySize)
    if (e.length < GPT_ENTRY_SIZE) break
    if (e.subarray(0, 16).every((x) => x === 0)) continue
    out.push({
      index: i,
      typeGuid: guidToString(e.subarray(0, 16)),
      uniqueGuid: guidToString(e.subarray(16, 32)),
      startLba: Number(e.readBigUInt64LE(32)),
      endLba: Number(e.readBigUInt64LE(40)),
      attributes: e.readBigUInt64LE(48),
      name: e.subarray(56, 128).toString('utf16le').replace(/\0+$/, ''),
    })
  }
  return out
}

/** ヘッダの CRC32 を計算する（CRC フィールドをゼロにして headerSize バイトを対象にする）。 */
export function computeHeaderCrc(headerBuf: Buffer, headerSize: number): number {
  const tmp = Buffer.from(headerBuf.subarray(0, headerSize))
  tmp.writeUInt32LE(0, 16)
  return crc32(tmp) >>> 0
}

export async function readGpt(dev: BlockDevice, headerLba = 1): Promise<GptInfo | null> {
  const headerSector = await dev.read(headerLba * SECTOR_SIZE, SECTOR_SIZE)
  if (headerSector.subarray(0, 8).toString('latin1') !== GPT_SIGNATURE) return null
  const header = parseGptHeader(headerSector)
  const entriesBytes = header.numberOfPartitionEntries * header.sizeOfPartitionEntry
  const entriesBuf = await dev.read(header.partitionEntryLba * SECTOR_SIZE, entriesBytes)
  return {
    header,
    entries: parseGptEntries(entriesBuf, header.numberOfPartitionEntries, header.sizeOfPartitionEntry),
    headerCrcValid: computeHeaderCrc(headerSector, header.headerSize) === header.headerCrc32,
    entriesCrcValid: (crc32(entriesBuf) >>> 0) === header.partitionEntryArrayCrc32,
  }
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

export interface BuildGptOptions {
  /** ディスク全体のセクタ数（512B 単位） */
  readonly diskSectors: number
  readonly diskGuid: string
  readonly entries: readonly Omit<GptPartitionEntry, 'index'>[]
  readonly numberOfPartitionEntries: number
  /** 通常 2。ISO 由来の値をそのまま使う。 */
  readonly partitionEntryLba: number
  readonly firstUsableLba: number
}

export interface GptImage {
  /** LBA1 に書くプライマリヘッダ（512B） */
  readonly primaryHeader: Buffer
  /** partitionEntryLba に書くエントリ配列 */
  readonly entryArray: Buffer
  /** バックアップエントリ配列を書く LBA */
  readonly backupEntriesLba: number
  /** バックアップヘッダを書く LBA（= 最終 LBA） */
  readonly backupHeaderLba: number
  readonly backupHeader: Buffer
  readonly lastUsableLba: number
}

function buildEntryArray(opts: BuildGptOptions): Buffer {
  const arr = Buffer.alloc(opts.numberOfPartitionEntries * GPT_ENTRY_SIZE)
  opts.entries.forEach((e, i) => {
    const o = i * GPT_ENTRY_SIZE
    guidToBuffer(e.typeGuid).copy(arr, o)
    guidToBuffer(e.uniqueGuid).copy(arr, o + 16)
    arr.writeBigUInt64LE(BigInt(e.startLba), o + 32)
    arr.writeBigUInt64LE(BigInt(e.endLba), o + 40)
    arr.writeBigUInt64LE(e.attributes, o + 48)
    // 名前は UTF-16LE、最大 36 文字（72 バイト）
    const name = Buffer.from(e.name.slice(0, 36), 'utf16le')
    name.copy(arr, o + 56, 0, Math.min(name.length, 72))
  })
  return arr
}

function buildHeader(
  opts: BuildGptOptions,
  myLba: number,
  alternateLba: number,
  entryLba: number,
  lastUsableLba: number,
  entriesCrc: number,
): Buffer {
  const h = Buffer.alloc(SECTOR_SIZE)
  h.write(GPT_SIGNATURE, 0, 'latin1')
  h.writeUInt32LE(0x00010000, 8)
  h.writeUInt32LE(GPT_HEADER_SIZE, 12)
  h.writeUInt32LE(0, 16) // CRC は後で
  h.writeUInt32LE(0, 20) // reserved
  h.writeBigUInt64LE(BigInt(myLba), 24)
  h.writeBigUInt64LE(BigInt(alternateLba), 32)
  h.writeBigUInt64LE(BigInt(opts.firstUsableLba), 40)
  h.writeBigUInt64LE(BigInt(lastUsableLba), 48)
  guidToBuffer(opts.diskGuid).copy(h, 56)
  h.writeBigUInt64LE(BigInt(entryLba), 72)
  h.writeUInt32LE(opts.numberOfPartitionEntries, 80)
  h.writeUInt32LE(GPT_ENTRY_SIZE, 84)
  h.writeUInt32LE(entriesCrc, 88)
  h.writeUInt32LE(computeHeaderCrc(h, GPT_HEADER_SIZE), 16)
  return h
}

/**
 * ディスク全体に合わせた GPT 一式を作る。
 * ISO を raw 書き込みした USB では ISO 末尾にバックアップ GPT が残るため、
 * ディスク末尾に正しいバックアップを書き直す必要がある（そうしないと OS が GPT を壊れていると判断する）。
 */
export function buildGpt(opts: BuildGptOptions): GptImage {
  const entryArray = buildEntryArray(opts)
  const entriesCrc = crc32(entryArray) >>> 0
  const entrySectors = Math.ceil(entryArray.length / SECTOR_SIZE)
  const backupHeaderLba = opts.diskSectors - 1
  const backupEntriesLba = backupHeaderLba - entrySectors
  const lastUsableLba = backupEntriesLba - 1
  if (lastUsableLba <= opts.firstUsableLba) {
    throw new Error('ディスクが小さすぎて GPT を構成できません。')
  }
  for (const e of opts.entries) {
    if (e.endLba > lastUsableLba) {
      throw new Error(
        `パーティション "${e.name}" の終端 (LBA ${e.endLba}) が使用可能領域の末尾 (LBA ${lastUsableLba}) を超えています。`,
      )
    }
  }
  return {
    primaryHeader: buildHeader(opts, 1, backupHeaderLba, opts.partitionEntryLba, lastUsableLba, entriesCrc),
    entryArray,
    backupEntriesLba,
    backupHeaderLba,
    backupHeader: buildHeader(opts, backupHeaderLba, 1, backupEntriesLba, lastUsableLba, entriesCrc),
    lastUsableLba,
  }
}

/**
 * protective MBR を作る。既存の MBR（GRUB のブートコードを含む）を保ったまま、
 * 0xEE エントリのサイズだけをディスクサイズに合わせて更新する。
 */
export function updateProtectiveMbr(originalMbr: Buffer, diskSectors: number): Buffer {
  const out = Buffer.from(originalMbr)
  // 0xEE エントリは 1 から始まりディスク末尾まで。2 TiB を超える場合は 0xFFFFFFFF で飽和させる。
  const sectors = Math.min(diskSectors - 1, 0xffffffff)
  for (let i = 0; i < 4; i++) {
    const o = 446 + i * 16
    if (out[o + 4] === 0xee) {
      out.writeUInt32LE(1, o + 8)
      out.writeUInt32LE(sectors, o + 12)
      // CHS は LBA 専用を示す 0xFE 0xFF 0xFF を維持（元の ISO の値をそのまま使う）
    }
  }
  out.writeUInt16LE(0xaa55, 510)
  return out
}
