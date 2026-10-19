import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { AppSettings } from '@autoinstall/shared'
import { isLocale, negotiateLocale } from '@autoinstall/shared'

// 設定は userData の JSON に保存する。アプリの更新で消えないパスなので、ここが正しい置き場所。

/**
 * 初回の言語。OS の「好みの言語の並び」から選ぶ（第一言語が未対応なら第二言語を見る）。
 * `getPreferredSystemLanguages()` が空を返す環境もあるので、`getLocale()` も後ろに足す。
 */
function systemLocale(): AppSettings['locale'] {
  return negotiateLocale([...app.getPreferredSystemLanguages(), app.getLocale()])
}

function defaults(): AppSettings {
  return {
    locale: systemLocale(),
    lastIsoDirectory: null,
    verifyAfterWrite: true,
    cidataSizeBytes: 64 * 1024 * 1024,
    auditRecord: true,
    // 既定は「画面の言語に合わせる」。初回起動時の OS の言語で固定すると、
    // 画面の言語を変えても生成物のコメントだけが元の言語のまま残る。
    commentLanguage: 'ui',
  }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** 保存された値と既定値をマージする。未知のキーは捨て、欠けたキーは既定で埋める。 */
function normalize(raw: unknown): AppSettings {
  const d = defaults()
  if (raw === null || typeof raw !== 'object') return d
  const r = raw as Partial<AppSettings>
  return {
    locale: isLocale(r.locale) ? r.locale : d.locale,
    lastIsoDirectory: typeof r.lastIsoDirectory === 'string' ? r.lastIsoDirectory : null,
    // 明示的な boolean のみ受け入れる。undefined で「既定に戻す」を表現すると、
    // JSON.stringify がキーを落として二度と false にできなくなる。
    verifyAfterWrite: typeof r.verifyAfterWrite === 'boolean' ? r.verifyAfterWrite : d.verifyAfterWrite,
    cidataSizeBytes:
      typeof r.cidataSizeBytes === 'number' && r.cidataSizeBytes >= 1024 * 1024
        ? r.cidataSizeBytes
        : d.cidataSizeBytes,
    auditRecord: typeof r.auditRecord === 'boolean' ? r.auditRecord : d.auditRecord,
    commentLanguage:
      r.commentLanguage === 'ui' || r.commentLanguage === 'none' || isLocale(r.commentLanguage)
        ? r.commentLanguage
        : d.commentLanguage,
  }
}

let cache: AppSettings | null = null

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache
  try {
    cache = normalize(JSON.parse(await readFile(settingsPath(), 'utf8')))
  } catch {
    cache = defaults()
  }
  return cache
}

export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const normalized = normalize(next)
  cache = normalized
  const path = settingsPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}
