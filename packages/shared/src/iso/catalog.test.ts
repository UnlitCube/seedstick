import { describe, expect, it } from 'vitest'
import {
  isEndOfLife,
  monthsUntilEol,
  parseSha256Sums,
  recognizeIso,
  SERIES_CATALOG,
} from './catalog.js'

// 実 ISO から読み取った Volume ID / .disk/info をそのままテストデータにする。
describe('recognizeIso', () => {
  it.each([
    ['Ubuntu-Server 22.04.5 LTS amd64', '22.04', '22.04.5', 'amd64', true],
    ['Ubuntu-Server 24.04.4 LTS amd64', '24.04', '24.04.4', 'amd64', true],
    ['Ubuntu-Server 24.04.3 LTS amd64', '24.04', '24.04.3', 'amd64', true],
    ['Ubuntu-Server 25.10 amd64', '25.10', '25.10', 'amd64', false],
    ['Ubuntu-Server 26.04.1 LTS amd64', '26.04', '26.04.1', 'amd64', true],
  ])('%s を認識する', (volumeId, series, version, arch, isLts) => {
    const r = recognizeIso(volumeId)
    expect(r.kind).toBe('supported')
    if (r.kind !== 'supported') return
    expect(r.identity.series).toBe(series)
    expect(r.identity.version).toBe(version)
    expect(r.identity.arch).toBe(arch)
    expect(r.identity.isLts).toBe(isLts)
  })

  it('.disk/info からコードネームとビルド日を取る', () => {
    const r = recognizeIso(
      'Ubuntu-Server 24.04.4 LTS amd64',
      'Ubuntu-Server 24.04.4 LTS "Noble Numbat" - Release amd64 (20260210)',
    )
    expect(r.kind).toBe('supported')
    if (r.kind !== 'supported') return
    expect(r.identity.codename).toBe('Noble Numbat')
    expect(r.identity.buildId).toBe('20260210')
  })

  it('ポイントリリース付きの .disk/info も読める', () => {
    const r = recognizeIso(
      'Ubuntu-Server 22.04.5 LTS amd64',
      'Ubuntu-Server 22.04.5 LTS "Jammy Jellyfish" - Release amd64 (20240911.4)',
    )
    expect(r.kind === 'supported' && r.identity.buildId).toBe('20240911.4')
  })

  it('Desktop 版を not-server として拒否する', () => {
    // 実 ISO の Volume ID（ubuntu-22.04.5-desktop-amd64.iso）
    const r = recognizeIso('Ubuntu 22.04.5 LTS amd64')
    expect(r.kind).toBe('unsupported')
    if (r.kind === 'unsupported') expect(r.reason).toBe('not-server')
  })

  it('Ubuntu 以外を not-ubuntu として拒否する', () => {
    const r = recognizeIso('PVE')
    expect(r.kind).toBe('unsupported')
    if (r.kind === 'unsupported') expect(r.reason).toBe('not-ubuntu')
  })

  it('未対応バージョンを unknown-series として拒否する', () => {
    const r = recognizeIso('Ubuntu-Server 18.04.6 LTS amd64')
    expect(r.kind).toBe('unsupported')
    if (r.kind === 'unsupported') {
      expect(r.reason).toBe('unknown-series')
      expect(r.detail).toBe('18.04.6')
    }
  })

  it('arm64 も認識する', () => {
    const r = recognizeIso('Ubuntu-Server 24.04.4 LTS arm64')
    expect(r.kind === 'supported' && r.identity.arch).toBe('arm64')
  })
})

describe('EOL 判定', () => {
  it('25.10 は 2026-09 時点で EOL 済み', () => {
    expect(isEndOfLife(SERIES_CATALOG['25.10'], '2026-09-03')).toBe(true)
    expect(monthsUntilEol(SERIES_CATALOG['25.10'], '2026-09-03')).toBeLessThan(0)
  })

  it('LTS はまだ EOL ではない', () => {
    for (const series of ['22.04', '24.04', '26.04'] as const) {
      expect(isEndOfLife(SERIES_CATALOG[series], '2026-09-03'), series).toBe(false)
    }
  })

  it('EOL 月そのものはまだサポート内とみなす', () => {
    expect(isEndOfLife(SERIES_CATALOG['25.10'], '2026-07-31')).toBe(false)
    expect(isEndOfLife(SERIES_CATALOG['25.10'], '2026-08-01')).toBe(true)
  })

  it('22.04 は 2027-04 まで（残り月数が正）', () => {
    expect(monthsUntilEol(SERIES_CATALOG['22.04'], '2026-09-03')).toBe(7)
  })
})

describe('parseSha256Sums', () => {
  it('公式 SHA256SUMS の形式を解析する', () => {
    const text = [
      'e240e4b801f7bb68c20d1356b60968ad0c33a41d00d828e74ceb3364a0317be9 *ubuntu-24.04.4-live-server-amd64.iso',
      'a4acfda10b18da50e2ec50ccaf860d7f20b389df8765611142305c0e911d16fd *ubuntu-24.04.4-desktop-amd64.iso',
      '',
    ].join('\n')
    const sums = parseSha256Sums(text)
    expect(sums.size).toBe(2)
    expect(sums.get('ubuntu-24.04.4-live-server-amd64.iso')).toBe(
      'e240e4b801f7bb68c20d1356b60968ad0c33a41d00d828e74ceb3364a0317be9',
    )
  })

  it('アスタリスク無しの形式も読める', () => {
    const sums = parseSha256Sums(`${'0'.repeat(64)}  ubuntu.iso`)
    expect(sums.get('ubuntu.iso')).toBe('0'.repeat(64))
  })

  it('壊れた行は無視する', () => {
    expect(parseSha256Sums('garbage\nnot a hash *x.iso').size).toBe(0)
  })
})

describe('SERIES_CATALOG', () => {
  it('全シリーズが実測サイズと ISO 名を持つ', () => {
    for (const [series, entry] of Object.entries(SERIES_CATALOG)) {
      expect(entry.series, series).toBe(series)
      expect(entry.knownIsoSize, series).toBeGreaterThan(1e9)
      expect(entry.knownIsoName, series).toMatch(/^ubuntu-.*-live-server-amd64\.iso$/)
      expect(entry.releaseDir, series).toMatch(/^https:\/\/releases\.ubuntu\.com\//)
      expect(entry.eol, series).toMatch(/^\d{4}-\d{2}$/)
    }
  })

  it('カタログの ISO 名から自分自身を認識できる', () => {
    for (const entry of Object.values(SERIES_CATALOG)) {
      const volumeId = `Ubuntu-Server ${entry.knownLatestVersion}${entry.isLts ? ' LTS' : ''} amd64`
      const r = recognizeIso(volumeId)
      expect(r.kind, entry.series).toBe('supported')
      if (r.kind === 'supported') expect(r.identity.series).toBe(entry.series)
    }
  })
})
