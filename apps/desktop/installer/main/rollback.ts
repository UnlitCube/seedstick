// 失敗・中止したときに、置いたものを逆順で片付ける。
//
// 「途中まで入った状態」を残さないのがここの仕事。
// 片付け自体の失敗は**利用者に見せない**（見せるべき失敗は既に決まっている）が、
// ログには必ず残す。何が残ったかは、あとで手で消すときに要る。

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from './exec.js'
import { deleteDesktopShortcut, deleteStartMenuShortcut } from './shortcuts.js'
import { deleteUninstallEntry } from './registry.js'

export interface InstallContext {
  readonly installDir: string
  /** インストール先を**このインストーラが作った**か。既存フォルダなら中身だけ消す。 */
  readonly installDirCreated: boolean
  extractionStarted: boolean
  desktopShortcutCreated: boolean
  startMenuShortcutCreated: boolean
  uninstallScriptWritten: boolean
  uninstallEntryWritten: boolean
}

export function newContext(installDir: string, installDirCreated: boolean): InstallContext {
  return {
    installDir,
    installDirCreated,
    extractionStarted: false,
    desktopShortcutCreated: false,
    startMenuShortcutCreated: false,
    uninstallScriptWritten: false,
    uninstallEntryWritten: false,
  }
}

export async function rollback(ctx: InstallContext, logger: Logger): Promise<void> {
  logger.append('\n[rollback] begin\n')

  if (ctx.uninstallEntryWritten) {
    await deleteUninstallEntry(logger).catch(() => {})
  }
  if (ctx.desktopShortcutCreated) {
    await deleteDesktopShortcut(logger).catch(() => {})
  }
  if (ctx.startMenuShortcutCreated) {
    await deleteStartMenuShortcut(logger).catch(() => {})
  }

  // ファイルは最後。展開した中身も uninstall.ps1 もここに入っている。
  if (ctx.extractionStarted || ctx.uninstallScriptWritten) {
    if (ctx.installDirCreated) {
      try {
        await fs.rm(ctx.installDir, { recursive: true, force: true })
        logger.append(`[rollback] removed ${ctx.installDir}\n`)
      } catch (e) {
        logger.append(`[rollback] failed to remove install dir: ${(e as Error).message}\n`)
      }
    } else {
      // 元からあったフォルダ。**フォルダ自体は残す**（利用者のものかもしれない）。
      try {
        const entries = await fs.readdir(ctx.installDir)
        const failed: string[] = []
        for (const e of entries) {
          try {
            await fs.rm(join(ctx.installDir, e), { recursive: true, force: true })
          } catch {
            failed.push(e)
          }
        }
        if (failed.length === 0) {
          logger.append(`[rollback] cleared contents of ${ctx.installDir}\n`)
        } else {
          // **「消した」と嘘を書かない。** 残ったものは名前で残す。
          logger.append(
            `[rollback] cleared contents, but ${failed.length} entries remain locked: ` +
              `${failed.slice(0, 10).join(', ')}\n`,
          )
        }
      } catch (e) {
        logger.append(`[rollback] failed to clear install dir: ${(e as Error).message}\n`)
      }
    }
  }

  logger.append('[rollback] done\n')
}
