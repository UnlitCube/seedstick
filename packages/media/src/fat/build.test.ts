import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_SECTOR,
  buildFatImage,
  makeShortName,
  needsLongName,
  shortNameChecksum,
} from './build.js'
import { readFatImage } from './read.js'

const TS = new Date('2026-09-03T12:34:56Z')

function build(sizeBytes: number, files: { name: string; content: Buffer }[], forceFatType?: 12 | 16 | 32) {
  return buildFatImage({
    sizeBytes,
    label: 'CIDATA',
    files,
    hiddenSectors: 2048,
    volumeId: 0x12345678,
    timestamp: TS,
    ...(forceFatType ? { forceFatType } : {}),
  })
}

const SEED_FILES = [
  { name: 'user-data', content: Buffer.from('#cloud-config\nautoinstall:\n  version: 1\n', 'utf8') },
  { name: 'meta-data', content: Buffer.from('instance-id: autoinstall-test\n', 'utf8') },
]

describe('8.3 名の生成', () => {
  it('LFN が必要かを正しく判定する', () => {
    expect(needsLongName('user-data')).toBe(true) // 小文字
    expect(needsLongName('meta-data')).toBe(true)
    expect(needsLongName('AUTOEXEC.BAT')).toBe(false)
    expect(needsLongName('README')).toBe(false)
  })

  it('何度呼んでも同じ結果になる（正規表現の lastIndex を持ち越さない）', () => {
    // 判定用の正規表現に `/g` が付いていると、`test` を呼ぶたびに lastIndex が進み、
    // 同じ名前でも結果が交互に変わる。大文字で、基本名に 8.3 で使えない文字が
    // ちょうど 1 個あるときに露見する（実際に再現した）。
    // ルートディレクトリの予約数もこの関数で決まるので、名前の並び順しだいで
    // LFN が必要なのに短縮名だけで書かれた FAT ができる。
    for (let i = 0; i < 4; i++) {
      expect(needsLongName('A+B.TXT'), `${i + 1} 回目`).toBe(true)
    }
    // 拡張子側に不正文字があるときも同じ
    for (let i = 0; i < 4; i++) {
      expect(needsLongName('AB.T+T'), `${i + 1} 回目`).toBe(true)
    }
    // 途中に別の名前を挟んでも影響しない
    expect(needsLongName('A+B.TXT')).toBe(true)
    expect(needsLongName('README')).toBe(false)
    expect(needsLongName('A+B.TXT')).toBe(true)
    expect(needsLongName('VERYLONGNAME.TXT')).toBe(true) // 基本名 8 文字超
    expect(needsLongName('A.TOOLONG')).toBe(true) // 拡張子 3 文字超
    expect(needsLongName('a.b.c')).toBe(true) // ドットが 2 つ
  })

  it('user-data は USER-D~1 になる', () => {
    expect(makeShortName('user-data', new Set())).toBe('USER-D~1   ')
  })

  it('衝突したら番号を増やす', () => {
    const taken = new Set(['USER-D~1   '])
    expect(makeShortName('user-data', taken)).toBe('USER-D~2   ')
  })

  it('チェックサムは Microsoft 仕様どおり', () => {
    // 仕様書の算法をそのまま手計算した値
    expect(shortNameChecksum('USER-D~1   ')).toBe(
      'USER-D~1   '.split('').reduce((s, ch) => (((s & 1) << 7) + (s >>> 1) + ch.charCodeAt(0)) & 0xff, 0),
    )
  })
})

