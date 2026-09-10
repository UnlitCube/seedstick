// インストールの本体。
//
// 段は 4 つ（`ProgressPhase` と 1 対 1）:
//   preparing   → インストール先の用意（上書きなら中身を空にする）
//   extracting  → payload.7z の展開（一番長い。全体の 7 割をここに割り当てる）
//   shortcuts   → .lnk（**失敗しても続ける**。アプリは起動できる）
//   registering → アンインストーラの複製とレジストリ（同上）
//
// **画面の文言はここに書かない。** 段の判別子だけを流し、訳すのは renderer
// （落とし穴 78: `main` が返す日本語は renderer の番人から見えない）。
//
// 失敗と中止はどちらも `rollback()` を通す。「途中まで入った」状態を残さない。

import { promises as fs, existsSync } from 'node:fs'
import { exec } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type {
  FailureReason,
  InstallOptions,
  InstallProgress,
  InstallResult,
} from '../shared/protocol.js'
import { makeLogger, runPowerShell, type Logger } from './exec.js'
import { CancelledError, extractPayload } from './extract.js'
import { InstallDirError, normalizeInstallDir } from './install-dir.js'
import {
  APP_EXE_NAME,
  PRODUCT_NAME,
  UNINSTALL_SCRIPT_NAME,
  resolveAssets,
} from './paths.js'
import {
  buildDetectRunningInstanceCommand,
  buildKillLeftoverCleanupScript,
  buildUninstallScriptFile,
  uninstallCommandFor,
} from './ps-script.js'
import { writeUninstallEntry } from './registry.js'
import {
  createDesktopShortcut,
  createStartMenuShortcut,
  desktopLinkPath,
  startMenuLinkPath,
} from './shortcuts.js'
import { newContext, rollback, type InstallContext } from './rollback.js'

const execP = promisify(exec)

export const PUBLISHER = 'UnlitCube'

export type Emit = (p: InstallProgress) => void

/** 展開が全体に占める割合。ここだけが分単位でかかる。 */
const EXTRACT_SHARE = 0.7
const EXTRACT_START = 0.06

export async function runInstall(
  rawOptions: unknown,
  emit: Emit,
  signal: AbortSignal,
): Promise<InstallResult> {
  const logger = makeLogger()

  // --- renderer から来た値をここで正規化する（信用しない） -----------------
  let options: InstallOptions
  try {
    const o = (typeof rawOptions === 'object' && rawOptions !== null
      ? rawOptions
      : {}) as Record<string, unknown>
    options = {
      installDir: normalizeInstallDir(o['installDir']),
      // **明示的な boolean にする。** `undefined` を既定に使わない（このリポジトリの規約）。
      desktopShortcut: o['desktopShortcut'] === true,
      startMenuShortcut: o['startMenuShortcut'] === true,
      launchAfter: o['launchAfter'] === true,
    }
  } catch (e) {
    const reason: FailureReason =
      e instanceof InstallDirError && e.problem === 'not-writable'
        ? 'dir-not-writable'
        : 'dir-invalid'
    // ここは展開の前。まだ何も置いていない。
    return { kind: 'failed', reason, detail: describe(e), rolledBack: false }
  }

  const assets = resolveAssets()
  if (!assets.hasPayload) {
    return {
      kind: 'failed',
      reason: 'payload-missing',
      detail: `payload.7z: ${assets.payloadArchive}`,
      rolledBack: false,
    }
  }

  const installDir = options.installDir
  const exePath = join(installDir, APP_EXE_NAME)
  const isUpgrade = existsSync(installDir)
  const ctx: InstallContext = newContext(installDir, !isUpgrade)

  const checkAbort = (): void => {
    if (signal.aborted) throw new CancelledError()
  }

  try {
    // ----- 1. インストール先の用意 ---------------------------------------
    emit({ ratio: 0, phase: 'preparing' })

    // 前回のアンインストールが残した自己削除ポーラを先に殺す。
    // 生きたまま展開を始めると、置いたそばから消される。
    await runPowerShell(buildKillLeftoverCleanupScript(), logger).catch(() => {})

    await fs.mkdir(installDir, { recursive: true })
    checkAbort()

    if (isUpgrade) {
      const running = await detectRunningInstance(installDir)
      logger.append(
        `[precheck] processes under installDir: ${running.length === 0 ? '(none)' : running.join(', ')}\n`,
      )
      // 自分自身（アンインストーラ / セットアップ）は数えない。
      const blocking = running.filter(
        (n) => !/^uninstall /i.test(n) && !/setup$/i.test(n),
      )
      if (blocking.length > 0) {
        throw new StepError('dir-not-writable', `running: ${blocking.join(', ')}`)
      }
      const failed = await clearContents(installDir, logger)
      if (failed.length > 0) {
        throw new StepError(
          'dir-not-writable',
          `locked files: ${failed.slice(0, 5).join(', ')}`,
        )
      }
    }
    emit({ ratio: EXTRACT_START, phase: 'preparing' })

    // ----- 2. 展開 --------------------------------------------------------
    checkAbort()
    ctx.extractionStarted = true
    await extractPayload(
      assets.sevenZ,
      assets.payloadArchive,
      installDir,
      logger,
      signal,
      (p) => {
        emit({
          ratio: EXTRACT_START + p.ratio * EXTRACT_SHARE,
          phase: 'extracting',
          ...(p.files === undefined ? {} : { files: p.files }),
        })
      },
    ).catch((e: unknown) => {
      if (e instanceof CancelledError) throw e
      throw new StepError('extract-failed', describe(e))
    })

    if (!existsSync(exePath)) {
      // 展開は成功したのに本体が無い＝アーカイブの作り方が違う。
      // ここで気づかないと「起動しないショートカット」ができる。
      throw new StepError('extract-failed', `${APP_EXE_NAME} was not extracted`)
    }
    emit({ ratio: EXTRACT_START + EXTRACT_SHARE, phase: 'extracting' })

    // ----- 3. ショートカット（失敗しても続ける） --------------------------
    checkAbort()
    emit({ ratio: 0.8, phase: 'shortcuts' })
    if (options.startMenuShortcut) {
      try {
        await createStartMenuShortcut(exePath, logger)
        ctx.startMenuShortcutCreated = true
      } catch (e) {
        logger.append(`[warn] start-menu shortcut: ${describe(e)}\n`)
      }
    }
    if (options.desktopShortcut) {
      try {
        await createDesktopShortcut(exePath, logger)
        ctx.desktopShortcutCreated = true
      } catch (e) {
        logger.append(`[warn] desktop shortcut: ${describe(e)}\n`)
      }
    }

    // ----- 4. アンインストール情報（失敗しても続ける） --------------------
    checkAbort()
    emit({ ratio: 0.9, phase: 'registering' })
    let uninstallCommand = ''
    try {
      uninstallCommand = await writeUninstallScript(installDir, logger)
      ctx.uninstallScriptWritten = true
    } catch (e) {
      logger.append(`[warn] uninstall script: ${describe(e)}\n`)
    }
    try {
      await writeUninstallEntry({
        productName: PRODUCT_NAME,
        version: app.getVersion(),
        publisher: PUBLISHER,
        installDir,
        uninstallCommand,
        iconPath: exePath,
        logger,
      })
      ctx.uninstallEntryWritten = true
    } catch (e) {
      logger.append(`[warn] registry: ${describe(e)}\n`)
    }

    emit({ ratio: 1, phase: 'finished' })
    return { kind: 'ok', installDir, exePath }
  } catch (e) {
    const cancelled = e instanceof CancelledError
    emit({ ratio: 0, phase: 'cleaning' })
    await rollback(ctx, logger)
    if (cancelled) return { kind: 'cancelled' }
    const reason: FailureReason = e instanceof StepError ? e.reason : 'unknown'
    return { kind: 'failed', reason, rolledBack: true, detail: `${describe(e)}\n\n${logger.read()}`.trim() }
  }
}

