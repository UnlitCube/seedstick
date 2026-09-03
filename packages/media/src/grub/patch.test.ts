import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { countPatchableKernelLines, nocloudSeedArg, patchGrubCfg } from './patch.js'

// 実 ISO から取り出した本物の grub.cfg に対してテストする。
// 22.04〜25.10 はタブ区切り、26.04 はスペース区切りなので、両方が通ることが重要。
const PROBE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/research/iso-probe')

// kernelLines は casper のカーネル行の数（HWE エントリがある版は 2）。
// 26.04.1 の grub.cfg には memtest の menuentry が無い（BIOS 側の else 節ごと消えている）。
const VERSIONS = [
  { v: '22.04.5', kernelLines: 2, size: 570, hasMemtest: true },
  { v: '24.04.4', kernelLines: 2, size: 573, hasMemtest: true },
  { v: '25.10', kernelLines: 1, size: 443, hasMemtest: true },
  { v: '26.04.1', kernelLines: 1, size: 394, hasMemtest: false },
] as const

function realGrubCfg(v: string): string {
  return readFileSync(join(PROBE_DIR, v, 'grub.cfg'), 'utf8')
}

describe.each(VERSIONS)('実 grub.cfg ($v)', (c) => {
  const original = realGrubCfg(c.v)

  it('元ファイルのサイズが実測値と一致する', () => {
    expect(Buffer.byteLength(original, 'utf8')).toBe(c.size)
  })

  it('casper のカーネル行だけを対象に数える（memtest は除く）', () => {
    expect(countPatchableKernelLines(original)).toBe(c.kernelLines)
    expect(original.includes('memtest')).toBe(c.hasMemtest)
  })

  it('autoinstall を --- の直前に挿入する', () => {
    const r = patchGrubCfg(original, { args: ['autoinstall'] })
    expect(r.patchedLines).toBe(c.kernelLines)
    // 挿入後も casper のカーネル行が同じ数だけあり、すべて autoinstall を持つ
    const kernelLines = r.text.split('\n').filter((l) => /^\s*linux\S*\s+\/casper\//.test(l))
    expect(kernelLines).toHaveLength(c.kernelLines)
    for (const line of kernelLines) {
      expect(line).toContain('autoinstall')
      // 引数は必ず --- の前に入る
      expect(line.indexOf('autoinstall')).toBeLessThan(line.indexOf('---'))
    }
  })

  it('memtest の linux16 行は変更しない', () => {
    const r = patchGrubCfg(original, { args: ['autoinstall'] })
    const memtestLines = r.text.split('\n').filter((l) => l.includes('memtest'))
    for (const line of memtestLines) expect(line).not.toContain('autoinstall')
  })

  it('2 回パッチしても引数が重複しない（冪等）', () => {
    const once = patchGrubCfg(original, { args: ['autoinstall'] })
    const twice = patchGrubCfg(once.text, { args: ['autoinstall'] })
    expect(twice.patchedLines).toBe(0)
    expect(twice.text).toBe(once.text)
  })

  it('パッチ後も 2048 バイトのセクタに収まる', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall', 'ds=nocloud\\;s=/cdrom/', 'fsck.mode=skip', 'net.ifnames=0'],
      markTitle: true,
      timeout: 5,
    })
    expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThan(2048)
  })

  it('タイムアウトを書き換えられる', () => {
    const r = patchGrubCfg(original, { args: ['autoinstall'], timeout: 3 })
    expect(r.text).toContain('set timeout=3')
    expect(r.text).not.toContain('set timeout=30')
  })

  it('タイトルに印を付けられる', () => {
    const r = patchGrubCfg(original, { args: ['autoinstall'], markTitle: true })
    expect(r.text).toContain('"Try or Install Ubuntu Server [Autoinstall]"')
    expect(r.patchedTitles).toBeGreaterThan(0)
  })

  it('パッチしても行数と行以外の内容は変わらない', () => {
    const r = patchGrubCfg(original, { args: ['autoinstall'] })
    expect(r.text.split('\n')).toHaveLength(original.split('\n').length)
    // カーネル行以外は完全に同一
    const before = original.split('\n')
    const after = r.text.split('\n')
    for (const [i, line] of before.entries()) {
      if (/^\s*linux\S*\s+\/casper\//.test(line)) continue
      expect(after[i]).toBe(line)
    }
  })
})

describe('patchGrubCfg の細かい挙動', () => {
  it('--- が無い行では行末に追加する', () => {
    const src = 'menuentry "x" {\n\tlinux\t/casper/vmlinuz quiet\n}\n'
    const r = patchGrubCfg(src, { args: ['autoinstall'] })
    expect(r.text).toContain('linux\t/casper/vmlinuz quiet autoinstall')
  })

  it('key=value は key が同じなら重複させない', () => {
    const src = '\tlinux\t/casper/vmlinuz ds=nocloud\\;s=/old/ ---\n'
    const r = patchGrubCfg(src, { args: ['ds=nocloud\\;s=/new/'] })
    expect(r.patchedLines).toBe(0)
    expect(r.text).toContain('/old/')
  })

  it('casper 以外のカーネルは対象外', () => {
    const src = '\tlinux16\t/boot/memtest86+x64.bin\n\tlinux\t/vmlinuz\n'
    expect(patchGrubCfg(src, { args: ['autoinstall'] }).patchedLines).toBe(0)
  })

  it('linuxefi 形式にも対応する', () => {
    const src = '\tlinuxefi\t/casper/vmlinuz  ---\n'
    const r = patchGrubCfg(src, { args: ['autoinstall'] })
    expect(r.patchedLines).toBe(1)
    expect(r.text).toContain('linuxefi\t/casper/vmlinuz autoinstall ---')
  })

  it('引数が空なら何も変えない', () => {
    const src = realGrubCfg('24.04.4')
    expect(patchGrubCfg(src, { args: [] }).text).toBe(src)
  })
})

describe('nocloudSeedArg', () => {
  it('GRUB のために ; をエスケープする', () => {
    // grub.cfg の中では ; がコマンド区切りとして解釈されるため \; が必要
    expect(nocloudSeedArg('/cdrom/')).toBe('ds=nocloud\\;s=/cdrom/')
    expect(nocloudSeedArg('http://10.0.0.1/seed/')).toBe('ds=nocloud\\;s=http://10.0.0.1/seed/')
  })
})
