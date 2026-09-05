import type { AutoinstallProfile } from '../autoinstall/model.js'
import type { ProfileSummary } from '../autoinstall/migrate.js'
import type { ValidationIssue } from '../autoinstall/validate.js'
import type { IsoIdentity } from '../iso/catalog.js'
import type { LocalizedText } from '../i18n/index.js'

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
  | {
      readonly ok: false
      readonly reason: string
      /** 画面に出す説明（renderer が訳す） */
      readonly text: LocalizedText
      /** 開発者向けの生の詳細（等幅で出す）。無ければ null。 */
      readonly detail: string | null
    }

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
  /** 選べない理由。列挙側（media）は利用者の言語を知らないので、訳さずに運ぶ。 */
  readonly blockedReason: LocalizedText | null
}

export interface GeneratedConfig {
  readonly userData: string
  readonly metaData: string
  readonly autoinstallYaml: string
  readonly issues: readonly ValidationIssue[]
  readonly ok: boolean
  /** 完全無人でインストールが完了するか（interactive-sections が空か） */
  readonly unattended: boolean
  /** USB に載せるペイロードの合計バイト数（CIDATA のサイズ決定に使う） */
  readonly payloadBytes: number
  /** ペイロードの元ファイルが見つからないもの（プロファイルを別の PC で開いた場合など） */
  readonly missingSources: readonly string[]
  /** 改変後の grub.cfg。ISO を選んでいないときは null。 */
  readonly patchedGrubCfg: string | null
  /** grub.cfg は 1 セクタ (2048B) に収める必要がある。残りバイト数。 */
  readonly grubFreeBytes: number
  /** grub.cfg がセクタに収まらない場合の説明 */
  readonly grubTooLarge: boolean
}

/** ホスト上のファイルを選んだ結果（アプリ展開のペイロード用）。 */
export interface PickedFile {
  readonly path: string
  readonly name: string
  readonly sizeBytes: number
  /** 拡張子から推測したアーカイブ形式。判定できなければ null。 */
  readonly archiveFormat: string | null
}

/** プロファイル保存の結果。 */
export interface SavedProfileRef {
  readonly id: string
  readonly updatedAt: string
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
  | { readonly state: 'preparing'; readonly message: LocalizedText }
  | {
      readonly state: 'writing'
      readonly phase: string
      readonly bytesDone: number
      readonly bytesTotal: number
      readonly label: LocalizedText
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
  // message は訳す総括文、detail は開発者向けの生の詳細（訳さない）。
  | { readonly state: 'error'; readonly message: LocalizedText; readonly detail: string | null }
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
  /**
   * ドロップされた File の実体パスを返す（取れなければ空文字）。
   * Electron 32 で `File.path` が削除されたので、preload の webUtils を通す。
   */
  pathForDroppedFile(file: File): string

  chooseIso(): Promise<IsoOpenResult | null>
  openIso(path: string): Promise<IsoOpenResult>
  computeIsoChecksum(path: string): Promise<ChecksumResult>
  onChecksumProgress(cb: (p: { bytesDone: number; bytesTotal: number }) => void): () => void

  // --- 設定生成 ---
  generateConfig(profile: AutoinstallProfile): Promise<GeneratedConfig>
  hashPassword(plain: string): Promise<string>

  // --- プロファイル（ライブラリ） ---
  /** 保存済みプロファイルの一覧（更新日時の新しい順） */
  listProfiles(): Promise<ProfileSummary[]>
  /** `id` を渡すと上書き保存、null なら新規保存 */
  saveNamedProfile(id: string | null, name: string, profile: AutoinstallProfile): Promise<SavedProfileRef>
  /**
   * 保存済みプロファイルを開く。古い形式は移行され、`notes` に注意点が入る。
   *
   * `notes` は**訳さないまま**運ぶ（main は利用者の言語を知らない）。
   * 訳すのは renderer が描画するとき。
   */
  loadNamedProfile(
    id: string,
  ): Promise<{ profile: AutoinstallProfile; notes: LocalizedText[] } | null>
  deleteNamedProfile(id: string): Promise<boolean>
  duplicateNamedProfile(id: string, newName: string): Promise<SavedProfileRef | null>
  renameNamedProfile(id: string, newName: string): Promise<SavedProfileRef | null>
  /** 保存フォルダをエクスプローラ／Finder で開く */
  revealProfilesFolder(): Promise<void>

  // --- プロファイル（ファイル入出力） ---
  saveProfile(profile: AutoinstallProfile): Promise<string | null>
  loadProfile(): Promise<{ profile: AutoinstallProfile; notes: LocalizedText[] } | null>
  importProfileToLibrary(): Promise<SavedProfileRef | null>
  exportBundle(profile: AutoinstallProfile): Promise<string | null>

  // --- アプリ展開のペイロード ---
  /** 展開するファイル／アーカイブを選ぶ */
  pickPayloadFile(): Promise<PickedFile | null>
  /** プロファイルを開き直したときに、元ファイルがまだあるか確認する */
  checkPayloadFile(path: string): Promise<{ exists: boolean; sizeBytes: number }>

  // --- デバイス ---
  listDevices(): Promise<DeviceInfo[]>

  // --- 書き込み ---
  startWrite(
    req: WriteRequest,
  ): Promise<{ started: boolean; message?: LocalizedText; detail?: string | null }>
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
