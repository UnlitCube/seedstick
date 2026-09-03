import { createDefaultProfile } from './defaults.js'
import type { AutoinstallProfile, UbuntuSeries } from './model.js'
import { UBUNTU_SERIES } from './model.js'

// 保存済みプロファイルの読み込み。
// 古い形式や、手で編集されて壊れた JSON でもアプリが落ちないよう、
// 「既定値に、認識できたフィールドだけを重ねる」方針で読む。

/** オブジェクトか（配列と null を除く） */
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** 既定値の同じ形をひな型に、保存値で上書きする（深いマージ）。 */
function mergeSection<T extends Record<string, unknown>>(base: T, raw: unknown): T {
  if (!isObject(raw)) return base
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base)) {
    const value = raw[key]
    if (value === undefined) continue
    const current = out[key]
    if (isObject(current) && isObject(value)) {
      out[key] = mergeSection(current as Record<string, unknown>, value)
    } else if (Array.isArray(current)) {
      if (Array.isArray(value)) out[key] = value
    } else if (typeof current === typeof value || current === null) {
      out[key] = value
    }
  }
  return out as T
}

export interface MigrationResult {
  readonly profile: AutoinstallProfile
  /** 読み込み時に落とした/補った項目の説明（UI で知らせる） */
  readonly notes: readonly string[]
}

/**
 * 保存済み JSON をプロファイルに変換する。
 *
 * - v1（初版）には追加ユーザー・展開・サービス・GPU が無いので既定値で埋める。
 * - 未知のキーは捨てる（将来のバージョンで保存したファイルを開いた場合）。
 * - 型が合わないフィールドは既定値に戻す。
 */
export function migrateProfile(raw: unknown): MigrationResult {
  const notes: string[] = []
  if (!isObject(raw)) {
    return { profile: createDefaultProfile(), notes: ['ファイルの中身がプロファイルではありませんでした。'] }
  }

  const savedVersion = typeof raw['profileVersion'] === 'number' ? raw['profileVersion'] : 1
  const series = UBUNTU_SERIES.includes(raw['series'] as UbuntuSeries)
    ? (raw['series'] as UbuntuSeries)
    : undefined
  if (raw['series'] !== undefined && series === undefined) {
    notes.push(`対応していない Ubuntu バージョン (${String(raw['series'])}) だったため既定に戻しました。`)
  }

  const base = createDefaultProfile(series ?? '24.04')
  const meta = isObject(raw['meta']) ? raw['meta'] : {}
  const merged: AutoinstallProfile = {
    ...base,
    profileVersion: 2,
    meta: {
      name: str(meta['name'], base.meta.name),
      createdAt: str(meta['createdAt'], base.meta.createdAt),
      toolVersion: str(meta['toolVersion'], base.meta.toolVersion),
    },
    series: series ?? base.series,
    basics: mergeSection(base.basics, raw['basics']),
    user: mergeSection(base.user, raw['user']),
    ssh: mergeSection(base.ssh, raw['ssh']),
    // union 型なので mergeSection ではなく mode を見て採否を決める
    network: pickUnion(base.network, raw['network'], ['installer-default', 'dhcp', 'static', 'raw']),
    storage: pickUnion(base.storage, raw['storage'], ['lvm', 'direct', 'zfs', 'raw']),
    software: mergeSection(base.software, raw['software']),
    apt: mergeSection(base.apt, raw['apt']),
    postInstall: mergeSection(base.postInstall, raw['postInstall']),
    behavior: mergeSection(base.behavior, raw['behavior']),
    advanced: mergeSection(base.advanced, raw['advanced']),
  }

  if (savedVersion < 2) {
    notes.push(
      '古い形式のプロファイルを読み込みました。追加ユーザー・アプリ展開・サービス・GPU は未設定です。',
    )
  }
  if (savedVersion > 2) {
    notes.push(
      '新しいバージョンのツールで保存されたプロファイルです。認識できない設定は無視しました。',
    )
  }

  // SSH 鍵など、配列の中身が文字列であることまでは保証する
  const cleanedSsh = { ...merged.ssh, authorizedKeys: strList(merged.ssh.authorizedKeys) }
  return { profile: { ...merged, ssh: cleanedSsh }, notes }
}

/** union 型のセクションは `mode` が既知の値のときだけ採用する。 */
function pickUnion<T extends { mode: string }>(base: T, raw: unknown, allowed: readonly string[]): T {
  if (!isObject(raw)) return base
  const mode = raw['mode']
  if (typeof mode !== 'string' || !allowed.includes(mode)) return base
  // mode が既定と同じならフィールドを重ねられる。違うなら丸ごと採用する
  // （形が違うため部分マージすると壊れた状態になる）。
  return mode === base.mode ? mergeSection(base as Record<string, unknown>, raw) as T : (raw as T)
}

/** プロファイル一覧に出すための要約。 */
export interface ProfileSummary {
  readonly id: string
  readonly name: string
  readonly updatedAt: string
  readonly series: UbuntuSeries
  readonly hostname: string
  readonly username: string
  /** 何が設定されているかのバッジ用 */
  readonly highlights: {
    readonly additionalUsers: number
    readonly deployments: number
    readonly services: number
    readonly gpu: boolean
    readonly staticIp: boolean
  }
}

export function summarizeProfile(id: string, updatedAt: string, p: AutoinstallProfile): ProfileSummary {
  return {
    id,
    name: p.meta.name,
    updatedAt,
    series: p.series,
    hostname: p.basics.hostname,
    username: p.user.username,
    highlights: {
      additionalUsers: p.postInstall.additionalUsers.length,
      deployments: p.postInstall.deployments.length,
      services: p.postInstall.services.length,
      gpu: p.software.gpu.enabled,
      staticIp: p.network.mode === 'static',
    },
  }
}

/** ファイル名に使える形へ正規化する。 */
export function slugifyProfileName(name: string): string {
  const slug = name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'profile'
}
