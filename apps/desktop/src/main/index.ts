import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { APP_ID } from '@autoinstall/shared'
import { disposeIpc, registerIpc } from './ipc.js'

// アプリ本体。GUI は通常権限で動き、USB への書き込みだけを昇格した子プロセスに任せる
// （write-supervisor.ts）。この分離があるので、アプリ全体を管理者で動かす必要がない。

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: 'Autoinstall USB Creator',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  // 外部リンクは既定のブラウザで開く。アプリ内で開かせない。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // アプリ内での外部ナビゲーションを禁止する
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// Windows の通知タイトルを正しく出すために必要
app.setAppUserModelId(APP_ID)

// 同時に 2 つ動くと USB への書き込みが競合するので単一インスタンスにする
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', (event) => {
    // 走っている書き込みワーカーを確実に片付ける（放置するとプロセスが残る）
    event.preventDefault()
    void disposeIpc().finally(() => {
      app.exit(0)
    })
  })
}
