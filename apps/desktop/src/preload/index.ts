import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AutoinstallApi,
  AutoinstallProfile,
  ChecksumResult,
  DeviceInfo,
  GeneratedConfig,
  IsoOpenResult,
  WriteRequest,
  WriteStatus,
} from '@autoinstall/shared'

// renderer が OS に触れる唯一の経路。contextIsolation は有効なので、
// ここに載っていないものは renderer から一切呼べない。

/** main → renderer の push を購読し、解除関数を返す。 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api: AutoinstallApi = {
  platform: process.platform,
  appVersion: process.env['npm_package_version'] ?? '0.1.0',
  systemLocale: Intl.DateTimeFormat().resolvedOptions().locale,

  chooseIso: () => ipcRenderer.invoke('chooseIso') as Promise<IsoOpenResult | null>,
  openIso: (path: string) => ipcRenderer.invoke('openIso', path) as Promise<IsoOpenResult>,
  computeIsoChecksum: (path: string) =>
    ipcRenderer.invoke('computeIsoChecksum', path) as Promise<ChecksumResult>,
  onChecksumProgress: (cb) => subscribe('checksum-progress', cb),

  generateConfig: (profile: AutoinstallProfile) =>
    ipcRenderer.invoke('generateConfig', profile) as Promise<GeneratedConfig>,
  hashPassword: (plain: string) => ipcRenderer.invoke('hashPassword', plain) as Promise<string>,

  saveProfile: (profile: AutoinstallProfile) =>
    ipcRenderer.invoke('saveProfile', profile) as Promise<string | null>,
  loadProfile: () => ipcRenderer.invoke('loadProfile') as Promise<AutoinstallProfile | null>,
  exportBundle: (profile: AutoinstallProfile) =>
    ipcRenderer.invoke('exportBundle', profile) as Promise<string | null>,

  listDevices: () => ipcRenderer.invoke('listDevices') as Promise<DeviceInfo[]>,
  onDevicesChanged: (cb) => subscribe('devices-changed', cb),

  startWrite: (req: WriteRequest) =>
    ipcRenderer.invoke('startWrite', req) as Promise<{ started: boolean; message?: string }>,
  cancelWrite: () => ipcRenderer.invoke('cancelWrite') as Promise<void>,
  onWriteStatus: (cb) => subscribe('write-status', cb),
  getWriteStatus: () => ipcRenderer.invoke('getWriteStatus') as Promise<WriteStatus>,

  getSettings: () => ipcRenderer.invoke('getSettings') as Promise<AppSettings>,
  saveSettings: (next: AppSettings) => ipcRenderer.invoke('saveSettings', next) as Promise<AppSettings>,

  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url) as Promise<void>,
  readTextFile: () =>
    ipcRenderer.invoke('readTextFile') as Promise<{ name: string; content: string } | null>,
}

contextBridge.exposeInMainWorld('autoinstall', api)
