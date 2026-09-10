import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  countPatchableKernelLines,
  nocloudSeedArg,
  patchGrubCfg,
  remainingGrubBytes,
} from './patch.js'

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

  it('自動インストールしない menuentry には印を付けない', () => {
    const r = patchGrubCfg(original, { args: ['autoinstall'], markTitle: true })
    // 「次のボリュームから起動」「UEFI 設定」「メモリテスト」は casper を起動しない。
    // 印を付けると、起動メニューで自動インストールの項目に見えて取り違える。
    for (const line of r.text.split('\n')) {
      if (!/^\s*menuentry\s/.test(line)) continue
      if (/Boot from next volume|UEFI Firmware Settings|Test memory|memtest/i.test(line)) {
        expect(line, line.trim()).not.toContain('[Autoinstall]')
      }
    }
    // 印が付くのは casper のカーネル行を持つ menuentry の数だけ
    expect(r.patchedTitles).toBe(c.kernelLines)
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

describe('ホストごとの menuentry', () => {
  const original = realGrubCfg('24.04.4')

  it('元の項目の直後に追加され、それぞれ固有のカーネル引数を持つ', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall'],
      extraEntries: [
        { title: 'web01 - 192.168.1.11/24', args: ['ai.hostname=web01', 'ai.ipv4=192.168.1.11/24'] },
        { title: 'web02 - 192.168.1.12/24', args: ['ai.hostname=web02', 'ai.ipv4=192.168.1.12/24'] },
      ],
    })
    expect(r.addedEntries).toBe(2)
    const titles = r.text.split('\n').filter((l) => /^\s*menuentry\s/.test(l))
    // **エントリ 0 は元の項目のまま**であること。
    // 実 ISO の grub.cfg には 4 リリースとも `set default=` が無いので既定は
    // エントリ 0 になる。ホストの項目を先頭に置くと、タイムアウトまで放置しただけで
    // 全台が「ホスト #1」のホスト名と IP を掴む（落とし穴 27）。
    expect(titles[0]).toContain('Try or Install Ubuntu Server')
    expect(titles[0]).not.toContain('web01')
    expect(titles[1]).toContain('web01')
    expect(titles[2]).toContain('web02')
    expect(r.text).toContain('ai.hostname=web01')
    expect(r.text).toContain('ai.hostname=web02')
  })

  it('ホストの項目が既定にならない（放置しても元の設定で入る）', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall'],
      extraEntries: [{ title: 'web01', args: ['ai.hostname=web01'] }],
    })
    // 既定を明示していないなら、エントリ 0 にホストの引数が無いこと。
    // 明示しているなら、それが 0 番以外を指していないこと。
    const lines = r.text.split('\n')
    const first = lines.findIndex((l) => /^\s*menuentry\s/.test(l))
    const body = lines.slice(first, first + 6).join('\n')
    expect(body).not.toContain('ai.hostname=')
  })

  it('既定を指定しなければ `set default=` を入れない（元の項目のまま）', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall'],
      extraEntries: [{ title: 'web01', args: ['ai.hostname=web01'] }],
    })
    // **製品の書き込み経路はここを通る。** 既定を動かすと、放置しただけで
    // 全台が同じホスト名・同じ IP を掴む（落とし穴 51 / 27）。
    expect(r.text).not.toContain('set default=')
  })

  it('`defaultEntry` を渡すと `set timeout=` の直後に `set default=` が入る', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall'],
      extraEntries: [
        { title: 'web01', args: ['ai.hostname=web01'] },
        { title: 'web02', args: ['ai.hostname=web02'] },
      ],
      defaultEntry: 2,
    })
    const lines = r.text.split('\n')
    const timeoutAt = lines.findIndex((l) => /^\s*set\s+timeout=/.test(l))
    expect(timeoutAt).toBeGreaterThanOrEqual(0)
    expect(lines[timeoutAt + 1]).toBe('set default=2')
    // **menuentry より前**にあること（GRUB は上から評価する）。
    const firstEntry = lines.findIndex((l) => /^\s*menuentry\s/.test(l))
    expect(timeoutAt + 1).toBeLessThan(firstEntry)
  })

  it('`defaultEntry` が指す番号は、追加した項目の並びと一致する', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall'],
      extraEntries: [
        { title: 'web01', args: ['ai.hostname=web01'] },
        { title: 'web02', args: ['ai.hostname=web02'] },
      ],
      defaultEntry: 2,
    })
    const entries = r.text.split('\n').filter((l) => /^\s*menuentry\s/.test(l))
    // [0] 元の項目 / [1] web01 / [2] web02。**この対応が崩れると別のホストで入る。**
    expect(entries[0]).not.toContain('web0')
    expect(entries[1]).toContain('web01')
    expect(entries[2]).toContain('web02')
    // 実際に選ばれるのは 2 番＝ web02。その項目のカーネル行に web02 の引数がある。
    const idx = r.text.split('\n').findIndex((l) => l.includes('menuentry') && l.includes('web02'))
    const body = r.text.split('\n').slice(idx, idx + 6).join('\n')
    expect(body).toContain('ai.hostname=web02')
    expect(body).not.toContain('ai.hostname=web01')
  })

  it('2 回当てても `set default=` は 1 行のまま（冪等）', () => {
    // **2 行になると 2048 バイトの予算を毎回 14 バイト食う。**
    // GRUB は後勝ちなので挙動は同じで、気づきにくい。
    // 既存の「引数が重複しない」テストは args しか見ていないのでここを守らない。
    const once = patchGrubCfg(original, { args: ['autoinstall'], defaultEntry: 1 })
    const twice = patchGrubCfg(once.text, { args: ['autoinstall'], defaultEntry: 1 })
    const count = twice.text.split('\n').filter((l) => /^\s*set\s+default=/.test(l)).length
    expect(count).toBe(1)
    expect(twice.text).toBe(once.text)
  })

  it('2 回目で別の番号を渡すと書き換わる（増えない）', () => {
    const once = patchGrubCfg(original, { args: ['autoinstall'], defaultEntry: 1 })
    const twice = patchGrubCfg(once.text, { args: ['autoinstall'], defaultEntry: 3 })
    const lines = twice.text.split('\n').filter((l) => /^\s*set\s+default=/.test(l))
    expect(lines).toEqual(['set default=3'])
  })
  it('`set timeout=` が無い grub.cfg でも先頭に入る', () => {
    const noTimeout = original.split('\n').filter((l) => !/^\s*set\s+timeout=/.test(l)).join('\n')
    const r = patchGrubCfg(noTimeout, { args: ['autoinstall'], defaultEntry: 0 })
    expect(r.text.split('\n')[0]).toBe('set default=0')
  })
  it('追加したエントリのカーネル行が casper を指し、--- の前に引数が入る', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall'],
      extraEntries: [{ title: 'db01', args: ['ai.hostname=db01'] }],
    })
    const line = r.text.split('\n').find((l) => l.includes('ai.hostname=db01'))!
    expect(line).toMatch(/linux\s+\/casper\/vmlinuz/)
    expect(line.indexOf('ai.hostname=db01')).toBeLessThan(line.indexOf('---'))
    expect(line).toContain('autoinstall')
  })

  it('initrd 行も一緒に複製される', () => {
    const r = patchGrubCfg(original, {
      args: ['autoinstall'],
      extraEntries: [{ title: 'db01', args: [] }],
    })
    const initrdCount = r.text.split('\n').filter((l) => /^\s*initrd\s+\/casper\/initrd\s*$/.test(l)).length
    const originalCount = original.split('\n').filter((l) => /^\s*initrd\s+\/casper\/initrd\s*$/.test(l)).length
    expect(initrdCount).toBe(originalCount + 1)
  })

  it('タイトルの " をエスケープする', () => {
    const r = patchGrubCfg(original, {
      args: [],
      extraEntries: [{ title: 'say "hi"', args: [] }],
    })
    expect(r.text).toContain('menuentry "say \\"hi\\"" {')
  })

  it('追加しない場合は addedEntries が 0', () => {
    expect(patchGrubCfg(original, { args: ['autoinstall'] }).addedEntries).toBe(0)
  })

  it('残りバイト数から追加できる件数が分かる', () => {
    const patched = patchGrubCfg(original, { args: ['autoinstall'] })
    const free = remainingGrubBytes(patched.text)
    expect(free).toBeGreaterThan(1000)

    // 実際に入る件数まで追加してもセクタに収まる
    const entries = Array.from({ length: 6 }, (_, i) => ({
      title: `host${i} - 192.168.1.${10 + i}/24`,
      args: [`ai.hostname=host${i}`, `ai.ipv4=192.168.1.${10 + i}/24`, 'ai.gw=192.168.1.1'],
    }))
    const withEntries = patchGrubCfg(original, { args: ['autoinstall'], extraEntries: entries })
    expect(Buffer.byteLength(withEntries.text, 'utf8')).toBeLessThan(2048)
  })
})
