import { create } from 'zustand'
import {
  createDefaultProfile,
  resolveLocale,
  type AppSettings,
  type ChecksumResult,
  type AutoinstallProfile,
  type DeviceInfo,
  type GeneratedConfig,
  type IsoFileInfo,
  type Locale,
  type ProfileSummary,
  type WriteStatus,
} from '@autoinstall/shared'

// アプリ全体の状態。ステップを移動しても入力が消えないよう 1 つのストアに集約する。

export type StepId =
  | 'iso'
  | 'basics'
  | 'user'
  | 'network'
  | 'storage'
  | 'runtime'
  | 'software'
  | 'postinstall'
  | 'review'
  | 'write'

export const STEP_ORDER: readonly StepId[] = [
  'iso',
  'basics',
  'user',
  'network',
  'storage',
  'runtime',
  'software',
  'postinstall',
  'review',
  'write',
]

interface AppState {
  ready: boolean
  locale: Locale
  settings: AppSettings | null
  step: StepId
  profile: AutoinstallProfile
  iso: IsoFileInfo | null
  isoError: string | null
  isoBusy: boolean
  checksum: ChecksumResult | null
  checksumProgress: { bytesDone: number; bytesTotal: number } | null
  config: GeneratedConfig | null
  configBusy: boolean
  devices: DeviceInfo[]
  devicesBusy: boolean
  selectedDeviceId: string | null
  writeStatus: WriteStatus
  /** 平文パスワードはここにだけ置く。保存もログ出力もしない。 */
  passwordDraft: string
  passwordConfirmDraft: string
  /** 保存済みプロファイルの一覧 */
  profiles: ProfileSummary[]
  /** 今開いているプロファイルの ID。未保存なら null。 */
  currentProfileId: string | null
  /** 最後の保存以降に変更があったか */
  dirty: boolean
  /** プロファイル読み込み時の注意（古い形式の移行など） */
  profileNotes: string[]

  init(): Promise<void>
  setStep(step: StepId): void
  updateProfile(fn: (p: AutoinstallProfile) => AutoinstallProfile): void
  setPasswordDraft(plain: string, confirm: string): void
  applyPassword(): Promise<void>
  chooseIso(): Promise<void>
  openIsoPath(path: string): Promise<void>
  clearIso(): void
  verifyChecksum(): Promise<void>
  regenerate(): Promise<void>
  refreshDevices(): Promise<void>
  selectDevice(id: string | null): void
  startWrite(): Promise<void>
  cancelWrite(): Promise<void>
  /** 書き込み結果を消して、もう一本作れる状態に戻す */
  resetWrite(): void
  saveSettings(update: (s: AppSettings) => AppSettings): Promise<void>
  loadProfileFromDisk(): Promise<void>
  setLocale(locale: Locale): Promise<void>
  refreshProfiles(): Promise<void>
  saveCurrentProfile(name?: string): Promise<void>
  openProfile(id: string): Promise<void>
  removeProfile(id: string): Promise<void>
  duplicateProfile(id: string, newName: string): Promise<void>
  newProfile(): void
  dismissProfileNotes(): void
}

/** 設定保存の直列化。連続保存で古いスナップショットが後勝ちするのを防ぐ。 */
let settingsChain: Promise<unknown> = Promise.resolve()

