import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { APP_ID, createTranslator } from '@autoinstall/shared'
import { disposeIpc, isWriteInProgress, registerIpc, shutdownWrite } from './ipc.js'
import { getSettings } from './settings.js'

// アプリ本体。GUI は通常権限で動き、USB への書き込みだけを昇格した子プロセスに任せる
// （write-supervisor.ts）。この分離があるので、アプリ全体を管理者で動かす必要がない。

/**
 * 終了の確認を一度通ったか。
 * close と before-quit の両方から使うので、モジュールの状態として持つ。
 */
let quitConfirmed = false

/** 確認ダイアログを出している最中か。二重に出さないためのガード。 */
let asking = false

/**
 * 書き込み中に閉じようとしたときの確認。'continue' なら閉じない。
 *
 * これは renderer を通らない **OS ネイティブのダイアログ**なので、`LocalizedText` では
 * 届かない。ここだけは main が設定の言語で訳す。
 * 設定はいつでも変えられるので、控えた値ではなく毎回 `getSettings()` から読む
 * （控えると、English に切り替えたのにこのダイアログだけ日本語のまま出る）。
 */
export async function askWhileWriting(win: BrowserWindow | null): Promise<'continue' | 'abort'> {
  const t = createTranslator((await getSettings()).locale)
  const { response } = await dialog.showMessageBox(win ?? undefined!, {
    type: 'warning',
    buttons: [t('write.quitContinue'), t('write.quitAbort')],
    defaultId: 0,
    cancelId: 0,
    title: t('write.quitTitle'),
    message: t('write.quitMessage'),
    detail: t('write.quitDetail'),
  })
  return response === 0 ? 'continue' : 'abort'
}

/**
 * 確認を出し、「中止して終了する」なら書き込みを止めてから終了する。
 *
 * 設定を読むために非同期になったので、呼ぶ側は**先に** `event.preventDefault()` を
 * 済ませておくこと（同期の `showMessageBoxSync` から置き換えたときの唯一の違い）。
 * 答えを待っている間に二度目の close / before-quit が来てもダイアログを重ねない。
 */
function confirmThenQuit(win: BrowserWindow | null): void {
  if (asking) return
  asking = true
  void askWhileWriting(win)
    .then((answer) => {
      if (answer === 'continue') return
      quitConfirmed = true
      void shutdownWrite().finally(() => app.quit())
    })
    .finally(() => {
      asking = false
    })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: 'Seedstick',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  // 書き込み中に閉じられたら、**ウィンドウを壊す前に**確認する。
  //
  // before-quit だけで受けると、Windows では
  //   close → ウィンドウ破棄 → window-all-closed → app.quit() → before-quit
  // の順に進むため、そこで「書き込みを続ける」を選んでも戻る画面がもう無い。
  // ウィンドウ 0 個のまま生き続け、進捗も見えず中止もできず終了もできなくなる。
  win.on('close', (event) => {
    if (quitConfirmed || !isWriteInProgress()) return
    event.preventDefault()
    confirmThenQuit(win)
  })

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

  // メニューからの終了・OS のシャットダウンなど、ウィンドウの close を通らない経路。
  // そのまま終了すると昇格したワーカーが孤児になり、見えないまま USB を書き続ける。
  app.on('before-quit', (event) => {
    if (quitConfirmed || !isWriteInProgress()) return
    event.preventDefault()
    confirmThenQuit(BrowserWindow.getAllWindows()[0] ?? null)
  })

  app.on('will-quit', (event) => {
    // 走っている書き込みワーカーを確実に片付ける（放置するとプロセスが残る）
    event.preventDefault()
    void shutdownWrite()
      .catch(() => undefined)
      .then(() => disposeIpc())
      .finally(() => {
        app.exit(0)
      })
  })
}
