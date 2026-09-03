import { BYTES_PER_SECTOR, type FatType } from './build.js'

// 最小限の FAT リーダ。生成したイメージが本当に読めるかを検証するためにある
// （書いたコードで読み返すだけでは循環論法になるので、独立した経路として素直に実装する）。
// USB に書き込んだ後のベリファイにも使う。

export interface FatDirEntry {
  readonly name: string
  /** 11 文字の 8.3 名（パディング込み） */
  readonly shortName: string
  readonly attr: number
  readonly firstCluster: number
  readonly size: number
  readonly content: Buffer
}

export interface FatFilesystem {
  readonly fatType: FatType
  readonly label: string
  readonly volumeLabelEntry: string | null
  readonly bytesPerCluster: number
  readonly clusterCount: number
  readonly files: readonly FatDirEntry[]
}

export function readFatImage(img: Buffer): FatFilesystem {
  const bytesPerSec = img.readUInt16LE(11)
  const secPerClus = img[13]!
  const rsvd = img.readUInt16LE(14)
  const numFats = img[16]!
  const rootEntCnt = img.readUInt16LE(17)
  const totSec = img.readUInt16LE(19) || img.readUInt32LE(32)
  const fatSz = img.readUInt16LE(22) || img.readUInt32LE(36)
  const rootDirSectors = Math.ceil((rootEntCnt * 32) / bytesPerSec)
  const firstDataSec = rsvd + numFats * fatSz + rootDirSectors
  const clusterCount = Math.floor((totSec - firstDataSec) / secPerClus)
  const fatType: FatType = clusterCount < 4085 ? 12 : clusterCount < 65525 ? 16 : 32
  const bytesPerCluster = secPerClus * bytesPerSec

  const fat = img.subarray(rsvd * bytesPerSec, (rsvd + fatSz) * bytesPerSec)
  const readFatEntry = (n: number): number => {
    if (fatType === 12) {
      const o = Math.floor((n * 3) / 2)
      const v = fat.readUInt16LE(o)
      return n % 2 === 0 ? v & 0xfff : v >> 4
    }
    if (fatType === 16) return fat.readUInt16LE(n * 2)
    return fat.readUInt32LE(n * 4) & 0x0fffffff
  }
  const eoc = fatType === 12 ? 0xff8 : fatType === 16 ? 0xfff8 : 0x0ffffff8

  const clusterBytes = (n: number): Buffer => {
    const s = firstDataSec + (n - 2) * secPerClus
    return img.subarray(s * bytesPerSec, (s + secPerClus) * bytesPerSec)
  }
  const readChain = (start: number, size: number): Buffer => {
    if (start === 0) return Buffer.alloc(0)
    const parts: Buffer[] = []
    let c = start
    let guard = 0
    while (c >= 2 && c < eoc && guard++ < 1_000_000) {
      parts.push(clusterBytes(c))
      c = readFatEntry(c)
    }
    return Buffer.concat(parts).subarray(0, size)
  }

  const rootDirBuf =
    fatType === 32
      ? readChain(img.readUInt32LE(44), bytesPerCluster)
      : img.subarray(
          (rsvd + numFats * fatSz) * bytesPerSec,
          (rsvd + numFats * fatSz + rootDirSectors) * bytesPerSec,
        )

  const files: FatDirEntry[] = []
  let volumeLabelEntry: string | null = null
  let lfnParts: string[] = []
  for (let o = 0; o + 32 <= rootDirBuf.length; o += 32) {
    const e = rootDirBuf.subarray(o, o + 32)
    if (e[0] === 0x00) break // これ以降にエントリは無い
    if (e[0] === 0xe5) {
      lfnParts = []
      continue
    }
    const attr = e[11]!
    if (attr === 0x0f) {
      // LFN エントリ。シーケンス番号は 1 始まり。
      const seq = (e[0]! & 0x1f) - 1
      const units: number[] = []
      for (let j = 0; j < 5; j++) units.push(e.readUInt16LE(1 + j * 2))
      for (let j = 0; j < 6; j++) units.push(e.readUInt16LE(14 + j * 2))
      for (let j = 0; j < 2; j++) units.push(e.readUInt16LE(28 + j * 2))
      const chars = units.filter((u) => u !== 0x0000 && u !== 0xffff)
      lfnParts[seq] = String.fromCharCode(...chars)
      continue
    }
    const shortName = e.subarray(0, 11).toString('latin1')
    if ((attr & 0x08) !== 0) {
      volumeLabelEntry = shortName
      lfnParts = []
      continue
    }
    const firstCluster = e.readUInt16LE(26) | (fatType === 32 ? e.readUInt16LE(20) << 16 : 0)
    const size = e.readUInt32LE(28)
    const longName = lfnParts.length > 0 ? lfnParts.join('') : null
    lfnParts = []
    const base = shortName.slice(0, 8).trimEnd()
    const ext = shortName.slice(8, 11).trimEnd()
    files.push({
      name: longName ?? (ext ? `${base}.${ext}` : base),
      shortName,
      attr,
      firstCluster,
      size,
      content: readChain(firstCluster, size),
    })
  }

  return {
    fatType,
    label: (volumeLabelEntry ?? img.subarray(fatType === 32 ? 71 : 43, fatType === 32 ? 82 : 54).toString('latin1')).trimEnd(),
    volumeLabelEntry,
    bytesPerCluster,
    clusterCount,
    files,
  }
}

export { BYTES_PER_SECTOR }
