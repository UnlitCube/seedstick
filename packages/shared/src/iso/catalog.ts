import { UBUNTU_SERIES, type UbuntuSeries } from '../autoinstall/model.js'

// ISO の識別と、シリーズごとの既知の値。すべて実 ISO の実測に基づく（docs/research/ISO-FACTS.md）。

export type IsoArch = 'amd64' | 'arm64'

export interface IsoIdentity {
  readonly series: UbuntuSeries
  /** ポイントリリースを含む完全なバージョン（例 `24.04.4`） */
  readonly version: string
  readonly arch: IsoArch
  readonly isLts: boolean
  /** コードネーム（`.disk/info` から取れた場合のみ） */
  readonly codename?: string
  /** ビルド日（`.disk/info` の末尾、例 `20260210`） */
  readonly buildId?: string
}

/**
 * ISO9660 の Volume ID。実測フォーマット:
 *   `Ubuntu-Server 24.04.4 LTS amd64`
 *   `Ubuntu-Server 25.10 amd64`
 */
const VOLUME_ID_RE = /^Ubuntu-Server (\d+\.\d+(?:\.\d+)?)( LTS)? (amd64|arm64)$/

/**
 * `.disk/info` の実測フォーマット:
 *   `Ubuntu-Server 24.04.4 LTS "Noble Numbat" - Release amd64 (20260210)`
 *   `Ubuntu-Server 26.10 "Stonking Stingray" - Official amd64 (20261010)`（Release ではない）
 */
const DISK_INFO_RE =
  /^Ubuntu-Server (\d+\.\d+(?:\.\d+)?)( LTS)? "([^"]+)" - \w+ (amd64|arm64) \((\d{8}(?:\.\d+)?)\)/

/** Desktop / 他フレーバーの ISO を弾くために使う（サポート外を明示するため） */
const OTHER_UBUNTU_VOLUME_ID_RE = /^Ubuntu(?:-(\w+))? /

export type IsoRecognition =
  | { readonly kind: 'supported'; readonly identity: IsoIdentity }
  | {
      readonly kind: 'unsupported'
      readonly reason: 'not-ubuntu' | 'not-server' | 'unknown-series'
      readonly detail: string
    }

function seriesOf(version: string): UbuntuSeries | undefined {
  const parts = version.split('.')
  const series = `${parts[0]}.${parts[1]}`
  // 対応表は model.ts の 1 か所だけ。ここに写すと、シリーズを足したとき写しだけが取り残される
  return UBUNTU_SERIES.find((s) => s === series)
}

/** Volume ID と（あれば）`.disk/info` から ISO を識別する。 */
export function recognizeIso(volumeId: string, diskInfo?: string): IsoRecognition {
  const trimmed = volumeId.trim()
  const m = VOLUME_ID_RE.exec(trimmed)
  if (!m) {
    if (!OTHER_UBUNTU_VOLUME_ID_RE.test(trimmed)) {
      return { kind: 'unsupported', reason: 'not-ubuntu', detail: trimmed }
    }
    return { kind: 'unsupported', reason: 'not-server', detail: trimmed }
  }
  const version = m[1]!
  const isLts = m[2] !== undefined
  const arch = m[3] as IsoArch
  const series = seriesOf(version)
  if (!series) {
    return { kind: 'unsupported', reason: 'unknown-series', detail: version }
  }
  const identity: {
    -readonly [K in keyof IsoIdentity]: IsoIdentity[K]
  } = { series, version, arch, isLts }
  if (diskInfo) {
    const d = DISK_INFO_RE.exec(diskInfo.trim())
    if (d) {
      identity.codename = d[3]!
      identity.buildId = d[5]!
    }
  }
  return { kind: 'supported', identity }
}