/** 設定生成の多重起動を避けるための世代番号 */
let generation = 0

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  locale: 'ja',
  settings: null,
  step: 'iso',
  profile: createDefaultProfile('24.04', 'autoinstall-ui/0.1.0', new Date().toISOString()),
  iso: null,
  isoError: null,
  isoBusy: false,
  checksum: null,
  checksumProgress: null,
  config: null,
  configBusy: false,
  devices: [],
  devicesBusy: false,
  selectedDeviceId: null,
  writeStatus: { state: 'idle' },
  passwordDraft: '',
  passwordConfirmDraft: '',
  profiles: [],
  currentProfileId: null,
  dirty: false,
  profileNotes: [],

  async init() {
    const settings = await window.autoinstall.getSettings()
    set({
      settings,
      locale: settings.locale ?? resolveLocale(window.autoinstall.systemLocale),
      ready: true,
    })
    window.autoinstall.onWriteStatus((writeStatus) => {
      set({ writeStatus })
      // 書き込みが終わったらデバイス一覧を更新する（ドライブレターが変わるため）
      if (writeStatus.state === 'done') void get().refreshDevices()
    })
    window.autoinstall.onChecksumProgress((checksumProgress) => set({ checksumProgress }))
    set({ writeStatus: await window.autoinstall.getWriteStatus() })
    void get().refreshProfiles()
    void get().regenerate()
  },

  setStep(step) {
    set({ step })
    if (step === 'review') void get().regenerate()
    if (step === 'write') void get().refreshDevices()
  },

  updateProfile(fn) {
    set({ profile: fn(get().profile), dirty: true })
    void get().regenerate()
  },

  setPasswordDraft(passwordDraft, passwordConfirmDraft) {
    set({ passwordDraft, passwordConfirmDraft })
  },

  async applyPassword() {
    const { passwordDraft } = get()
    if (!passwordDraft) return
    // ハッシュ化は main 側で行う。平文はストアの外に出さない。
    const hash = await window.autoinstall.hashPassword(passwordDraft)
    get().updateProfile((p) => ({ ...p, user: { ...p.user, passwordHash: hash } }))
  },

  async chooseIso() {
    set({ isoBusy: true, isoError: null })
    try {
      const result = await window.autoinstall.chooseIso()
      if (!result) return
      if (!result.ok) {
        set({ isoError: result.detail, iso: null })
        return
      }
      set({ iso: result.info, isoError: null, checksum: null, checksumProgress: null })
      get().updateProfile((p) => ({ ...p, series: result.info.identity.series }))
    } finally {
      set({ isoBusy: false })
    }
  },

  async openIsoPath(path) {
    set({ isoBusy: true, isoError: null })
    try {
      const result = await window.autoinstall.openIso(path)
      if (!result.ok) {
        set({ isoError: result.detail, iso: null })
        return
      }
      set({ iso: result.info, isoError: null, checksum: null, checksumProgress: null })
      get().updateProfile((p) => ({ ...p, series: result.info.identity.series }))
    } finally {
      set({ isoBusy: false })
    }
  },

  clearIso() {
    set({ iso: null, isoError: null, checksum: null, checksumProgress: null })
  },

  async verifyChecksum() {
    const iso = get().iso
    if (!iso) return
    set({ checksumProgress: { bytesDone: 0, bytesTotal: iso.sizeBytes } })
    try {
      const checksum = await window.autoinstall.computeIsoChecksum(iso.path)
      set({ checksum })
    } finally {
      set({ checksumProgress: null })
    }
  },

  async regenerate() {
    const myGeneration = ++generation
    set({ configBusy: true })
    try {
      const config = await window.autoinstall.generateConfig(get().profile)
      // 生成中に profile が変わっていたら古い結果を捨てる
      if (myGeneration === generation) set({ config })
    } catch {
      if (myGeneration === generation) set({ config: null })
    } finally {
      if (myGeneration === generation) set({ configBusy: false })
    }
  },

  async refreshDevices() {
    set({ devicesBusy: true })
    try {
      const devices = await window.autoinstall.listDevices()
      const selected = get().selectedDeviceId
      set({
        devices,
        // 選択中のデバイスが消えたら選択を外す（抜かれた USB に書かないため）
        selectedDeviceId: devices.some((d) => d.id === selected && d.selectable) ? selected : null,
      })
    } finally {
      set({ devicesBusy: false })
    }
  },

  selectDevice(selectedDeviceId) {
    set({ selectedDeviceId })
  },

  async startWrite() {
    const { iso, selectedDeviceId, profile, settings } = get()
    if (!iso || !selectedDeviceId || !settings) return
    const result = await window.autoinstall.startWrite({
      isoPath: iso.path,
      deviceId: selectedDeviceId,
      profile,
      verify: settings.verifyAfterWrite,
      cidataSizeBytes: settings.cidataSizeBytes,
      auditRecord: settings.auditRecord,
    })
    if (!result.started) {
      set({
        writeStatus: {
          state: 'error',
          message: result.message ?? '書き込みを開始できませんでした。',
          detail: null,
        },
      })
    }
  },

  async cancelWrite() {
    await window.autoinstall.cancelWrite()
  },

  /**
   * 書き込み結果を片付けて、もう一本作れる状態に戻す。
   *
   * これが無いと writeStatus が 'done' のまま残り、完了画面から先へ進めない。
   * 複数台ぶんの USB を続けて作るのはこのツールの主用途なので、
   * 「アプリを再起動しないと 2 本目が作れない」のは実質的な機能欠落だった。
   */
  resetWrite() {
    set({ writeStatus: { state: 'idle' } })
    void get().refreshDevices()
  },

  async saveSettings(update) {
    settingsChain = settingsChain.then(async () => {
      // 保存直前に最新を取り直す。古いスナップショットで上書きしないため。
      const fresh = await window.autoinstall.getSettings()
      const saved = await window.autoinstall.saveSettings(update(fresh))
      set({ settings: saved, locale: saved.locale })
      void get().regenerate()
    })
    await settingsChain
  },

  async loadProfileFromDisk() {
    const loaded = await window.autoinstall.loadProfile()
    if (!loaded) return
    set({
      profile: loaded.profile,
      // ファイルから開いたものはライブラリの特定の項目には紐づかない
      currentProfileId: null,
      dirty: true,
      profileNotes: loaded.notes,
      passwordDraft: '',
      passwordConfirmDraft: '',
    })
    void get().regenerate()
  },

  async refreshProfiles() {
    set({ profiles: await window.autoinstall.listProfiles() })
  },

  async saveCurrentProfile(name) {
    const { profile, currentProfileId } = get()
    // 名前を指定されたら「名前を付けて保存」、無ければ現在の項目に上書き
    const targetName = name ?? profile.meta.name
    const targetId = name !== undefined ? null : currentProfileId
    const saved = await window.autoinstall.saveNamedProfile(targetId, targetName, profile)
    set({
      currentProfileId: saved.id,
      dirty: false,
      profile: { ...profile, meta: { ...profile.meta, name: targetName } },
    })
    await get().refreshProfiles()
  },

  async openProfile(id) {
    const loaded = await window.autoinstall.loadNamedProfile(id)
    if (!loaded) return
    set({
      profile: loaded.profile,
      currentProfileId: id,
      dirty: false,
      profileNotes: loaded.notes,
      passwordDraft: '',
      passwordConfirmDraft: '',
    })
    void get().regenerate()
  },

  async removeProfile(id) {
    await window.autoinstall.deleteNamedProfile(id)
    if (get().currentProfileId === id) set({ currentProfileId: null, dirty: true })
    await get().refreshProfiles()
  },

  async duplicateProfile(id, newName) {
    await window.autoinstall.duplicateNamedProfile(id, newName)
    await get().refreshProfiles()
  },

  newProfile() {
    set({
      profile: createDefaultProfile(
        get().iso?.identity.series ?? '24.04',
        'autoinstall-ui/0.1.0',
        new Date().toISOString(),
      ),
      currentProfileId: null,
      dirty: false,
      profileNotes: [],
      passwordDraft: '',
      passwordConfirmDraft: '',
    })
    void get().regenerate()
  },

  dismissProfileNotes() {
    set({ profileNotes: [] })
  },

  async setLocale(locale) {
    set({ locale })
    await get().saveSettings((s) => ({ ...s, locale }))
  },
}))
