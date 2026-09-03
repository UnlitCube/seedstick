import type { AutoinstallProfile } from '../autoinstall/model.js'
import type { ValidationIssue } from '../autoinstall/validate.js'
import type { IsoIdentity } from '../iso/catalog.js'

// preload の contextBridge が公開する API の型。main と renderer の唯一の契約。
// renderer は main を import できないので、この型を共有パッケージ経由で共有する。

export interface IsoFileInfo {
  readonly path: string
  readonly fileName: string
  readonly sizeBytes: number
  readonly volumeId: string
  readonly diskInfo: string | null
  readonly identity: IsoIdentity
  /** grub.cfg の原文（確認画面で見せる） */
  readonly grubCfg: string
  /** 改変後の grub.cfg */
  readonly patchedGrubCfg: string
  readonly casperFiles: readonly string[]
  /** 書き込みに必要な最小デバイス容量 */
  readonly minimumDeviceBytes: number
}

export type IsoOpenResult =
  | { readonly ok: true; readonly info: IsoFileInfo }
  | { readonly ok: false; readonly reason: string; readonly detail: string }

export interface ChecksumResult {
  readonly sha256: string
  /** 公式 SHA256SUMS と照合できたか。`unknown` はオフライン等で確認できなかった場合。 */
  readonly official: 'match' | 'mismatch' | 'unknown'
  readonly officialSource: string | null
}

export interface DeviceInfo {
  readonly id: string
  readonly description: string
  readonly sizeBytes: number
  readonly bus: string
  readonly removable: boolean
  readonly isSystem: boolean
  readonly mountpoints: readonly string[]
  readonly serial: string | null
  readonly selectable: boolean
  readonly blockedReason: string | null
}

export interface GeneratedConfig {
  readonly userData: string
  readonly metaData: string
  readonly autoinstallYaml: string
  readonly issues: readonly ValidationIssue[]
  readonly ok: boolean
  /** 完全無人でインストールが完了するか（interactive-sections が空か） */
  readonly unattended: boolean
}

export interface WriteRequest {
  readonly isoPath: string
  readonly deviceId: string
  readonly profile: AutoinstallProfile
  readonly verify: boolean
  readonly cidataSizeBytes: number
  /** 作成記録 (autoinstall-usb.json) を CIDATA に残す */
  readonly auditRecord: boolean
}

export type WriteStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'preparing'; readonly message: string }
  | {
      readonly state: 'writing'
      readonly phase: string
      readonly bytesDone: number
      readonly bytesTotal: number
      readonly label: string
      readonly bytesPerSecond: number | null
      readonly etaSeconds: number | null
    }
  | {
      readonly state: 'done'
      readonly digest: string
      readonly bytesWritten: number
      readonly verified: boolean
      readonly elapsedMs: number
    }
  | { readonly state: 'error'; readonly message: string; readonly detail: string | null }
  | { readonly state: 'cancelled' }

export interface AppSettings {
  readonly locale: 'ja' | 'en'
  readonly lastIsoDirectory: string | null
  readonly verifyAfterWrite: boolean
  readonly cidataSizeBytes: number
  readonly auditRecord: boolean
  readonly commentLanguage: 'ja' | 'en' | 'none'
}

/** `window.autoinstall` の形。preload と renderer/env.d.ts はこれに合わせる。 */
export interface AutoinstallApi {
  /** process.platform の値。renderer に Node の型を持ち込まないため文字列で表す。 */
  readonly platform: 'win32' | 'darwin' | 'linux' | string
  readonly appVersion: string
  readonly systemLocale: string

  // --- ISO ---
  chooseIso(): Promise<IsoOpenResult | null>
  openIso(path: string): Promise<IsoOpenResult>
  computeIsoChecksum(path: string): Promise<ChecksumResult>
  onChecksumProgress(cb: (p: { bytesDone: number; bytesTotal: number }) => void): () => void

  // --- 設定生成 ---
  generateConfig(profile: AutoinstallProfile): Promise<GeneratedConfig>
  hashPassword(plain: string): Promise<string>

  // --- プロファイル ---
  saveProfile(profile: AutoinstallProfile): Promise<string | null>
  loadProfile(): Promise<AutoinstallProfile | null>
  exportBundle(profile: AutoinstallProfile): Promise<string | null>

  // --- デバイス ---
  listDevices(): Promise<DeviceInfo[]>
  onDevicesChanged(cb: (devices: DeviceInfo[]) => void): () => void

  // --- 書き込み ---
  startWrite(req: WriteRequest): Promise<{ started: boolean; message?: string }>
  cancelWrite(): Promise<void>
  onWriteStatus(cb: (s: WriteStatus) => void): () => void
  getWriteStatus(): Promise<WriteStatus>

  // --- 設定 ---
  getSettings(): Promise<AppSettings>
  saveSettings(next: AppSettings): Promise<AppSettings>

  // --- その他 ---
  openExternal(url: string): Promise<void>
  readTextFile(): Promise<{ name: string; content: string } | null>
}
