// インストーラの main プロセス。
//
// argv でモード（インストール / アンインストール）を決め、枠なしの
// BrowserWindow を 1 枚開き、IPC を登録して、進捗を renderer へ流すだけ。
// 実際の作業は `install.ts` / `uninstall.ts` にある。

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import {
  CHANNEL,
  type DirCheck,
  type InstallProgress,
  type InstallResult,
  type InstallerInfo,
} from '../shared/protocol.js'
import type { Locale } from '../shared/labels.js'
import { checkInstallDir } from './install-dir.js'
import { PRODUCT_NAME, defaultInstallDir, resolveAssets } from './paths.js'
import { readExistingInstallDir } from './registry.js'
import { runInstall } from './install.js'
import { resolveUninstallDir, runUninstall, runUninstallSilently } from './uninstall.js'

// asar を素通しにする。既定では `fs.lstat('app.asar')` が
// 「ディレクトリ」を返し、`readdir` が中身を並べるので、上書きインストールの
// 掃除がアーカイブの中へ潜って本体の .asar を消し損ねる。
process.noAsar = true

const isUninstallMode = process.argv.includes('--uninstall')
const isSilent = process.argv.includes('--silent')
const isDev = !app.isPackaged

// 二重起動を防ぐ。展開の途中でもう 1 枚ウィザードが開くと、同じフォルダを
// 2 つのプロセスが掃除しあう。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let activeController: AbortController | null = null
/** 実行中に閉じるボタンが押された。片付けが終わったら本当に閉じる。 */
let closeRequested = false

/** ログオン名。取れない環境でも投げない（画面が空になるだけにする）。 */
function safeUserName(): string {
  try {
    return userInfo().username
  } catch {
    return process.env['USERNAME'] ?? ''
  }
}

function localeOf(): Locale {
  // アプリ本体と同じ 2 つ。判定も本体と同じく前方一致で見る。
  return app.getLocale().toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

function createWindow(): void {
  const assets = resolveAssets()
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: true,
    frame: false,
    backgroundColor: '#0b1020',
    show: false,
    // 隠れている間に描いておく。出した瞬間に白い枠が見えるのを防ぐ。
    paintWhenInitiallyHidden: true,
    title: PRODUCT_NAME,
    icon: existsSync(assets.iconPath) ? assets.iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  mainWindow.removeMenu()

  // DOM の準備と読み込み完了の**遅いほう**を待ってから出す。
  // `ready-to-show` だけだと、まだ CSS が当たっていない一瞬が見えることがある。
  let ready = false
  let loaded = false
  const tryShow = (): void => {
    if (ready && loaded && mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  }
  mainWindow.once('ready-to-show', () => {
    ready = true
    tryShow()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    loaded = true
    tryShow()
  })

  // 展開中に閉じられると、途中まで置いたものが残る。中止して片付けてから閉じる
  // （落とし穴 53: Windows では `before-quit` では遅い。`close` で捕まえる）。
  mainWindow.on('close', (event) => {
    if (activeController === null) return
    event.preventDefault()
    closeRequested = true
    mainWindow?.webContents.send(CHANNEL.progress, {
      ratio: 0,
      phase: 'cleaning',
    } satisfies InstallProgress)
    activeController.abort()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function emitProgress(p: InstallProgress): void {
  mainWindow?.webContents.send(CHANNEL.progress, p)
}

/**
 * 実行中に閉じるボタンが押されていたら、片付けが終わったいま本当に閉じる。
 * ここを忘れると、`close` を握り潰したままウィンドウが残る。
 */
function finishPendingClose(): void {
  if (!closeRequested) return
  closeRequested = false
  mainWindow?.close()
}

function registerIpc(): void {
  ipcMain.handle(CHANNEL.info, async (): Promise<InstallerInfo> => {
    const installedAt = await readExistingInstallDir()
    // アンインストールのときは「これから消す場所」を出す。
    // レジストリではなく**自分自身が置かれている場所**から導くのが正で、
    // ここで別のものを見せると、画面と実際の削除先が食い違う。
    const shown = isUninstallMode
      ? await resolveUninstallDir()
      : (installedAt ?? defaultInstallDir())
    return {
      productName: PRODUCT_NAME,
      version: app.getVersion(),
      userName: safeUserName(),
      defaultInstallDir: shown,
      needBytes: resolveAssets().needBytes,
      uninstallMode: isUninstallMode,
      installedAt,
    }
  })

  ipcMain.handle(CHANNEL.locale, (): Locale => localeOf())

  ipcMain.handle(CHANNEL.chooseDir, async (_e, current: unknown): Promise<string | null> => {
    if (!mainWindow) return null
    const defaultPath =
      typeof current === 'string' && current.trim() !== '' ? current : defaultInstallDir()
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    // 選ばれたのは「親フォルダ」なので、製品名のフォルダを足す。
    // ここを足さないと、選んだフォルダの中身と混ざる。
    const picked = result.filePaths[0]
    return picked === undefined ? null : join(picked, PRODUCT_NAME)
  })

  ipcMain.handle(
    CHANNEL.checkDir,
    (_e, dir: unknown): Promise<DirCheck> => checkInstallDir(dir, resolveAssets().needBytes),
  )

  ipcMain.handle(CHANNEL.start, async (_e, options: unknown): Promise<InstallResult> => {
    activeController = new AbortController()
    try {
      return await runInstall(options, emitProgress, activeController.signal)
    } finally {
      activeController = null
      finishPendingClose()
    }
  })

  ipcMain.handle(CHANNEL.cancel, (): void => {
    activeController?.abort()
  })

  ipcMain.handle(CHANNEL.uninstall, async (): Promise<InstallResult> => {
    activeController = new AbortController()
    try {
      return await runUninstall(emitProgress)
    } finally {
      activeController = null
      finishPendingClose()
    }
  })

  ipcMain.handle(CHANNEL.launchAndExit, (_e, exePath: unknown): void => {
    if (typeof exePath !== 'string') return
    if (!/\.exe$/i.test(exePath)) return
    if (!existsSync(exePath)) return
    try {
      const child = spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: join(exePath, '..'),
      })
      child.unref()
    } catch {
      // 起動できなくてもインストールは成功している。
      // ショートカットからは開けるので、ここでは黙る。
    }
    app.quit()
  })

  ipcMain.handle(CHANNEL.close, (): void => {
    // 実行中なら `close` のハンドラが中止に振り替える。
    mainWindow?.close()
  })
  ipcMain.handle(CHANNEL.minimize, (): void => {
    mainWindow?.minimize()
  })
}

if (gotLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    // 二重起動側は何もしない。`app.quit()` は非同期なので、
    // ここを素通りすると 2 つ目のウィンドウが一瞬できる。
    if (!gotLock) return

    // 外部 URL は開かない設計なので、renderer からの `window.open` は全部断る。
    app.on('web-contents-created', (_e, contents) => {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    })

    if (isUninstallMode && isSilent) {
      const ok = await runUninstallSilently()
      app.exit(ok ? 0 : 1)
      return
    }

    registerIpc()
    createWindow()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