export interface SeriesCatalogEntry {
  readonly series: UbuntuSeries
  readonly codename: string
  readonly isLts: boolean
  /** releases.ubuntu.com 上のディレクトリ */
  readonly releaseDir: string
  /** 実測済みの最新ポイントリリース（ツール同梱のカタログ。更新はネットワーク経由で行う） */
  readonly knownLatestVersion: string
  readonly knownIsoName: string
  /** 実測サイズ（bytes）。ダウンロード進捗の目安と、明らかに違うファイルの検出に使う。 */
  readonly knownIsoSize: number
  /** grub.cfg に HWE カーネルの menuentry があるか */
  readonly hasHweEntry: boolean
  /** 標準サポート終了（YYYY-MM） */
  readonly eol: string
}

/** 実測値（2026-09-03、24.04.5 と 26.10 は 2026-10-20）。GUI の「ISO をダウンロード」導線とバージョン検証に使う。 */
export const SERIES_CATALOG: Record<UbuntuSeries, SeriesCatalogEntry> = {
  '22.04': {
    series: '22.04',
    codename: 'Jammy Jellyfish',
    isLts: true,
    releaseDir: 'https://releases.ubuntu.com/22.04/',
    knownLatestVersion: '22.04.5',
    knownIsoName: 'ubuntu-22.04.5-live-server-amd64.iso',
    knownIsoSize: 2_136_926_208,
    hasHweEntry: true,
    eol: '2027-04',
  },
  '24.04': {
    series: '24.04',
    codename: 'Noble Numbat',
    isLts: true,
    releaseDir: 'https://releases.ubuntu.com/24.04/',
    knownLatestVersion: '24.04.5',
    knownIsoName: 'ubuntu-24.04.5-live-server-amd64.iso',
    knownIsoSize: 4_080_486_400,
    hasHweEntry: true,
    eol: '2029-04',
  },
  '25.10': {
    series: '25.10',
    codename: 'Questing Quokka',
    isLts: false,
    releaseDir: 'https://releases.ubuntu.com/25.10/',
    knownLatestVersion: '25.10',
    knownIsoName: 'ubuntu-25.10-live-server-amd64.iso',
    knownIsoSize: 2_283_360_256,
    hasHweEntry: false,
    eol: '2026-07',
  },
  '26.04': {
    series: '26.04',
    codename: 'Resolute Raccoon',
    isLts: true,
    releaseDir: 'https://releases.ubuntu.com/26.04/',
    knownLatestVersion: '26.04.1',
    knownIsoName: 'ubuntu-26.04.1-live-server-amd64.iso',
    knownIsoSize: 2_927_861_760,
    hasHweEntry: false,
    eol: '2031-04',
  },
  '26.10': {
    series: '26.10',
    codename: 'Stonking Stingray',
    isLts: false,
    releaseDir: 'https://releases.ubuntu.com/26.10/',
    knownLatestVersion: '26.10',
    knownIsoName: 'ubuntu-26.10-live-server-amd64.iso',
    knownIsoSize: 2_897_321_984,
    hasHweEntry: false,
    // 非 LTS は 9 か月（25.10 と同じ数え方）
    eol: '2027-07',
  },
}

/**
 * そのシリーズが標準サポート終了済みか。
 * EOL 済みの ISO で作った USB は、インストール後にセキュリティ更新が来ない。
 * @param today `YYYY-MM-DD` 形式。テストで固定できるよう引数にする。
 */
export function isEndOfLife(entry: SeriesCatalogEntry, today: string): boolean {
  // eol は `YYYY-MM`。その月の末日までサポートされるものとして比較する。
  return today.slice(0, 7) > entry.eol
}

/** EOL までの残り月数（負なら EOL 済み）。UI の警告文に使う。 */
export function monthsUntilEol(entry: SeriesCatalogEntry, today: string): number {
  const [ty, tm] = today.split('-').map(Number) as [number, number]
  const [ey, em] = entry.eol.split('-').map(Number) as [number, number]
  return (ey - ty) * 12 + (em - tm)
}

/** `SHA256SUMS` の 1 行を解析する。形式: `<64桁hex> *<filename>` */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (m) out.set(m[2]!, m[1]!)
  }
  return out
}
