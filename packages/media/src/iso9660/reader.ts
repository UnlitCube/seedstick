import { ISO_SECTOR_SIZE, type BlockDevice } from '../blockdev/index.js'

// ISO9660 (+ Joliet, Rock Ridge) の読み取り。
// 目的は「grub.cfg / md5sum.txt / .disk/info の位置とサイズを正確に知り、
// そのディレクトリレコードのバイト位置も知る」こと。完全な ISO 実装は不要。

export interface DirectoryRecord {
  /** レコード自体の長さ */
  readonly length: number
  /** データの開始 LBA（2048B 単位） */
  readonly extent: number
  /** データのバイト数 */
  readonly size: number
  readonly flags: number
  readonly isDirectory: boolean
  /** ISO9660 の名前（`GRUB.CFG;1` など。Joliet ツリーでは UTF-16BE を復号した名前） */
  readonly name: string
  /** Rock Ridge の NM エントリで得られる本来の名前 */
  readonly rockRidgeName: string | null
  /** このレコードが置かれているディスク上の絶対バイト位置（インプレース改変で使う） */
  readonly recordOffset: number
  /** System Use 領域に現れたエントリ署名（PX, TF, NM …） */
  readonly systemUse: readonly string[]
}

export interface VolumeDescriptorInfo {
  readonly sector: number
  readonly type: number
}

export interface PrimaryVolumeDescriptor {
  readonly sector: number
  readonly volumeId: string
  /** 論理ブロック数（2048B 単位） */
  readonly volumeSpaceSize: number
  readonly logicalBlockSize: number
  readonly rootRecord: DirectoryRecord
}

export interface JolietVolumeDescriptor {
  readonly sector: number
  readonly escapeSequence: string
  readonly rootRecord: DirectoryRecord
}

export interface ElToritoEntry {
  readonly kind: 'validation' | 'boot' | 'section-header' | 'other'
  readonly platform?: number
  readonly bootable?: boolean
  readonly mediaType?: number
  readonly sectorCount?: number
  readonly loadRba?: number
}

export interface ElToritoInfo {
  readonly catalogLba: number
  readonly entries: readonly ElToritoEntry[]
}

export interface IsoStructure {
  readonly pvd: PrimaryVolumeDescriptor
  readonly joliet: JolietVolumeDescriptor | null
  readonly elTorito: ElToritoInfo | null
  readonly descriptors: readonly VolumeDescriptorInfo[]
}

const ISO_MAGIC = 'CD001'
const FIRST_VD_SECTOR = 16
const MAX_VD_SECTORS = 32

function parseDirectoryRecord(
  buf: Buffer,
  offsetInBuf: number,
  absoluteBase: number,
  joliet: boolean,
): DirectoryRecord | null {
  const length = buf[offsetInBuf]
  if (length === undefined || length === 0) return null
  if (offsetInBuf + length > buf.length) return null
  const nameLength = buf[offsetInBuf + 32]!
  const nameStart = offsetInBuf + 33
  const rawName = buf.subarray(nameStart, nameStart + nameLength)
  // Joliet の名前は UCS-2 ビッグエンディアン。swap16 は破壊的なので必ずコピーしてから使う
  // （subarray は元バッファを共有しており、直接呼ぶと ISO のデータが壊れる）。
  // "." / ".." は 1 バイト (0x00 / 0x01) で、UCS-2 ではないため個別に扱う。
  const name = joliet
    ? nameLength >= 2
      ? Buffer.from(rawName).swap16().toString('utf16le')
      : nameLength === 1
        ? rawName[0] === 0
          ? '.'
          : '..'
        : ''
    : rawName.toString('latin1')
  // 名前が偶数長なら 1 バイトのパディングが入る
  const sysUseStart = nameStart + nameLength + (nameLength % 2 === 0 ? 1 : 0)
  const systemUse: string[] = []
  let rockRidgeName: string | null = null
  for (let p = sysUseStart; p + 4 <= offsetInBuf + length; ) {
    const sig = buf.subarray(p, p + 2).toString('latin1')
    const len = buf[p + 2]!
    if (len < 4) break
    systemUse.push(sig)
    if (sig === 'NM') {
      // NM: signature(2) len(1) version(1) flags(1) name...
      rockRidgeName = (rockRidgeName ?? '') + buf.subarray(p + 5, p + len).toString('utf8')
    }
    p += len
  }
  const flags = buf[offsetInBuf + 25]!
  return {
    length,
    extent: buf.readUInt32LE(offsetInBuf + 2),
    size: buf.readUInt32LE(offsetInBuf + 10),
    flags,
    isDirectory: (flags & 0x02) !== 0,
    name,
    rockRidgeName,
    recordOffset: absoluteBase + offsetInBuf,
    systemUse,
  }
}

