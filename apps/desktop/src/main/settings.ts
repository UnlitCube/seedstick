import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { AppSettings } from '@autoinstall/shared'
import { resolveLocale } from '@autoinstall/shared'

// 設定は userData の JSON に保存する。アプリの更新で消えないパスなので、ここが正しい置き場所。

function defaults(): AppSettings {
  return {
    locale: resolveLocale(app.getLocale()),
    lastIsoDirectory: null,
    verifyAfterWrite: true,
    cidataSizeBytes: 64 * 1024 * 1024,
    auditRecord: true,
    commentLanguage: resolveLocale(app.getLocale()),
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
    locale: r.locale === 'ja' || r.locale === 'en' ? r.locale : d.locale,
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
      r.commentLanguage === 'ja' || r.commentLanguage === 'en' || r.commentLanguage === 'none'
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
