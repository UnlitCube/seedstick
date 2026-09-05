// FAT12/16/32 のイメージを一から作る。cloud-init の NoCloud seed（ラベル CIDATA）用。
//
// 実装の根拠は Microsoft の "FAT: General Overview of On-Disk Format" (v1.03) と
// VFAT 長いファイル名の仕様。`user-data` / `meta-data` は 8.3 名に収まらないので LFN が必須。
//
// 設計方針: 追記や削除は扱わない。ファイル一覧を受け取って一度きり書き出すだけ。
// これで FAT の複雑さの大半（空きクラスタ探索、断片化、ディレクトリの伸長）を回避できる。

export const BYTES_PER_SECTOR = 512

export interface FatFile {
  /** ファイル名（大文字小文字と長さは自由。必要に応じて LFN で書く） */
  readonly name: string
  readonly content: Buffer
}

export type FatType = 12 | 16 | 32

export interface BuildFatOptions {
  /** イメージ全体のバイト数。512 の倍数であること。 */
  readonly sizeBytes: number
  /** ボリュームラベル（11 文字まで、大文字化される）。cloud-init は `cidata` を大文字小文字無視で探す。 */
  readonly label: string
  readonly files: readonly FatFile[]
  /** このパーティションのディスク上の開始 LBA（BPB_HiddSec に入れる） */
  readonly hiddenSectors: number
  /** ボリューム ID（4 バイト整数）。再現性のため呼び出し側が決める。 */
  readonly volumeId: number
  /** ファイルのタイムスタンプ。再現性のため呼び出し側が決める。 */
  readonly timestamp: Date
  /** 明示的に FAT の種類を選ぶ（既定はサイズから自動選択） */
  readonly forceFatType?: FatType
}

export interface FatImage {
  readonly data: Buffer
  readonly fatType: FatType
  readonly sectorsPerCluster: number
  readonly clusterCount: number
  readonly usedClusters: number
}

// ---------------------------------------------------------------------------
// 8.3 名と LFN
// ---------------------------------------------------------------------------

