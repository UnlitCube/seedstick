import { create } from 'zustand'
import {
  createDefaultProfile,
  LOCALE_META,
  localized,
  negotiateLocale,
  type AppSettings,
  type ChecksumResult,
  type AutoinstallProfile,
  type DeviceInfo,
  type GeneratedConfig,
  type ImageTarget,
  type IsoFileInfo,
  type Locale,
  type LocalizedText,
  type MsgKey,
  type ProfileSummary,
  type WriteStatus,
} from '@autoinstall/shared'

// アプリ全体の状態。ステップを移動しても入力が消えないよう 1 つのストアに集約する。

/**
 * ISO を受け付けなかった理由。
 *
 * `text` は訳す総括文（main は利用者の言語を知らないのでキーのまま運ばれる）、
 * `detail` は開発者向けの生の詳細（壊れた ISO の内部構造など。訳さず等幅で出す）。
 * かつてはここが `string` 1 本で、`IsoOpenResult.detail` をそのまま入れていた。
 * `detail` が「詳細」の意味に変わったあともそのままだと、通常の拒否は
 * `detail: null` なので**本文が空の Callout** が出る（型は通る）。
 */
export interface IsoRejection {
  readonly text: LocalizedText
  readonly detail: string | null
}

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

/** サイドバーの見出し。`Record<StepId, MsgKey>` なのでステップを足すと型で気づく。 */
export const STEP_LABELS: Record<StepId, MsgKey> = {
  iso: 'step.iso',
  basics: 'step.basics',
  user: 'step.user',
  network: 'step.network',
  storage: 'step.storage',
  runtime: 'step.runtime',
  software: 'step.software',
  postinstall: 'step.postinstall',
  review: 'step.review',
  write: 'step.write',
}

/**
 * サイドバーのグループ。
 *
 * 基準は「subiquity か Ubuntu Desktop / Windows の GUI インストーラを一度でも
 * 通したことがある人」。その人が**知っている概念だけで最後まで行ける道**を
 * 上のグループに置き、それを超えるものを下へ送る。
 *
 * - `required` … インストーラが必ず聞く。飛ばせない
 * - `optional` … インストーラも聞くが、既定のまま通せる
 * - `extra`    … インストーラには無い。既定は何もしない
 * - `finish`   … 確認と書き込み
 */
export interface StepGroup {
  readonly id: 'required' | 'optional' | 'extra' | 'finish'
  readonly title: MsgKey
  readonly hint: MsgKey
  readonly steps: readonly StepId[]
}

export const STEP_GROUPS: readonly StepGroup[] = [
  {
    id: 'required',
    title: 'nav.groupRequired',
    hint: 'nav.groupRequiredHint',
    steps: ['iso', 'basics', 'user'],
  },
  {
    id: 'optional',
    title: 'nav.groupOptional',
    hint: 'nav.groupOptionalHint',
    steps: ['network', 'storage', 'software'],
  },
  {
    id: 'extra',
    title: 'nav.groupExtra',
    hint: 'nav.groupExtraHint',
    // `runtime`（起動メニューで値を差し替える）はこのアプリで最も上級の概念なので、
    // `software` / `postinstall` より後ろに置く。以前は 6 番目にあった。
    steps: ['postinstall', 'runtime'],
  },
  {
    id: 'finish',
    title: 'nav.groupFinish',
    hint: 'nav.groupFinishHint',
    steps: ['review', 'write'],
  },
]

/**
 * ステップの順序。**グループから導く**（2 つ並べると必ず食い違う）。
 * 番号は全体の通し番号のままにする（グループごとに 1 から振り直さない）。
 */
export const STEP_ORDER: readonly StepId[] = STEP_GROUPS.flatMap((g) => [...g.steps])

