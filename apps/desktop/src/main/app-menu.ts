import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { createTranslator, SITE_URL, type Locale } from '@autoinstall/shared'

/**
 * アプリのメニューと macOS の About パネルを、画面の言語で作り直す。
 * 言語を切り替えたら呼び直す（ipc.ts の saveSettings）。
 *
 * macOS: Electron の既定のメニューは英語固定なので、role 付きの項目に辞書の
 * ラベルを付けて作る。**編集メニューは消さない**（role: 'copy' 等が無いと
 * Cmd+C / Cmd+V が入力欄で効かなくなる）。
 *
 * Windows / Linux: メニューバーは出していない（autoHideMenuBar）が、Alt で
 * Electron の既定メニュー（英語・「開発者ツール」入り）が出てしまうので、
 * パッケージ版では消す。開発中は残す（DevTools と再読み込みに使う）。
 */
export function applyAppMenu(locale: Locale): void {
  const t = createTranslator(locale)
  const name = app.name

  app.setAboutPanelOptions({
    applicationName: name,
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 UnlitCube · MIT License',
    credits: t('about.disclaimer'),
    website: SITE_URL,
  })

  if (process.platform !== 'darwin') {
    if (app.isPackaged) Menu.setApplicationMenu(null)
    return
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: name,
      submenu: [
        { role: 'about', label: t('menu.about', { app: name }) },
        { type: 'separator' },
        { role: 'hide', label: t('menu.hide', { app: name }) },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.showAll') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit', { app: name }) },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        { type: 'separator' },
        { role: 'close', label: t('menu.close') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
