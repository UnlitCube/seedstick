// インストーラの preload。`window.installer` として `InstallerBridge` だけを渡す。
//
// **契約に書いたもの以外は渡さない。** `ipcRenderer` そのものを露出すると、
// renderer から任意のチャンネルを叩けることになる（アプリ本体と同じ規約）。

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  CHANNEL,
  type DirCheck,
  type InstallOptions,
  type InstallProgress,
  type InstallResult,
  type InstallerBridge,
  type InstallerInfo,
} from '../shared/protocol.js'
import type { Locale } from '../shared/labels.js'

const api: InstallerBridge = {
  info: (): Promise<InstallerInfo> => ipcRenderer.invoke(CHANNEL.info),
  chooseDir: (current: string): Promise<string | null> =>
    ipcRenderer.invoke(CHANNEL.chooseDir, current),
  checkDir: (dir: string): Promise<DirCheck> => ipcRenderer.invoke(CHANNEL.checkDir, dir),
  start: (options: InstallOptions): Promise<InstallResult> =>
    ipcRenderer.invoke(CHANNEL.start, options),
  cancel: (): Promise<void> => ipcRenderer.invoke(CHANNEL.cancel),
  uninstall: (): Promise<InstallResult> => ipcRenderer.invoke(CHANNEL.uninstall),
  onProgress: (handler: (p: InstallProgress) => void): (() => void) => {
    const wrapped = (_e: IpcRendererEvent, p: InstallProgress): void => handler(p)
    ipcRenderer.on(CHANNEL.progress, wrapped)
    return () => {
      ipcRenderer.removeListener(CHANNEL.progress, wrapped)
    }
  },
  launchAndExit: (exePath: string): Promise<void> =>
    ipcRenderer.invoke(CHANNEL.launchAndExit, exePath),
  close: (): Promise<void> => ipcRenderer.invoke(CHANNEL.close),
  minimize: (): Promise<void> => ipcRenderer.invoke(CHANNEL.minimize),
  locale: (): Promise<Locale> => ipcRenderer.invoke(CHANNEL.locale),
}

contextBridge.exposeInMainWorld('installer', api)