/** 段の失敗に理由の判別子を持たせる（総称に潰さない。落とし穴 77）。 */
class StepError extends Error {
  readonly reason: FailureReason
  constructor(reason: FailureReason, message: string) {
    super(message)
    this.name = 'StepError'
    this.reason = reason
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function detectRunningInstance(installDir: string): Promise<string[]> {
  try {
    const { stdout } = await execP(
      `powershell -NoProfile -Command "${buildDetectRunningInstanceCommand(installDir)}"`,
      { windowsHide: true },
    )
    return stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/** 中身を空にする。**消せなかったものを名前で返す**（黙って続けない）。 */
async function clearContents(dir: string, logger: Logger): Promise<string[]> {
  const failed: string[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return failed
  }
  for (const name of entries) {
    const target = join(dir, name)
    // 掴まれているのはウイルス対策や検索インデクサのことがあるので数回試す。
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rm(target, { recursive: true, force: true })
        lastError = null
        break
      } catch (e) {
        lastError = e
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    if (lastError !== null) {
      failed.push(name)
      logger.append(`[precheck] failed to remove ${target} (${describe(lastError)})\n`)
    }
  }
  return failed
}

/**
 * アンインストールの手順書を置き、「プログラムと機能」から呼ぶコマンド行を返す。
 *
 * **Setup.exe を複製しない**（複製は payload ごと 196 MB になる。
 * 理由は `paths.ts` の `UNINSTALL_SCRIPT_NAME`）。
 *
 * BOM 付きの UTF-8 で書く。Windows PowerShell 5.1 は BOM が無いと
 * `.ps1` を ANSI コードページで読むので、パスに非 ASCII が入ると壊れる
 * （利用者名が日本語のプロファイルは珍しくない）。
 */
async function writeUninstallScript(installDir: string, logger: Logger): Promise<string> {
  const dest = join(installDir, UNINSTALL_SCRIPT_NAME)
  const script = buildUninstallScriptFile({
    installDir,
    desktopLink: desktopLinkPath(),
    startMenuLink: startMenuLinkPath(),
  })
  await fs.writeFile(dest, '\uFEFF' + script + '\r\n', 'utf8')
  logger.append(`[write] ${dest} (${script.length} bytes)\n`)
  return uninstallCommandFor(dest)
}