/** ボリューム記述子群を読み、PVD / Joliet / El Torito を特定する。 */
export async function readIsoStructure(dev: BlockDevice): Promise<IsoStructure> {
  const descriptors: VolumeDescriptorInfo[] = []
  let pvd: PrimaryVolumeDescriptor | null = null
  let joliet: JolietVolumeDescriptor | null = null
  let bootCatalogLba: number | null = null

  for (let i = 0; i < MAX_VD_SECTORS; i++) {
    const sector = FIRST_VD_SECTOR + i
    const buf = await dev.read(sector * ISO_SECTOR_SIZE, ISO_SECTOR_SIZE)
    if (buf.subarray(1, 6).toString('latin1') !== ISO_MAGIC) {
      if (i === 0) throw new Error('ISO9660 の署名 (CD001) が見つかりません。Ubuntu の ISO ファイルではない可能性があります。')
      break
    }
    const type = buf[0]!
    descriptors.push({ sector, type })
    if (type === 1 && !pvd) {
      const root = parseDirectoryRecord(buf, 156, sector * ISO_SECTOR_SIZE, false)
      if (!root) throw new Error('ISO9660 のルートディレクトリレコードを読めません。')
      pvd = {
        sector,
        volumeId: buf.subarray(40, 72).toString('latin1').trimEnd(),
        volumeSpaceSize: buf.readUInt32LE(80),
        logicalBlockSize: buf.readUInt16LE(128),
        rootRecord: root,
      }
    } else if (type === 2 && !joliet) {
      const escape = buf.subarray(88, 91).toString('latin1')
      // %/@ %/C %/E のいずれかが Joliet の UCS-2 エスケープ
      if (escape.startsWith('%/')) {
        const root = parseDirectoryRecord(buf, 156, sector * ISO_SECTOR_SIZE, true)
        if (root) joliet = { sector, escapeSequence: escape, rootRecord: root }
      }
    } else if (type === 0 && bootCatalogLba === null) {
      const bootSystemId = buf.subarray(7, 39).toString('latin1').replace(/\0/g, '')
      if (bootSystemId.startsWith('EL TORITO')) bootCatalogLba = buf.readUInt32LE(71)
    } else if (type === 255) {
      break
    }
  }
  if (!pvd) throw new Error('ISO9660 の Primary Volume Descriptor が見つかりません。')

  let elTorito: ElToritoInfo | null = null
  if (bootCatalogLba !== null) {
    const cat = await dev.read(bootCatalogLba * ISO_SECTOR_SIZE, ISO_SECTOR_SIZE)
    const entries: ElToritoEntry[] = []
    for (let off = 0; off + 32 <= cat.length; off += 32) {
      const e = cat.subarray(off, off + 32)
      if (e.every((x) => x === 0)) break
      const id = e[0]!
      if (id === 0x01) entries.push({ kind: 'validation', platform: e[1]! })
      else if (id === 0x90 || id === 0x91)
        entries.push({ kind: 'section-header', platform: e[1]! })
      else if (id === 0x88 || id === 0x00)
        entries.push({
          kind: 'boot',
          bootable: id === 0x88,
          mediaType: e[1]!,
          sectorCount: e.readUInt16LE(6),
          loadRba: e.readUInt32LE(8),
        })
      else entries.push({ kind: 'other' })
    }
    elTorito = { catalogLba: bootCatalogLba, entries }
  }

  return { pvd, joliet, elTorito, descriptors }
}

/** ディレクトリの内容を読み、レコード一覧を返す。 */
export async function readDirectory(
  dev: BlockDevice,
  dir: DirectoryRecord,
  joliet = false,
): Promise<DirectoryRecord[]> {
  if (!dir.isDirectory) throw new Error(`ディレクトリではありません: ${dir.name}`)
  const buf = await dev.read(dir.extent * ISO_SECTOR_SIZE, dir.size)
  const out: DirectoryRecord[] = []
  let off = 0
  while (off < buf.length) {
    if (buf[off] === 0) {
      // レコードはセクタ境界をまたがない。ゼロは次セクタへのパディング。
      const next = (Math.floor(off / ISO_SECTOR_SIZE) + 1) * ISO_SECTOR_SIZE
      if (next >= buf.length) break
      off = next
      continue
    }
    const rec = parseDirectoryRecord(buf, off, dir.extent * ISO_SECTOR_SIZE, joliet)
    if (!rec) break
    out.push(rec)
    off += rec.length
  }
  return out
}

function nameMatches(rec: DirectoryRecord, want: string): boolean {
  const w = want.toLowerCase()
  if (rec.rockRidgeName && rec.rockRidgeName.toLowerCase() === w) return true
  const n = rec.name.toLowerCase()
  // ISO9660 レベル1 の名前はバージョン接尾辞 `;1` を持ち、拡張子なしには `.` が付く
  return n === w || n === `${w};1` || n === `${w}.;1` || n === `${w}.`
}

export interface ResolvedPath {
  readonly record: DirectoryRecord
  /** 親ディレクトリのレコード（Data Length を書き換える対象を特定するのに使う） */
  readonly parent: DirectoryRecord
  readonly trail: readonly DirectoryRecord[]
}

/** `/boot/grub/grub.cfg` のようなパスを解決する。見つからなければ null。 */
export async function resolvePath(
  dev: BlockDevice,
  root: DirectoryRecord,
  path: string,
  joliet = false,
): Promise<ResolvedPath | null> {
  const parts = path.split('/').filter(Boolean)
  let current = root
  const trail: DirectoryRecord[] = []
  for (const [i, part] of parts.entries()) {
    if (!current.isDirectory) return null
    const list = await readDirectory(dev, current, joliet)
    const found = list.find((r) => nameMatches(r, part))
    if (!found) return null
    if (i === parts.length - 1) return { record: found, parent: current, trail: [...trail, found] }
    trail.push(found)
    current = found
  }
  return null
}

/** ファイルの内容を読む。 */
export async function readFile(dev: BlockDevice, rec: DirectoryRecord): Promise<Buffer> {
  if (rec.isDirectory) throw new Error(`ファイルではありません: ${rec.name}`)
  return dev.read(rec.extent * ISO_SECTOR_SIZE, rec.size)
}
