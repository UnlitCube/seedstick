// アンインストール（インストーラの UI から実行する経路）。
//
// 「プログラムと機能」から呼ばれるのは**インストール先に置いた `uninstall.ps1`**
// のほうで、こちらは通らない（Setup.exe を複製しないため。`paths.ts` を参照）。
// こちらは **Setup.exe をもう一度動かしたとき**の「アンインストール」ボタン用。
//
// Setup.exe は portable なので `%TEMP%` に自己展開して動く。つまり
// **インストール先のフォルダは掴んでいない**ので、ふつうは全部消せる。
// アプリ本体が起動中で掴まれているぶんだけ、切り離した PowerShell に
// 「消えるまで 2 秒おきに試す」ポーラを任せる (`buildSelfDeleteScript`)。
//
// **利用者が作ったものは消さない。** プロファイル JSON も、書き込んだ USB も、
// アプリの設定 (`%APPDATA%`) も残す。消すのはインストール先とショートカットと
// レジストリ項目だけ。

import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { InstallProgress, InstallResult } from '../shared/protocol.js'
import { makeLogger, type Logger } from './exec.js'
import { deleteUninstallEntry, readExistingInstallDir } from './registry.js'
import {
  deleteDesktopShortcut,
  deleteLegacyStartMenuFolder,
  deleteStartMenuShortcut,
} from './shortcuts.js'
import { buildSelfDeleteScript, selfDeleteSpawnArgs } from './ps-script.js'
import { defaultInstallDir } from './paths.js'

export type Emit = (p: InstallProgress) => void

/**
 * 消す対象のフォルダ。**renderer からは受け取らない。**
 * インストール時にレジストリへ書いた `InstallLocation` を見る。
 * 無ければ既定の場所（そこに何も無ければ、何も消えない）。
 */
export async function resolveUninstallDir(): Promise<string> {
  return (await readExistingInstallDir()) ?? defaultInstallDir()
}

export async function runUninstall(emit: Emit): Promise<InstallResult> {
  const logger = makeLogger()
  const installDir = await resolveUninstallDir()

  emit({ ratio: 0.1, phase: 'preparing' })

  emit({ ratio: 0.3, phase: 'shortcuts' })
  await deleteDesktopShortcut(logger).catch(() => {})
  await deleteStartMenuShortcut(logger).catch(() => {})
  await deleteLegacyStartMenuFolder(logger).catch(() => {})

  emit({ ratio: 0.5, phase: 'registering' })
  await deleteUninstallEntry(logger).catch(() => {})

  emit({ ratio: 0.7, phase: 'cleaning' })
  const remaining = await removeContents(installDir, logger)

  if (remaining.length > 0) {
    // アプリ本体が起動中などで掴まれているぶん。切り離したポーラに任せる。
    logger.append(`[uninstall] ${remaining.length} entries deferred to the poller: ${remaining.join(', ')}\n`)
    scheduleSelfDelete(installDir, logger)
  } else {
    await fs.rmdir(installDir).catch(() => {
      scheduleSelfDelete(installDir, logger)
    })
  }

  emit({ ratio: 1, phase: 'finished' })
  return { kind: 'ok', installDir, exePath: '' }
}

/** 中身を消し、**消えなかったものを返す**（黙って成功にしない）。 */
async function removeContents(dir: string, logger: Logger): Promise<string[]> {
  const remaining: string[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (e) {
    logger.append(`[uninstall] cannot read ${dir} (${(e as Error).message})\n`)
    return remaining
  }
  for (const name of entries) {
    const target = join(dir, name)
    try {
      await fs.rm(target, { recursive: true, force: true })
    } catch (e) {
      remaining.push(name)
      logger.append(`[uninstall] failed to remove ${target} (${(e as Error).message})\n`)
    }
  }
  return remaining
}

function scheduleSelfDelete(installDir: string, logger: Logger): void {
  try {
    const script = buildSelfDeleteScript(installDir)
    const child = spawn('powershell.exe', selfDeleteSpawnArgs(script), {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    logger.append(`[uninstall] self-delete poller started for ${installDir}\n`)
  } catch (e) {
    logger.append(`[uninstall] could not start the self-delete poller: ${(e as Error).message}\n`)
  }
}

/** `--uninstall --silent` 用。画面を出さずに走らせる（管理ツールから呼ぶとき）。 */
export async function runUninstallSilently(): Promise<boolean> {
  const result = await runUninstall(() => {})
  return result.kind === 'ok'
}
