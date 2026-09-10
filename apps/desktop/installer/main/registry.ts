// 「プログラムと機能」への登録と読み出し。HKCU（このユーザーだけ）。
//
// 読みは `exec()`（cmd.exe）経由なので **1 行のコマンド**でなければならない
// （改行を入れると cmd のクォートが壊れる）。書き・消しは spawn の引数配列に
// 渡す複数行スクリプト。この 2 つを混ぜないよう `ps-script.ts` で
// 名前を分けている（`build*Command` は 1 行、`build*Script` は複数行）。

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { runPowerShell, type Logger } from './exec.js'
import {
  buildDeleteUninstallEntryScript,
  buildReadUninstallFieldCommand,
  buildWriteUninstallEntryScript,
} from './ps-script.js'

const execP = promisify(exec)

export interface WriteEntryOptions {
  readonly productName: string
  readonly version: string
  readonly publisher: string
  readonly installDir: string
  readonly uninstallCommand: string
  readonly iconPath: string
  readonly logger: Logger
}

export async function writeUninstallEntry(opts: WriteEntryOptions): Promise<void> {
  const r = await runPowerShell(
    buildWriteUninstallEntryScript({
      productName: opts.productName,
      version: opts.version,
      publisher: opts.publisher,
      installDir: opts.installDir,
      uninstallCommand: opts.uninstallCommand,
      iconPath: opts.iconPath,
    }),
    opts.logger,
  )
  if (!r.ok) {
    throw new Error(r.stderr.trim() || `exit ${r.exitCode}`)
  }
}

export async function deleteUninstallEntry(logger: Logger): Promise<void> {
  await runPowerShell(buildDeleteUninstallEntryScript(), logger)
}

export function readExistingInstallDir(): Promise<string | null> {
  return readField('InstallLocation')
}

export function readExistingVersion(): Promise<string | null> {
  return readField('DisplayVersion')
}

async function readField(field: string): Promise<string | null> {
  try {
    // `windowsHide` が要る。付けないとウィザードが出る前に
    // コンソールウィンドウが一瞬ちらつく。
    const { stdout } = await execP(
      `powershell -NoProfile -Command "${buildReadUninstallFieldCommand(field)}"`,
      { windowsHide: true },
    )
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}
