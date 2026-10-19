// 実 ISO から、テストに必要なセクタだけを抜き出した sparse フィクスチャを作る（Joliet ツリー込み）
import fs from 'node:fs'
const [url, reportPath, outPath] = process.argv.slice(2)
const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const S = 2048
async function range(start, len) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + len - 1}` } })
      if (res.status !== 206) throw new Error('HTTP ' + res.status)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) { if (attempt === 3) throw e; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))) }
  }
}
const chunks = []
const seen = new Set()
async function add(offset, len, note) {
  const key = offset + ':' + len
  if (seen.has(key)) return
  seen.add(key)
  chunks.push({ offset, note, data: (await range(offset, len)).toString('base64') })
}
function parseRecs(buf, joliet) {
  const out = []
  for (let off = 0; off < buf.length;) {
    if (buf[off] === 0) { const nx = (Math.floor(off / S) + 1) * S; if (nx >= buf.length) break; off = nx; continue }
    const len = buf[off]; if (!len) break
    const nl = buf[off + 32]
    const raw = buf.subarray(off + 33, off + 33 + nl)
    let name
    if (joliet) name = nl >= 2 ? Buffer.from(raw).swap16().toString('utf16le') : (raw[0] === 0 ? '.' : '..')
    else name = raw.toString('latin1')
    let su = off + 33 + nl + (nl % 2 === 0 ? 1 : 0); let rr = null
    for (let p = su; p + 4 <= off + len;) { const sig = buf.subarray(p, p + 2).toString('latin1'); const l = buf[p + 2]; if (l < 4) break; if (sig === 'NM') rr = (rr || '') + buf.subarray(p + 5, p + l).toString('utf8'); p += l }
    out.push({ name, rr, extent: buf.readUInt32LE(off + 2), size: buf.readUInt32LE(off + 10), dir: !!(buf[off + 25] & 2) })
    off += len
  }
  return out
}
async function readDir(extent, size, joliet) { return parseRecs(await range(extent * S, size), joliet) }
function find(list, want) { const w = want.toLowerCase(); return list.find(e => (e.rr && e.rr.toLowerCase() === w) || e.name.toLowerCase() === w || e.name.toLowerCase() === w + ';1' || e.name.toLowerCase() === w + '.;1' || e.name.toLowerCase() === w + '.') }
/** パスを辿り、途中のディレクトリすべてと最終ファイルの extent をフィクスチャに入れる */
async function capturePath(rootExtent, rootSize, parts, joliet, tag) {
  let ext = rootExtent, size = rootSize
  await add(ext * S, size, tag + ' root dir')
  for (const [i, part] of parts.entries()) {
    const list = await readDir(ext, size, joliet)
    const e = find(list, part)
    if (!e) { console.error('  MISS', tag, parts.slice(0, i + 1).join('/')); return null }
    if (e.dir) { await add(e.extent * S, e.size, tag + ' dir ' + part) }
    else { await add(e.extent * S, S * Math.ceil(e.size / S), tag + ' file ' + part) }
    ext = e.extent; size = e.size
  }
  return { extent: ext, size }
}

await add(0, 512 * 64, 'MBR + GPT header + entries (LBA0-63)')
// MBR の 0〜439 バイトは GRUB のブートコード（GPL-3.0+）。リポジトリ（MIT）に
// 持ち込まないよう、非ゼロの合成パターンに置き換える。テストが見るのは
// 「非ゼロであること」と「ISO と USB で一致すること」だけなので、これで足りる。
{
  const mbr = chunks.find((c) => c.offset === 0)
  const buf = Buffer.from(mbr.data, 'base64')
  const pat = Buffer.from('SEEDSTICK TEST FIXTURE - SYNTHETIC BYTES, NOT GRUB BOOT CODE. ', 'ascii')
  for (let i = 0; i < 440; i++) buf[i] = pat[i % pat.length]
  mbr.data = buf.toString('base64')
  mbr.note += '. MBR bytes 0-439 replaced with a synthetic pattern (the original is GRUB boot code, GPL-3.0+)'
}
await add(16 * S, 4 * S, 'volume descriptors 16-19')
// ISO9660 ツリー
const root = r.rootDir
for (const p of [['boot', 'grub', 'grub.cfg'], ['boot', 'grub', 'loopback.cfg'], ['.disk', 'info'], ['md5sum.txt'], ['casper']]) {
  await capturePath(root.extent, root.size, p, false, 'iso9660')
}
await add(r.bootCatalog.lba * S, S, 'El Torito boot catalog')
// Joliet ツリー（ルートから grub.cfg まで、途中のディレクトリも全部）
const jvd = r.volumeDescriptors.find(v => v.type === 2)
if (jvd) {
  const vd = await range(jvd.index * S, S)
  const jrootExtent = vd.readUInt32LE(158), jrootSize = vd.readUInt32LE(166)
  await capturePath(jrootExtent, jrootSize, ['boot', 'grub', 'grub.cfg'], true, 'joliet')
}
// 末尾のバックアップ GPT
await add(r.size.size - 512 * 64, 512 * 64, 'last 64 sectors (backup GPT)')

fs.writeFileSync(outPath, JSON.stringify({ url, size: r.size.size, volumeId: r.volumeDescriptors[0].volumeId, diskInfo: r.diskInfoText, grubCfg: { extent: r.grubCfg.extent, size: r.grubCfg.size }, chunks }, null, 1))
console.log('wrote', outPath, chunks.length, 'chunks,', chunks.reduce((a, c) => a + Buffer.from(c.data, 'base64').length, 0), 'bytes')