describe('buildFatImage', () => {
  it('64 MiB なら FAT16 になる', () => {
    const img = build(64 * 1024 * 1024, SEED_FILES)
    expect(img.fatType).toBe(16)
    expect(img.clusterCount).toBeGreaterThanOrEqual(4085)
    expect(img.clusterCount).toBeLessThan(65525)
  })

  it('BPB が仕様どおりの値を持つ', () => {
    const { data } = build(64 * 1024 * 1024, SEED_FILES)
    expect(data.readUInt16LE(11)).toBe(512) // BytsPerSec
    expect(data[16]).toBe(2) // NumFATs
    expect(data.readUInt16LE(17)).toBe(512) // RootEntCnt
    expect(data[21]).toBe(0xf8) // Media
    expect(data.readUInt32LE(28)).toBe(2048) // HiddSec = パーティション開始 LBA
    expect(data[38]).toBe(0x29) // BootSig
    expect(data.readUInt32LE(39)).toBe(0x12345678) // VolID
    expect(data.subarray(43, 54).toString('latin1')).toBe('CIDATA     ')
    expect(data.subarray(54, 62).toString('latin1')).toBe('FAT16   ')
    expect(data.readUInt16LE(510)).toBe(0xaa55)
  })

  it('FAT の先頭 2 エントリがメディアディスクリプタと EOC', () => {
    const { data } = build(64 * 1024 * 1024, SEED_FILES)
    const rsvd = data.readUInt16LE(14)
    const fatStart = rsvd * BYTES_PER_SECTOR
    expect(data.readUInt16LE(fatStart)).toBe(0xfff8)
    expect(data.readUInt16LE(fatStart + 2)).toBe(0xffff)
  })

  it('2 つの FAT コピーが完全に一致する', () => {
    const { data } = build(64 * 1024 * 1024, SEED_FILES)
    const rsvd = data.readUInt16LE(14)
    const fatSz = data.readUInt16LE(22)
    const a = data.subarray(rsvd * 512, (rsvd + fatSz) * 512)
    const b = data.subarray((rsvd + fatSz) * 512, (rsvd + 2 * fatSz) * 512)
    expect(a.equals(b)).toBe(true)
  })

  it('書き出したファイルを読み戻せる（ラウンドトリップ）', () => {
    const { data } = build(64 * 1024 * 1024, SEED_FILES)
    const fs = readFatImage(data)
    expect(fs.label).toBe('CIDATA')
    expect(fs.fatType).toBe(16)
    const names = fs.files.map((f) => f.name).sort()
    expect(names).toEqual(['meta-data', 'user-data'])
    const userData = fs.files.find((f) => f.name === 'user-data')!
    expect(userData.content.toString('utf8')).toBe(SEED_FILES[0]!.content.toString('utf8'))
    expect(userData.shortName).toBe('USER-D~1   ')
  })

  it('クラスタをまたぐ大きなファイルも正しく往復する', () => {
    const big = Buffer.alloc(300 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 7 + 13) & 0xff
    const { data } = build(64 * 1024 * 1024, [{ name: 'big-file.bin', content: big }])
    const fs = readFatImage(data)
    const f = fs.files.find((x) => x.name === 'big-file.bin')!
    expect(f.content.length).toBe(big.length)
    expect(f.content.equals(big)).toBe(true)
  })

  it('空ファイルは先頭クラスタ 0 で書かれ、読み戻すと 0 バイト', () => {
    const { data } = build(16 * 1024 * 1024, [{ name: 'meta-data', content: Buffer.alloc(0) }])
    const fs = readFatImage(data)
    const f = fs.files.find((x) => x.name === 'meta-data')!
    expect(f.content.length).toBe(0)
    expect(f.firstCluster).toBe(0)
  })

  it('ボリュームラベルのディレクトリエントリがある', () => {
    const { data } = build(64 * 1024 * 1024, SEED_FILES)
    const fs = readFatImage(data)
    expect(fs.volumeLabelEntry).toBe('CIDATA     ')
  })

  it('日本語ファイル名も LFN で往復する', () => {
    const { data } = build(64 * 1024 * 1024, [
      { name: '設定ファイル.yaml', content: Buffer.from('a: 1\n') },
    ])
    const fs = readFatImage(data)
    expect(fs.files.map((f) => f.name)).toContain('設定ファイル.yaml')
  })

  it('多数のファイルでもルートディレクトリに収まる', () => {
    const files = Array.from({ length: 40 }, (_, i) => ({
      name: `provision-file-${i}.conf`,
      content: Buffer.from(`n=${i}\n`),
    }))
    const { data } = build(64 * 1024 * 1024, files)
    const fs = readFatImage(data)
    expect(fs.files).toHaveLength(40)
    expect(new Set(fs.files.map((f) => f.shortName)).size).toBe(40) // 短縮名が重複しない
  })

  it('ルートディレクトリの上限を超えたら分かるエラーになる', () => {
    const files = Array.from({ length: 200 }, (_, i) => ({
      name: `a-rather-long-provision-file-name-${i}.conf`,
      content: Buffer.from('x'),
    }))
    expect(() => build(64 * 1024 * 1024, files)).toThrow(/root directory entries/)
  })

  it('容量を超えるファイルは分かるエラーになる', () => {
    expect(() => build(16 * 1024 * 1024, [{ name: 'huge.bin', content: Buffer.alloc(20 * 1024 * 1024) }])).toThrow(
      /not enough free space/,
    )
  })

  it('サイズが 512 の倍数でなければ拒否する', () => {
    expect(() => build(1000, [])).toThrow(/512/)
  })

  it('同じ入力からは常に同じイメージが出る（決定的）', () => {
    const a = build(64 * 1024 * 1024, SEED_FILES).data
    const b = build(64 * 1024 * 1024, SEED_FILES).data
    expect(a.equals(b)).toBe(true)
  })

  it('FAT32 を強制しても往復する', () => {
    const { data, fatType } = build(2200 * 1024 * 1024, SEED_FILES, 32)
    expect(fatType).toBe(32)
    expect(data.subarray(82, 90).toString('latin1')).toBe('FAT32   ')
    const fs = readFatImage(data)
    expect(fs.files.map((f) => f.name).sort()).toEqual(['meta-data', 'user-data'])
    expect(fs.label).toBe('CIDATA')
  })

  it('FAT12 を強制しても往復する', () => {
    const { data, fatType } = build(8 * 1024 * 1024, SEED_FILES, 12)
    expect(fatType).toBe(12)
    expect(data.subarray(54, 62).toString('latin1')).toBe('FAT12   ')
    const fs = readFatImage(data)
    expect(fs.files.map((f) => f.name).sort()).toEqual(['meta-data', 'user-data'])
  })
})
