import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  migrateProfile,
  summarizeProfile,
  type AutoinstallProfile,
  type LocalizedText,
  type ProfileSummary,
} from '@autoinstall/shared'

// 保存済みプロファイルのライブラリ。
// userData/profiles/<id>.json に 1 ファイル 1 プロファイルで置く。
// アプリを更新しても消えないパスであり、ユーザーがエクスプローラで持ち出すこともできる。

function profilesDir(): string {
  return join(app.getPath('userData'), 'profiles')
}

function profilePath(id: string): string {
  // id は自分で発行した UUID のみ。renderer から来た値をそのままパスに使わない。
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`invalid profile ID: ${id}`)
  return join(profilesDir(), `${id}.json`)
}

interface StoredProfile {
  readonly id: string
  readonly updatedAt: string
  readonly profile: AutoinstallProfile
}

async function readStored(id: string): Promise<StoredProfile | null> {
  try {
    const raw = JSON.parse(await readFile(profilePath(id), 'utf8')) as unknown
    if (raw === null || typeof raw !== 'object') return null
    const record = raw as { id?: unknown; updatedAt?: unknown; profile?: unknown }
    const { profile } = migrateProfile(record.profile)
    return {
      id,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
      profile,
    }
  } catch {
    return null
  }
}

/** 保存済みプロファイルの一覧を、更新日時の新しい順に返す。 */
export async function listProfiles(): Promise<ProfileSummary[]> {
  let names: string[]
  try {
    names = await readdir(profilesDir())
  } catch {
    return []
  }
  const out: ProfileSummary[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -5)
    const stored = await readStored(id).catch(() => null)
    if (stored) out.push(summarizeProfile(stored.id, stored.updatedAt, stored.profile))
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export interface SaveProfileResult {
  readonly id: string
  readonly updatedAt: string
}

/**
 * プロファイルを保存する。
 * @param id 既存を上書きする場合はその ID、新規なら null
 */
export async function saveProfile(
  id: string | null,
  name: string,
  profile: AutoinstallProfile,
): Promise<SaveProfileResult> {
  const targetId = id ?? randomUUID()
  const updatedAt = new Date().toISOString()
  const record: StoredProfile = {
    id: targetId,
    updatedAt,
    profile: { ...profile, meta: { ...profile.meta, name } },
  }
  await mkdir(profilesDir(), { recursive: true })
  // パスワードハッシュを含むので、他ユーザーから読めないようにする（Windows では無視される）
  await writeFile(profilePath(targetId), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return { id: targetId, updatedAt }
}

export async function loadProfile(
  id: string,
): Promise<{ profile: AutoinstallProfile; notes: LocalizedText[] } | null> {
  try {
    const raw = JSON.parse(await readFile(profilePath(id), 'utf8')) as { profile?: unknown }
    const { profile, notes } = migrateProfile(raw.profile)
    return { profile, notes: [...notes] }
  } catch {
    return null
  }
}

export async function deleteProfile(id: string): Promise<boolean> {
  try {
    await rm(profilePath(id), { force: true })
    return true
  } catch {
    return false
  }
}

/** 別名で複製する。元は変更しない。 */
export async function duplicateProfile(id: string, newName: string): Promise<SaveProfileResult | null> {
  const loaded = await loadProfile(id)
  if (!loaded) return null
  return saveProfile(null, newName, loaded.profile)
}

export async function renameProfile(id: string, newName: string): Promise<SaveProfileResult | null> {
  const loaded = await loadProfile(id)
  if (!loaded) return null
  return saveProfile(id, newName, loaded.profile)
}

/** 保存先フォルダのパス（UI から「フォルダを開く」用）。 */
export async function profilesDirectory(): Promise<string> {
  const dir = profilesDir()
  await mkdir(dir, { recursive: true })
  return dir
}

/** ファイルからインポートする（他の PC で作ったプロファイルを取り込む）。 */
export async function importProfileFile(path: string, name: string): Promise<SaveProfileResult> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  // エクスポートは { id, updatedAt, profile } でも、素の profile でも受け付ける
  const record = raw as { profile?: unknown }
  const { profile } = migrateProfile(record.profile ?? raw)
  return saveProfile(null, name || profile.meta.name, profile)
}

/** 単体のファイルとして書き出す（他の PC へ持っていく用）。 */
export async function exportProfileFile(profile: AutoinstallProfile, path: string): Promise<void> {
  const record = { id: null, updatedAt: new Date().toISOString(), profile }
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/** ペイロードの元ファイルが今も存在するかを確認する（プロファイルを開き直したとき用）。 */
export async function checkHostFile(path: string): Promise<{ exists: boolean; sizeBytes: number }> {
  try {
    const info = await stat(path)
    return { exists: info.isFile(), sizeBytes: info.size }
  } catch {
    return { exists: false, sizeBytes: 0 }
  }
}
