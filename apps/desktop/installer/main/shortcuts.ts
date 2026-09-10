// .lnk の作成と削除。Windows は CLI を用意していないので
// PowerShell 経由で `WScript.Shell` の COM を叩く。
//
// **このユーザーの場所に作る**（`%APPDATA%` / 利用者のデスクトップ）。
// 全ユーザー向け（`%PUBLIC%` / `%ProgramData%`）は管理者権限が要るし、
// インストール先が `%LOCALAPPDATA%` なので他のユーザーからは実行できない。
//
// デスクトップの位置は環境変数ではなく Electron の `app.getPath('desktop')` を使う。
// OneDrive がデスクトップを引き取っている環境では
// `%USERPROFILE%\Desktop` が実際の場所ではない。

import { app } from 'electron'
import { dirname, join } from 'node:path'
import { runPowerShell, type Logger } from './exec.js'
import {
  buildDeleteFileScript,
  buildDeleteFolderScript,
  buildMkdirScript,
  buildShortcutScript,
} from './ps-script.js'
import { PRODUCT_NAME, startMenuDir } from './paths.js'

function checked(
  r: { ok: boolean; stderr: string; exitCode: number | null },
  what: string,
): void {
  if (!r.ok) throw new Error(`${what}: ${r.stderr.trim() || `exit ${r.exitCode}`}`)
}

export function desktopLinkPath(): string {
  let desktop: string
  try {
    desktop = app.getPath('desktop')
  } catch {
    desktop = join(process.env['USERPROFILE'] ?? 'C:\\', 'Desktop')
  }
  return join(desktop, `${PRODUCT_NAME}.lnk`)
}

export function startMenuLinkPath(): string {
  return join(startMenuDir(), `${PRODUCT_NAME}.lnk`)
}

export async function createDesktopShortcut(exePath: string, logger: Logger): Promise<void> {
  const link = desktopLinkPath()
  const r = await runPowerShell(buildShortcutScript(link, exePath, dirname(exePath)), logger)
  checked(r, `desktop shortcut (${link})`)
}

export async function createStartMenuShortcut(exePath: string, logger: Logger): Promise<void> {
  const folder = startMenuDir()
  const link = startMenuLinkPath()
  // 2 回に分けるのは、どちらで失敗したかを終了コードで見分けられるようにするため。
  checked(await runPowerShell(buildMkdirScript(folder), logger), `start-menu folder (${folder})`)
  const r = await runPowerShell(buildShortcutScript(link, exePath, dirname(exePath)), logger)
  checked(r, `start-menu shortcut (${link})`)
}

/** 後始末。**失敗しても投げない**（既に無いのが普通）。 */
export async function deleteDesktopShortcut(logger: Logger): Promise<void> {
  await runPowerShell(buildDeleteFileScript(desktopLinkPath()), logger)
}

export async function deleteStartMenuShortcut(logger: Logger): Promise<void> {
  await runPowerShell(buildDeleteFileScript(startMenuLinkPath()), logger)
}

/** 旧版がフォルダを作っていた場合に備えて、空なら消す。 */
export async function deleteLegacyStartMenuFolder(logger: Logger): Promise<void> {
  await runPowerShell(buildDeleteFolderScript(join(startMenuDir(), PRODUCT_NAME)), logger)
}
