// 最小 FAT12/16 リーダ: efi.img から /EFI/boot/grub.cfg 等を取り出す
import fs from 'node:fs'
const img = fs.readFileSync(process.argv[2])
const bps = img.readUInt16LE(11), spc = img[13], rsvd = img.readUInt16LE(14), nfats = img[16], rootEnt = img.readUInt16LE(17)
const totSec = img.readUInt16LE(19) || img.readUInt32LE(32), fatSz = img.readUInt16LE(22)
const rootDirSectors = Math.ceil((rootEnt * 32) / bps)
const firstDataSec = rsvd + nfats * fatSz + rootDirSectors
const dataSec = totSec - firstDataSec
const clusters = Math.floor(dataSec / spc)
const fatType = clusters < 4085 ? 12 : clusters < 65525 ? 16 : 32
console.log({ bps, spc, rsvd, nfats, rootEnt, totSec, fatSz, rootDirSectors, firstDataSec, clusters, fatType, label: img.subarray(43, 54).toString('latin1') })
const fat = img.subarray(rsvd * bps, (rsvd + fatSz) * bps)
function fatEntry(n) {
  if (fatType === 12) { const o = Math.floor(n * 3 / 2); const v = fat.readUInt16LE(o); return n & 1 ? v >> 4 : v & 0xfff }
  if (fatType === 16) return fat.readUInt16LE(n * 2)
  return fat.readUInt32LE(n * 4) & 0x0fffffff
}
const eoc = fatType === 12 ? 0xff8 : fatType === 16 ? 0xfff8 : 0x0ffffff8
function clusterBytes(n) { const s = firstDataSec + (n - 2) * spc; return img.subarray(s * bps, (s + spc) * bps) }
function readChain(n, size) {
  const parts = []
  let c = n, guard = 0
  while (c >= 2 && c < eoc && guard++ < 1e6) { parts.push(clusterBytes(c)); c = fatEntry(c) }
  const b = Buffer.concat(parts)
  return size != null ? b.subarray(0, size) : b
}
function parseDir(b) {
  const out = []; let lfn = []
  for (let o = 0; o < b.length; o += 32) {
    const e = b.subarray(o, o + 32)
    if (e[0] === 0) break
    if (e[0] === 0xe5) { lfn = []; continue }
    const attr = e[11]
    if (attr === 0x0f) { // LFN
      const seq = e[0] & 0x1f
      const chars = Buffer.concat([e.subarray(1, 11), e.subarray(14, 26), e.subarray(28, 32)]).toString('utf16le').replace(/￿|\0/g, '')
      lfn[seq - 1] = chars; continue
    }
    const short = (e.subarray(0, 8).toString('latin1').trimEnd() + (e.subarray(8, 11).toString('latin1').trimEnd() ? '.' + e.subarray(8, 11).toString('latin1').trimEnd() : ''))
    const name = lfn.length ? lfn.join('') : short
    lfn = []
    if (attr & 0x08) { out.push({ volumeLabel: e.subarray(0, 11).toString('latin1') }); continue }
    out.push({ name, short, attr, cluster: e.readUInt16LE(26) | (fatType === 32 ? e.readUInt16LE(20) << 16 : 0), size: e.readUInt32LE(28), dir: !!(attr & 0x10) })
  }
  return out
}
const rootDir = parseDir(img.subarray((rsvd + nfats * fatSz) * bps, firstDataSec * bps))
console.log('ROOT:', rootDir)
function walk(dirEntries, parts, depth = 0) {
  const e = dirEntries.find((x) => x.name && x.name.toLowerCase() === parts[0].toLowerCase())
  if (!e) return null
  if (parts.length === 1) return e
  return walk(parseDir(readChain(e.cluster)), parts.slice(1), depth + 1)
}
for (const p of [['EFI', 'boot', 'grub.cfg'], ['EFI', 'ubuntu', 'grub.cfg'], ['boot', 'grub', 'grub.cfg']]) {
  const e = walk(rootDir, p)
  if (e) { console.log('==== /' + p.join('/'), e); console.log(readChain(e.cluster, e.size).toString('utf8')) }
}
const efi = walk(rootDir, ['EFI'])
if (efi) { const l = parseDir(readChain(efi.cluster)); console.log('EFI/:', l); for (const d of l.filter((x) => x.dir && x.name !== '.' && x.name !== '..')) console.log('EFI/' + d.name + ':', parseDir(readChain(d.cluster))) }