interface AppState {
  ready: boolean
  locale: Locale
  settings: AppSettings | null
  step: StepId
  profile: AutoinstallProfile
  iso: IsoFileInfo | null
  isoError: IsoRejection | null
  isoBusy: boolean
  checksum: ChecksumResult | null
  checksumProgress: { bytesDone: number; bytesTotal: number } | null
  config: GeneratedConfig | null
  configBusy: boolean
  devices: DeviceInfo[]
  devicesBusy: boolean
  selectedDeviceId: string | null
  writeStatus: WriteStatus
  /**
   * 直近の書き出し先（`.img`）。**デバイスへ書いているときは必ず null**。
   *
   * `WriteStatus` はデバイスとイメージで同じチャネルを流れるが、
   * `cancelled` は `state` しか持たないので、どちらを止めたのかが status からは分からない。
   * 「USB メモリの内容は壊れています」を `.img` の中止に出すと嘘になる
   * （main は書きかけのファイルを消している）ので、どちらの経路だったかをここで覚える。
   */
  imageTarget: ImageTarget | null
  /** 平文パスワードはここにだけ置く。保存もログ出力もしない。 */
  passwordDraft: string
  passwordConfirmDraft: string
  /** 保存済みプロファイルの一覧 */
  profiles: ProfileSummary[]
  /** 今開いているプロファイルの ID。未保存なら null。 */
  currentProfileId: string | null
  /** 最後の保存以降に変更があったか */
  dirty: boolean
  /**
   * プロファイル読み込み時の注意（古い形式の移行など）。
   * **訳す前**のまま持つ（描画するときに `useTl` で訳す）。
   */
  profileNotes: LocalizedText[]
  /**
   * **プロファイルが丸ごと差し替わった回数**。
   *
   * 画面の中には「開いた時点の設定」から初期値を決めるものがある
   * （`Disclosure` の開閉が代表。既定から変わっていれば開いて出す）。
   * これは state なので、`profile` を差し替えても勝手には作り直されない。
   * ステップを移動すれば `App` の `key` で作り直されるが、
   * **同じステップに居たままプロファイルを開く**と作り直されず、
   * 別のプロファイルの設定が折りたたみの中に隠れる。
   *
   * だから差し替えの回数を数えて `key` に混ぜる。増やすのは
   * **プロファイルを丸ごと入れ替える 3 か所だけ**
   * （`openProfile` / `loadProfileFromDisk` / `newProfile`）。
   * `updateProfile` や `saveCurrentProfile` で増やしてはいけない。
   * 増やすと 1 文字打つたびに画面が作り直され、入力途中の下書き
   * （`useListDraft`）が消える。
   */
  profileGeneration: number

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
  /**
   * 保存先を選んでから `.img` への書き出しを始める。
   * ダイアログでキャンセルされたら何もしない（`false` を返す）。
   */
  saveAsImage(): Promise<boolean>
  cancelWrite(): Promise<void>
  /** 書き込み結果を消して、もう一本作れる状態に戻す */
  resetWrite(): void
  saveSettings(update: (s: AppSettings) => AppSettings): Promise<void>
  loadProfileFromDisk(): Promise<void>
  /** 開いたプロファイルの series を、選択中の ISO に合わせる（内部用） */
  _alignSeriesToIso(loaded: { profile: AutoinstallProfile; notes: LocalizedText[] }): {
    profile: AutoinstallProfile
    notes: LocalizedText[]
  }
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

/**
 * `<html lang>` を画面の言語に合わせる。index.html の既定は固定なので、
 * 切り替えるたびにここで直す（漢字の字形・読み上げ・ハイフネーションが lang で変わる）。
 */
function applyDocumentLang(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = LOCALE_META[locale].htmlLang
}

/** 設定が届く前の言語。OS の好みの並びから選ぶ（設定が届けばそちらに替わる）。 */
function initialLocale(): Locale {
  return negotiateLocale(typeof navigator === 'undefined' ? [] : [...navigator.languages])
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  locale: initialLocale(),
  settings: null,
  step: 'iso',
  profile: createDefaultProfile('24.04', 'seedstick/0.1.0', new Date().toISOString()),
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
  imageTarget: null,
  passwordDraft: '',
  passwordConfirmDraft: '',
  profiles: [],
  currentProfileId: null,
  dirty: false,
  profileNotes: [],
  profileGeneration: 0,

  async init() {
    const settings = await window.autoinstall.getSettings()
    const locale = settings.locale ?? negotiateLocale([window.autoinstall.systemLocale])
    applyDocumentLang(locale)
    set({ settings, locale, ready: true })
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
        set({ isoError: { text: result.text, detail: result.detail }, iso: null })
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
        set({ isoError: { text: result.text, detail: result.detail }, iso: null })
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
    // これはデバイスへの書き込み。前回の `.img` の保存先を残したままにすると、
    // 中止したときに「イメージファイルを削除しました」と嘘を出す。
    set({ imageTarget: null })
    const result = await window.autoinstall.startWrite({
      isoPath: iso.path,
      deviceId: selectedDeviceId,
      profile,
      verify: settings.verifyAfterWrite,
      cidataSizeBytes: settings.cidataSizeBytes,
      auditRecord: settings.auditRecord,
    })
    if (!result.started) {
      // 文言は訳さずキーのまま state に置く。訳すのは描画するときで、
      // そうしないと表示中に言語を切り替えても、この一文だけ古い言語のまま残る。
      set({
        writeStatus: {
          state: 'error',
          message: result.message ?? localized('store.writeStartFailed'),
          detail: result.detail ?? null,
        },
      })
    }
  },

  /**
   * `.img` として書き出す。
   *
   * デバイスへの書き込みと違い**権限昇格が起きない**ので、USB を挿していなくても
   * ここまで来られる。保存先は main の保存ダイアログだけが決める
   * （renderer が組み立てたパスは main が受け付けない。落とし穴 55）。
   */
  async saveAsImage() {
    const { iso, profile, settings } = get()
    if (!iso || !settings) return false
    // 既定のファイル名の希望。**安全な名前に直すのは main の仕事**
    // （`suggestImageFileName` がパス区切りも予約名も落とす）。
    const target = await window.autoinstall.chooseImagePath(profile.basics.hostname)
    if (!target) return false
    set({ imageTarget: target })
    const result = await window.autoinstall.startImageWrite({
      isoPath: iso.path,
      imagePath: target.path,
      profile,
      verify: settings.verifyAfterWrite,
      cidataSizeBytes: settings.cidataSizeBytes,
      auditRecord: settings.auditRecord,
    })
    if (!result.started) {
      // `startWrite` と同じ扱い。訳さずキーのまま置く。
      set({
        writeStatus: {
          state: 'error',
          message: result.message ?? localized('store.writeStartFailed'),
          detail: result.detail ?? null,
        },
      })
      return false
    }
    return true
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
    set({ writeStatus: { state: 'idle' }, imageTarget: null })
    void get().refreshDevices()
  },

  async saveSettings(update) {
    // **チェーンに catch を付ける。**
    // 付けないと、1 回でも失敗した時点で settingsChain は rejected のまま残り、
    // 以後の .then(cb) は cb を実行せず reject を伝えるだけになる。
    // 「それ以降どの設定も無言で保存されない」状態になり、
    // 利用者は保存できていないことに気づけない。
    const step = settingsChain.then(async () => {
      // 保存直前に最新を取り直す。古いスナップショットで上書きしないため。
      const fresh = await window.autoinstall.getSettings()
      const saved = await window.autoinstall.saveSettings(update(fresh))
      set({ settings: saved, locale: saved.locale })
      void get().regenerate()
    })
    // 次の保存が続けられるよう、チェーン自体は必ず解決させる
    settingsChain = step.catch(() => undefined)
    await step
  },

  /**
   * 開いたプロファイルを、選択中の ISO のバージョンに合わせる。
   *
   * プロファイルには保存時の `series` が入っている。24.04 の ISO を選んだまま
   * 22.04 で保存したプロファイルを開くと、**ISO と無関係に 22.04 向けの YAML** が
   * できあがる（対応キーの出し分けが変わる）。検証もプロファイルの series を
   * 基準にするので「問題なし」と表示され、そのまま書き込めてしまう。
   * ISO を選んでいるなら、そちらが正。合わせたことは画面で伝える。
   */
  _alignSeriesToIso(loaded: { profile: AutoinstallProfile; notes: LocalizedText[] }): {
    profile: AutoinstallProfile
    notes: LocalizedText[]
  } {
    const iso = get().iso
    if (!iso || iso.identity.series === loaded.profile.series) return loaded
    return {
      profile: { ...loaded.profile, series: iso.identity.series },
      notes: [
        ...loaded.notes,
        // **ここで訳さない。** 訳すのは描画するとき（`startWrite` と同じ方針）。
        // 訳した文字列を state に置くと、表示中に言語を切り替えても
        // この一文だけ古い言語のまま残る。移行の notes と混在させると、
        // 同じ箇条書きの中で英語と日本語が混ざる。
        localized('store.seriesAligned', {
          savedSeries: loaded.profile.series,
          isoSeries: iso.identity.series,
        }),
      ],
    }
  },

  async loadProfileFromDisk() {
    const raw = await window.autoinstall.loadProfile()
    if (!raw) return
    const loaded = get()._alignSeriesToIso({ profile: raw.profile, notes: [...raw.notes] })
    set({
      profile: loaded.profile,
      // ファイルから開いたものはライブラリの特定の項目には紐づかない
      currentProfileId: null,
      dirty: true,
      profileNotes: loaded.notes,
      passwordDraft: '',
      passwordConfirmDraft: '',
      profileGeneration: get().profileGeneration + 1,
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
    const raw = await window.autoinstall.loadNamedProfile(id)
    if (!raw) return
    const loaded = get()._alignSeriesToIso({ profile: raw.profile, notes: [...raw.notes] })
    set({
      profile: loaded.profile,
      currentProfileId: id,
      // series を合わせたなら保存済みの内容と違うので、未保存の変更として扱う
      dirty: loaded.profile.series !== raw.profile.series,
      profileNotes: loaded.notes,
      passwordDraft: '',
      passwordConfirmDraft: '',
      profileGeneration: get().profileGeneration + 1,
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
        'seedstick/0.1.0',
        new Date().toISOString(),
      ),
      currentProfileId: null,
      dirty: false,
      profileNotes: [],
      passwordDraft: '',
      passwordConfirmDraft: '',
      profileGeneration: get().profileGeneration + 1,
    })
    void get().regenerate()
  },

  dismissProfileNotes() {
    set({ profileNotes: [] })
  },

  async setLocale(locale) {
    applyDocumentLang(locale)
    set({ locale })
    await get().saveSettings((s) => ({ ...s, locale }))
  },
}))
