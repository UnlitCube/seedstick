// Ubuntu live-server ISO を HTTP Range で部分取得して物理構造を実測するプローブ
// usage: node iso-probe.mjs <iso-url> [out-dir]
import fs from 'node:fs'
import path from 'node:path'

const url = process.argv[2]
const outDir = process.argv[3] || '.'
if (!url) { console.error('usage: node iso-probe.mjs <iso-url> [out-dir]'); process.exit(1) }
fs.mkdirSync(outDir, { recursive: true })

const SECTOR = 2048
let totalSize = 0
async function head() {
  const r = await fetch(url, { method: 'HEAD' })
  if (!r.ok) throw new Error('HEAD ' + r.status)
  totalSize = Number(r.headers.get('content-length'))
  return { size: totalSize, acceptRanges: r.headers.get('accept-ranges') }
}
async function range(start, len) {
  const end = start + len - 1
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
  if (r.status !== 206) throw new Error(`Range ${start}-${end}: HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}
const sectors = (lba, n) => range(lba * SECTOR, n * SECTOR)
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')
const guid = (b) => {
  const p = (s, e) => Buffer.from(b.subarray(s, e)).reverse().toString('hex')
  return `${p(0, 4)}-${p(4, 6)}-${p(6, 8)}-${b.subarray(8, 10).toString('hex')}-${b.subarray(10, 16).toString('hex')}`.toUpperCase()
}
const report = { url }

// ---- MBR / GPT ----
{
  const lba0_1 = await range(0, 512 * 34)
  const mbr = lba0_1.subarray(0, 512)
  report.mbr = {
    signature: mbr.readUInt16LE(510).toString(16),
    bootCodeNonZero: mbr.subarray(0, 440).some((x) => x !== 0),
    diskSig: mbr.readUInt32LE(440).toString(16),
    entries: [0, 1, 2, 3].map((i) => {
      const e = mbr.subarray(446 + i * 16, 446 + i * 16 + 16)
      return { status: e[0].toString(16), chsStart: hex(e.subarray(1, 4)), type: '0x' + e[4].toString(16).padStart(2, '0'), chsEnd: hex(e.subarray(5, 8)), lbaStart: e.readUInt32LE(8), sectors: e.readUInt32LE(12) }
    }),
  }
  const g = lba0_1.subarray(512, 1024)
  if (g.subarray(0, 8).toString('latin1') === 'EFI PART') {
    const entLba = Number(g.readBigUInt64LE(72))
    const nEnt = g.readUInt32LE(80), szEnt = g.readUInt32LE(84)
    report.gpt = {
      revision: g.readUInt32LE(8).toString(16), headerSize: g.readUInt32LE(12), headerCrc: g.readUInt32LE(16).toString(16),
      myLba: Number(g.readBigUInt64LE(24)), alternateLba: Number(g.readBigUInt64LE(32)),
      firstUsable: Number(g.readBigUInt64LE(40)), lastUsable: Number(g.readBigUInt64LE(48)),
      diskGuid: guid(g.subarray(56, 72)), entriesLba: entLba, numEntries: nEnt, entrySize: szEnt, entriesCrc: g.readUInt32LE(88).toString(16),
      entries: [],
    }
    const ents = lba0_1.subarray(entLba * 512, entLba * 512 + nEnt * szEnt)
    for (let i = 0; i < nEnt; i++) {
      const e = ents.subarray(i * szEnt, (i + 1) * szEnt)
      if (e.subarray(0, 16).every((x) => x === 0)) continue
      report.gpt.entries.push({ index: i, type: guid(e.subarray(0, 16)), unique: guid(e.subarray(16, 32)), start: Number(e.readBigUInt64LE(32)), end: Number(e.readBigUInt64LE(40)), attrs: e.readBigUInt64LE(48).toString(16), name: e.subarray(56, 128).toString('utf16le').replace(/\0+$/, '') })
    }
  }
}
const h = await head()
report.size = h
{
  // backup GPT header at last 512-sector of image
  const lastLba = Math.floor(totalSize / 512) - 1
  const tail = await range(lastLba * 512, 512)
  report.backupGpt = { lastLba, hasSignature: tail.subarray(0, 8).toString('latin1') === 'EFI PART', myLba: tail.subarray(0, 8).toString('latin1') === 'EFI PART' ? Number(tail.readBigUInt64LE(24)) : null, alternateLba: tail.subarray(0, 8).toString('latin1') === 'EFI PART' ? Number(tail.readBigUInt64LE(32)) : null }
}

// ---- Volume descriptors ----
const vds = await sectors(16, 8)
report.volumeDescriptors = []
let pvd = null, joliet = null, bootRecord = null
for (let i = 0; i < 8; i++) {
  const d = vds.subarray(i * SECTOR, (i + 1) * SECTOR)
  const type = d[0]
  const id = d.subarray(1, 6).toString('latin1')
  if (id !== 'CD001') break
  const entry = { index: 16 + i, type }
  if (type === 1) { pvd = d; entry.volumeId = d.subarray(40, 72).toString('latin1').trim(); entry.volumeSpaceSize = d.readUInt32LE(80); entry.logicalBlockSize = d.readUInt16LE(128); entry.systemId = d.subarray(8, 40).toString('latin1').trim(); entry.publisher = d.subarray(318, 446).toString('latin1').trim(); entry.application = d.subarray(574, 702).toString('latin1').trim(); entry.creationDate = d.subarray(813, 830).toString('latin1') }
  if (type === 2) { joliet = d; entry.escape = hex(d.subarray(88, 91)); entry.volumeId = d.subarray(40, 72).toString('utf16le').replace(/\0/g, '').trim() }
  if (type === 0) { bootRecord = d; entry.bootSystemId = d.subarray(7, 39).toString('latin1').replace(/\0/g, ''); entry.bootCatalogLba = d.readUInt32LE(71) }
  if (type === 255) entry.terminator = true
  report.volumeDescriptors.push(entry)
  if (type === 255) break
}

// ---- directory parsing ----
function parseDirRecord(b, off) {
  const len = b[off]
  if (!len) return null
  const nameLen = b[off + 32]
  const name = b.subarray(off + 33, off + 33 + nameLen)
  const sysUseStart = off + 33 + nameLen + (nameLen % 2 === 0 ? 1 : 0)
  const su = b.subarray(sysUseStart, off + len)
  let rrName = null
  const suEntries = []
  for (let p = 0; p + 4 <= su.length;) {
    const sig = su.subarray(p, p + 2).toString('latin1'); const l = su[p + 2]
    if (l < 4) break
    suEntries.push(sig)
    if (sig === 'NM') rrName = (rrName || '') + su.subarray(p + 5, p + l).toString('latin1')
    p += l
  }
  return { len, extent: b.readUInt32LE(off + 2), extentBE: b.readUInt32BE(off + 6), size: b.readUInt32LE(off + 10), sizeBE: b.readUInt32BE(off + 14), flags: b[off + 25], nameLen, name: name.toString('latin1'), rrName, suEntries, recordOffset: off }
}
async function readDir(extent, size, jol = false) {
  const b = await range(extent * SECTOR, size)
  const out = []
  for (let off = 0; off < b.length;) {
    if (b[off] === 0) { off = (Math.floor(off / SECTOR) + 1) * SECTOR; continue }
    const r = parseDirRecord(b, off)
    if (!r) break
    if (jol) r.name = b.subarray(off + 33, off + 33 + r.nameLen).toString('utf16le')
    out.push(r); off += r.len
  }
  return out
}
function findEntry(list, want) {
  const w = want.toLowerCase()
  return list.find((e) => (e.rrName && e.rrName.toLowerCase() === w) || e.name.toLowerCase() === w || e.name.toLowerCase() === w + ';1' || e.name.toLowerCase() === w + '.;1')
}
async function walk(rootRec, pathParts, jol = false) {
  let dir = rootRec; const trail = []
  for (const part of pathParts) {
    const list = await readDir(dir.extent, dir.size, jol)
    const e = findEntry(list, part)
    if (!e) return { found: false, at: part, listing: list.map((x) => ({ name: x.name, rr: x.rrName, extent: x.extent, size: x.size, flags: x.flags })) }
    trail.push({ part, extent: e.extent, size: e.size, sizeBE: e.sizeBE, flags: e.flags, name: e.name, rrName: e.rrName, recordOffsetInDir: e.recordOffset, dirExtent: dir.extent, dirSize: dir.size, su: e.suEntries })
    dir = e
  }
  return { found: true, trail, extent: dir.extent, size: dir.size }
}
const rootRec = parseDirRecord(pvd, 156)
report.rootDir = { extent: rootRec.extent, size: rootRec.size }
const rootList = await readDir(rootRec.extent, rootRec.size)
report.rootListing = rootList.map((x) => ({ name: x.name, rr: x.rrName, extent: x.extent, size: x.size, flags: x.flags, su: x.suEntries.join(',') }))
const grubCfg = await walk(rootRec, ['boot', 'grub', 'grub.cfg'])
report.grubCfg = grubCfg
if (grubCfg.found) {
  const data = await range(grubCfg.extent * SECTOR, Math.ceil(grubCfg.size / SECTOR) * SECTOR)
  report.grubCfgText = data.subarray(0, grubCfg.size).toString('utf8')
  report.grubCfgSlackAfterFile = hex(data.subarray(grubCfg.size, Math.min(grubCfg.size + 16, data.length)))
  fs.writeFileSync(path.join(outDir, 'grub.cfg'), data.subarray(0, grubCfg.size))
}
if (joliet) {
  const jroot = parseDirRecord(joliet, 156)
  const jw = await walk(jroot, ['boot', 'grub', 'grub.cfg'], true)
  report.grubCfgJoliet = jw
}
// loopback.cfg
report.loopbackCfg = await walk(rootRec, ['boot', 'grub', 'loopback.cfg'])
if (report.loopbackCfg.found) report.loopbackCfgText = (await range(report.loopbackCfg.extent * SECTOR, Math.ceil(report.loopbackCfg.size / SECTOR) * SECTOR)).subarray(0, report.loopbackCfg.size).toString('utf8')
// .disk/info
const diskInfo = await walk(rootRec, ['.disk', 'info'])
report.diskInfo = diskInfo
if (diskInfo.found) report.diskInfoText = (await range(diskInfo.extent * SECTOR, SECTOR)).subarray(0, diskInfo.size).toString('utf8')
// md5sum.txt
const md5 = await walk(rootRec, ['md5sum.txt'])
if (md5.found) {
  const t = (await range(md5.extent * SECTOR, Math.ceil(md5.size / SECTOR) * SECTOR)).subarray(0, md5.size).toString('utf8')
  report.md5sum = { size: md5.size, lines: t.split('\n').length, grubLines: t.split('\n').filter((l) => /grub/.test(l)), casperLines: t.split('\n').filter((l) => /casper/.test(l)).slice(0, 10) }
}
// casper listing
const casper = await walk(rootRec, ['casper'])
if (casper.found) report.casper = (await readDir(casper.extent, casper.size)).map((x) => ({ name: x.name, rr: x.rrName, size: x.size })).filter((x) => x.name !== '\0' && x.name !== '\x01')
// boot/grub listing
const bg = await walk(rootRec, ['boot', 'grub'])
if (bg.found) report.bootGrub = (await readDir(bg.extent, bg.size)).map((x) => ({ name: x.name, rr: x.rrName, size: x.size, flags: x.flags }))

// ---- El Torito boot catalog ----
if (bootRecord) {
  const cat = await sectors(bootRecord.readUInt32LE(71), 1)
  const entries = []
  for (let off = 0; off < SECTOR; off += 32) {
    const e = cat.subarray(off, off + 32)
    if (e.every((x) => x === 0)) break
    const id = e[0]
    if (id === 0x01) entries.push({ off, kind: 'validation', platform: e[1], idString: e.subarray(4, 28).toString('latin1').replace(/\0/g, ''), sig: e.readUInt16LE(30).toString(16) })
    else if (id === 0x88 || id === 0x00) entries.push({ off, kind: 'initial/section entry', bootable: id === 0x88, mediaType: e[1], loadSegment: e.readUInt16LE(2).toString(16), systemType: e[4], sectorCount: e.readUInt16LE(6), loadRba: e.readUInt32LE(8) })
    else if (id === 0x90 || id === 0x91) entries.push({ off, kind: 'section header', last: id === 0x91, platform: e[1], count: e.readUInt16LE(2), idString: e.subarray(4, 32).toString('latin1').replace(/\0/g, '') })
    else entries.push({ off, kind: 'other', id: id.toString(16) })
  }
  report.bootCatalog = { lba: bootRecord.readUInt32LE(71), entries }
}
// EFI image: locate via GPT ESP or boot catalog EFI entry, fetch and grep grub.cfg-ish content
const esp = report.gpt && report.gpt.entries.find((e) => e.type === 'C12A7328-F81F-11D2-BA4B-00A0C93EC93B')
if (esp) {
  const bytes = (esp.end - esp.start + 1) * 512
  report.efiImage = { start512: esp.start, end512: esp.end, bytes }
  if (bytes <= 32 * 1024 * 1024) {
    const img = await range(esp.start * 512, bytes)
    fs.writeFileSync(path.join(outDir, 'efi.img'), img)
    // BPB summary
    report.efiImage.bpb = { oem: img.subarray(3, 11).toString('latin1'), bytesPerSec: img.readUInt16LE(11), secPerClus: img[13], rsvd: img.readUInt16LE(14), numFats: img[16], rootEnt: img.readUInt16LE(17), totSec16: img.readUInt16LE(19), media: img[21].toString(16), fatSz16: img.readUInt16LE(22), totSec32: img.readUInt32LE(32), volLab: img.subarray(43, 54).toString('latin1'), fsType: img.subarray(54, 62).toString('latin1') }
    const txt = img.toString('latin1')
    const idx = txt.indexOf('configfile')
    const idx2 = txt.indexOf('search ')
    const at = idx >= 0 ? idx : idx2
    if (at >= 0) {
      const s = Math.max(0, txt.lastIndexOf('\0', at) + 1)
      const e = txt.indexOf('\0', at)
      report.efiImage.grubCfgGuess = txt.substring(s, e < 0 ? at + 400 : e)
    }
  }
}
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