// 判定用（`test` に使う）。**`/g` を付けてはいけない。**
// `/g` の正規表現は `test` を呼ぶたびに lastIndex が進むため純関数でなくなり、
// 同じ名前を続けて判定すると結果が交互に変わる（実際に再現した）。
// LFN が必要なのに短縮名だけで書かれた FAT ができ、ルートディレクトリの
// 予約数も名前の並び順しだいで狂う。
const INVALID_SHORT_CHARS = /[^A-Z0-9!#$%&'()\-@^_`{}~ ]/
// 置換用（`replace` に使う）。こちらは全置換したいので `/g` が要る。
const INVALID_SHORT_CHARS_ALL = /[^A-Z0-9!#$%&'()\-@^_`{}~ ]/g

/** LFN が必要か（8.3 にそのまま収まらないか）を判定する。 */
export function needsLongName(name: string): boolean {
  if (name !== name.toUpperCase()) return true
  const dot = name.lastIndexOf('.')
  const base = dot < 0 ? name : name.slice(0, dot)
  const ext = dot < 0 ? '' : name.slice(dot + 1)
  if (base.length === 0 || base.length > 8 || ext.length > 3) return true
  if (name.slice(dot + 1).includes('.')) return true
  return INVALID_SHORT_CHARS.test(base) || INVALID_SHORT_CHARS.test(ext)
}

/**
 * 8.3 の短縮名を作る。既存名と衝突したら `~1`, `~2` … と番号を振る。
 * 例: `user-data` → `USER-D~1`
 */
export function makeShortName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.')
  const rawBase = (dot <= 0 ? name : name.slice(0, dot)).toUpperCase()
  const rawExt = (dot <= 0 ? '' : name.slice(dot + 1)).toUpperCase()
  const clean = (s: string): string => s.replace(/\./g, '').replace(INVALID_SHORT_CHARS_ALL, '_')
  const base = clean(rawBase)
  const ext = clean(rawExt).slice(0, 3)

  const pad = (b: string, e: string): string => b.padEnd(8, ' ') + e.padEnd(3, ' ')
  const simple = pad(base.slice(0, 8), ext)
  if (!needsLongName(name) && !taken.has(simple)) return simple

  for (let n = 1; n < 1_000_000; n++) {
    const suffix = `~${n}`
    const candidate = pad(base.slice(0, Math.max(1, 8 - suffix.length)) + suffix, ext)
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`短縮名を作れませんでした: ${name}`)
}

/** LFN エントリが参照する 8.3 名のチェックサム。 */
export function shortNameChecksum(shortName11: string): number {
  let sum = 0
  for (let i = 0; i < 11; i++) {
    sum = (((sum & 1) << 7) + (sum >>> 1) + shortName11.charCodeAt(i)) & 0xff
  }
  return sum
}

function dosDate(d: Date): number {
  const year = Math.max(1980, d.getUTCFullYear())
  return ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
}

function dosTime(d: Date): number {
  return (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)
}

/** LFN エントリ列を作る（ディスク上は逆順＝シーケンス番号の大きい方が先）。 */
function buildLfnEntries(longName: string, checksum: number): Buffer[] {
  // UTF-16 コードユニット列。1 エントリに 13 ユニット入る。
  const units: number[] = []
  for (const ch of longName) {
    const s = ch.codePointAt(0)!
    if (s > 0xffff) {
      // サロゲートペア
      const v = s - 0x10000
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    } else {
      units.push(s)
    }
  }
  units.push(0) // NUL 終端
  while (units.length % 13 !== 0) units.push(0xffff) // 残りは 0xFFFF で埋める

  const count = units.length / 13
  const entries: Buffer[] = []
  for (let i = 0; i < count; i++) {
    const e = Buffer.alloc(32)
    const seq = i + 1
    e[0] = seq | (seq === count ? 0x40 : 0) // 最後のエントリに終端フラグ
    e[11] = 0x0f // ATTR_LONG_NAME
    e[12] = 0
    e[13] = checksum
    e.writeUInt16LE(0, 26) // FstClusLO は常に 0
    const chunk = units.slice(i * 13, i * 13 + 13)
    // 5 + 6 + 2 の 3 領域に分けて配置する
    for (let j = 0; j < 5; j++) e.writeUInt16LE(chunk[j]!, 1 + j * 2)
    for (let j = 0; j < 6; j++) e.writeUInt16LE(chunk[5 + j]!, 14 + j * 2)
    for (let j = 0; j < 2; j++) e.writeUInt16LE(chunk[11 + j]!, 28 + j * 2)
    entries.push(e)
  }
  // ディスク上は末尾エントリが先頭に来る
  return entries.reverse()
}

function buildShortEntry(
  shortName11: string,
  attr: number,
  firstCluster: number,
  size: number,
  ts: Date,
): Buffer {
  const e = Buffer.alloc(32)
  e.write(shortName11, 0, 11, 'latin1')
  e[11] = attr
  e[12] = 0
  e[13] = 0
  e.writeUInt16LE(dosTime(ts), 14)
  e.writeUInt16LE(dosDate(ts), 16)
  e.writeUInt16LE(dosDate(ts), 18)
  e.writeUInt16LE((firstCluster >>> 16) & 0xffff, 20)
  e.writeUInt16LE(dosTime(ts), 22)
  e.writeUInt16LE(dosDate(ts), 24)
  e.writeUInt16LE(firstCluster & 0xffff, 26)
  e.writeUInt32LE(size, 28)
  return e
}

// ---------------------------------------------------------------------------
// レイアウト計算
// ---------------------------------------------------------------------------

interface FatGeometry {
  readonly fatType: FatType
  readonly sectorsPerCluster: number
  readonly reservedSectors: number
  readonly numFats: number
  readonly rootEntryCount: number
  readonly fatSizeSectors: number
  readonly rootDirSectors: number
  readonly firstDataSector: number
  readonly clusterCount: number
  readonly totalSectors: number
}

/** クラスタ数から FAT の種類を決める（Microsoft 仕様の 4085 / 65525 が唯一の正しい境界）。 */
function fatTypeFor(clusterCount: number): FatType {
  if (clusterCount < 4085) return 12
  if (clusterCount < 65525) return 16
  return 32
}

/** その FAT 種別で許されるクラスタ数の範囲（上端は含まない）。 */
const CLUSTER_RANGE: Record<FatType, readonly [number, number]> = {
  12: [1, 4085],
  16: [4085, 65525],
  32: [65525, 0x0ffffff5],
}

/** サイズから既定の FAT 種別を選ぶ。2 GiB 超は FAT32 が必須。 */
function defaultFatType(totalSectors: number): FatType {
  const bytes = totalSectors * BYTES_PER_SECTOR
  if (bytes < 16 * 1024 * 1024) return 12
  if (bytes <= 2 * 1024 * 1024 * 1024) return 16
  return 32
}

/**
 * FAT 種別を先に決め、その種別のクラスタ数レンジに収まる最小のクラスタサイズを選ぶ。
 * （クラスタサイズを先に決めると 64 MiB が FAT32 になってしまうので順序が重要。）
 */
function computeGeometry(totalSectors: number, forced: FatType | undefined): FatGeometry {
  const fatType = forced ?? defaultFatType(totalSectors)
  const [minClusters, maxClustersExclusive] = CLUSTER_RANGE[fatType]
  const numFats = 2
  const reservedSectors = fatType === 32 ? 32 : 1
  const rootEntryCount = fatType === 32 ? 0 : 512
  const rootDirSectors = Math.ceil((rootEntryCount * 32) / BYTES_PER_SECTOR)
  const bitsPerEntry = fatType === 12 ? 12 : fatType === 16 ? 16 : 32

  for (const spc of [1, 2, 4, 8, 16, 32, 64, 128]) {
    // FAT のサイズはクラスタ数に依存し、クラスタ数は FAT のサイズに依存するので反復で収束させる
    let fatSizeSectors = 1
    let clusterCount = 0
    for (let iter = 0; iter < 16; iter++) {
      const dataSectors = totalSectors - reservedSectors - numFats * fatSizeSectors - rootDirSectors
      if (dataSectors <= 0) {
        clusterCount = 0
        break
      }
      clusterCount = Math.floor(dataSectors / spc)
      const needed = Math.ceil(
        Math.ceil(((clusterCount + 2) * bitsPerEntry) / 8) / BYTES_PER_SECTOR,
      )
      if (needed === fatSizeSectors) break
      fatSizeSectors = needed
    }
    if (clusterCount < minClusters || clusterCount >= maxClustersExclusive) continue

    return {
      fatType,
      sectorsPerCluster: spc,
      reservedSectors,
      numFats,
      rootEntryCount,
      fatSizeSectors,
      rootDirSectors,
      firstDataSector: reservedSectors + numFats * fatSizeSectors + rootDirSectors,
      clusterCount,
      totalSectors,
    }
  }
  throw new Error(
    `${totalSectors * BYTES_PER_SECTOR} バイトを FAT${fatType} で構成できません（クラスタ数がレンジ ${minClusters}〜${maxClustersExclusive - 1} に収まりません）。イメージサイズを変えてください。`,
  )
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

export function buildFatImage(options: BuildFatOptions): FatImage {
  if (options.sizeBytes % BYTES_PER_SECTOR !== 0) {
    throw new Error('FAT イメージのサイズは 512 の倍数である必要があります。')
  }
  const totalSectors = options.sizeBytes / BYTES_PER_SECTOR
  const geo = computeGeometry(totalSectors, options.forceFatType)
  const bytesPerCluster = geo.sectorsPerCluster * BYTES_PER_SECTOR
  const img = Buffer.alloc(options.sizeBytes)

  // --- ブートセクタ / BPB ---
  img[0] = 0xeb
  img[1] = 0x3c
  img[2] = 0x90
  img.write('MSWIN4.1', 3, 8, 'latin1')
  img.writeUInt16LE(BYTES_PER_SECTOR, 11)
  img[13] = geo.sectorsPerCluster
  img.writeUInt16LE(geo.reservedSectors, 14)
  img[16] = geo.numFats
  img.writeUInt16LE(geo.rootEntryCount, 17)
  img.writeUInt16LE(totalSectors <= 0xffff ? totalSectors : 0, 19)
  img[21] = 0xf8 // 固定ディスク
  img.writeUInt16LE(geo.fatType === 32 ? 0 : geo.fatSizeSectors, 22)
  img.writeUInt16LE(32, 24) // SecPerTrk
  img.writeUInt16LE(64, 26) // NumHeads
  img.writeUInt32LE(options.hiddenSectors, 28)
  img.writeUInt32LE(totalSectors > 0xffff ? totalSectors : 0, 32)

  const label11 = options.label.toUpperCase().slice(0, 11).padEnd(11, ' ')
  if (geo.fatType === 32) {
    img.writeUInt32LE(geo.fatSizeSectors, 36) // BPB_FATSz32
    img.writeUInt16LE(0, 40) // ExtFlags
    img.writeUInt16LE(0, 42) // FSVer
    img.writeUInt32LE(2, 44) // RootClus
    img.writeUInt16LE(1, 48) // FSInfo
    img.writeUInt16LE(6, 50) // BkBootSec
    img[64] = 0x80 // DrvNum
    img[66] = 0x29 // BootSig
    img.writeUInt32LE(options.volumeId >>> 0, 67)
    img.write(label11, 71, 11, 'latin1')
    img.write('FAT32   ', 82, 8, 'latin1')
  } else {
    img[36] = 0x80 // DrvNum
    img[37] = 0
    img[38] = 0x29 // BootSig
    img.writeUInt32LE(options.volumeId >>> 0, 39)
    img.write(label11, 43, 11, 'latin1')
    img.write(geo.fatType === 12 ? 'FAT12   ' : 'FAT16   ', 54, 8, 'latin1')
  }
  img.writeUInt16LE(0xaa55, 510)

  if (geo.fatType === 32) {
    // FSInfo セクタ
    const fs = geo.reservedSectors > 1 ? 1 : 0
    if (fs) {
      const o = 1 * BYTES_PER_SECTOR
      img.write('RRaA', o, 4, 'latin1')
      img.write('rrAa', o + 484, 4, 'latin1')
      img.writeUInt32LE(0xffffffff, o + 488)
      img.writeUInt32LE(0xffffffff, o + 492)
      img.writeUInt16LE(0xaa55, o + 510)
    }
    // バックアップブートセクタ
    img.copy(img, 6 * BYTES_PER_SECTOR, 0, BYTES_PER_SECTOR)
  }

  // --- FAT テーブル ---
  const fatEntries = new Uint32Array(geo.clusterCount + 2)
  fatEntries[0] = geo.fatType === 12 ? 0xff8 : geo.fatType === 16 ? 0xfff8 : 0x0ffffff8
  fatEntries[1] = geo.fatType === 12 ? 0xfff : geo.fatType === 16 ? 0xffff : 0x0fffffff
  const EOC = geo.fatType === 12 ? 0xfff : geo.fatType === 16 ? 0xffff : 0x0fffffff

  // --- ファイル配置 ---
  const rootEntries: Buffer[] = []
  // ボリュームラベルのディレクトリエントリ（属性 0x08）。BPB のラベルとは別に必要。
  rootEntries.push(buildShortEntry(label11, 0x08, 0, 0, options.timestamp))

  // FAT32 のルートディレクトリはデータ領域のクラスタ鎖なので、
  // 必要クラスタ数を先に求めて予約してからファイルを配置する（名前だけで決まるので事前計算できる）。
  const rootSlotCount =
    1 +
    options.files.reduce(
          // LFN は 1 エントリ 13 **UTF-16 コードユニット**。コードポイントで数えると、
    // 非 BMP 文字（サロゲートペア）を含む名前で予約が足りなくなる。
    (n, f) => n + 1 + (needsLongName(f.name) ? Math.ceil((f.name.length + 1) / 13) : 0),
      0,
    )
  const rootClusters =
    geo.fatType === 32 ? Math.max(1, Math.ceil((rootSlotCount * 32) / bytesPerCluster)) : 0
  let nextCluster = geo.fatType === 32 ? 2 + rootClusters : 2
  const takenShortNames = new Set<string>([label11])
  let usedClusters = 0

  for (const file of options.files) {
    const clustersNeeded = Math.max(1, Math.ceil(file.content.length / bytesPerCluster))
    if (nextCluster + clustersNeeded > geo.clusterCount + 2) {
      throw new Error(
        `FAT イメージの空き容量が足りません（${file.name} に ${clustersNeeded} クラスタ必要）。`,
      )
    }
    const firstCluster = file.content.length === 0 ? 0 : nextCluster
    if (file.content.length > 0) {
      for (let i = 0; i < clustersNeeded; i++) {
        const c = nextCluster + i
        fatEntries[c] = i === clustersNeeded - 1 ? EOC : c + 1
        const src = i * bytesPerCluster
        const len = Math.min(bytesPerCluster, file.content.length - src)
        const dst = (geo.firstDataSector + (c - 2) * geo.sectorsPerCluster) * BYTES_PER_SECTOR
        file.content.copy(img, dst, src, src + len)
      }
      nextCluster += clustersNeeded
      usedClusters += clustersNeeded
    }
    const short = makeShortName(file.name, takenShortNames)
    takenShortNames.add(short)
    if (needsLongName(file.name)) {
      rootEntries.push(...buildLfnEntries(file.name, shortNameChecksum(short)))
    }
    rootEntries.push(
      buildShortEntry(short, 0x20 /* ARCHIVE */, firstCluster, file.content.length, options.timestamp),
    )
  }

  // --- FAT テーブルの書き出し ---
  const fatBytes = Buffer.alloc(geo.fatSizeSectors * BYTES_PER_SECTOR)
  if (geo.fatType === 12) {
    for (let i = 0; i < fatEntries.length; i++) {
      const v = fatEntries[i]! & 0xfff
      const o = Math.floor((i * 3) / 2)
      if (i % 2 === 0) {
        fatBytes[o] = v & 0xff
        fatBytes[o + 1] = (fatBytes[o + 1]! & 0xf0) | ((v >> 8) & 0x0f)
      } else {
        fatBytes[o] = (fatBytes[o]! & 0x0f) | ((v << 4) & 0xf0)
        fatBytes[o + 1] = (v >> 4) & 0xff
      }
    }
  } else if (geo.fatType === 16) {
    for (let i = 0; i < fatEntries.length; i++) fatBytes.writeUInt16LE(fatEntries[i]! & 0xffff, i * 2)
  } else {
    for (let i = 0; i < fatEntries.length; i++) {
      fatBytes.writeUInt32LE(fatEntries[i]! & 0x0fffffff, i * 4)
    }
  }
  for (let f = 0; f < geo.numFats; f++) {
    fatBytes.copy(img, (geo.reservedSectors + f * geo.fatSizeSectors) * BYTES_PER_SECTOR)
  }

  // --- ルートディレクトリの書き出し ---
  const rootDirBuf = Buffer.concat(rootEntries)
  if (geo.fatType === 32) {
    const capacity = rootClusters * bytesPerCluster
    if (rootDirBuf.length > capacity) {
      // 事前計算とずれた場合の保険。ここに来たら rootSlotCount の計算式に穴がある。
      throw new Error('ルートディレクトリのエントリが予約したクラスタに収まりません。')
    }
    // ルート用に予約したクラスタを鎖として繋ぐ
    for (let i = 0; i < rootClusters; i++) {
      const c = 2 + i
      fatEntries[c] = i === rootClusters - 1 ? EOC : c + 1
    }
    rootDirBuf.copy(img, geo.firstDataSector * BYTES_PER_SECTOR)
    // FAT を書き直す（ルートクラスタの予約を反映）
    for (let i = 0; i < fatEntries.length; i++) {
      fatBytes.writeUInt32LE(fatEntries[i]! & 0x0fffffff, i * 4)
    }
    for (let f = 0; f < geo.numFats; f++) {
      fatBytes.copy(img, (geo.reservedSectors + f * geo.fatSizeSectors) * BYTES_PER_SECTOR)
    }
  } else {
    const capacity = geo.rootEntryCount * 32
    if (rootDirBuf.length > capacity) {
      throw new Error(
        `ルートディレクトリのエントリ数が上限 (${geo.rootEntryCount}) を超えました。ファイル名を短くするか数を減らしてください。`,
      )
    }
    const rootStart = (geo.reservedSectors + geo.numFats * geo.fatSizeSectors) * BYTES_PER_SECTOR
    rootDirBuf.copy(img, rootStart)
  }

  return {
    data: img,
    fatType: geo.fatType,
    sectorsPerCluster: geo.sectorsPerCluster,
    clusterCount: geo.clusterCount,
    usedClusters,
  }
}
