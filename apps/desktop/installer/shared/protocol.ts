// インストーラの main ⇄ renderer の**唯一の契約**。
//
// アプリ本体の `packages/shared/src/ipc` と同じ考え方で、ここに書いた型だけを
// preload が `window.installer` として renderer へ渡す。
// **renderer から来た値は信用しない**（アプリ本体の規約と同じ）。
// インストール先のパスは renderer が自由に入力できるので、
// main 側で必ず検証してから使う（`validateInstallDir`）。

import type { Locale } from './locales.js'

/** 画面の段。`rail` の並びと 1 対 1。 */
export type StepId = 'welcome' | 'options' | 'progress' | 'done'

export const STEPS: readonly StepId[] = ['welcome', 'options', 'progress', 'done']

/** インストールの設定。renderer が組み立てて main へ渡す。 */
export interface InstallOptions {
  /** 展開先。既定は `%LOCALAPPDATA%\Programs\<productName>` */
  readonly installDir: string
  readonly desktopShortcut: boolean
  readonly startMenuShortcut: boolean
  /** 完了後にアプリを起動する */
  readonly launchAfter: boolean
}

/** インストールの進み具合。main が一方向に流す。 */
export interface InstallProgress {
  /** 0..1。展開の割合。`null` は「まだ割合が出せない」 */
  readonly ratio: number | null
  /** 画面に出す一行。**辞書のキー**で運ぶ（文言を main に持たせない） */
  readonly phase: ProgressPhase
  /** 展開したファイル数（分かるとき） */
  readonly files?: number
}

export type ProgressPhase =
  | 'preparing'
  | 'extracting'
  | 'shortcuts'
  | 'registering'
  | 'cleaning'
  | 'finished'

/** インストールの結末。 */
export type InstallResult =
  | { readonly kind: 'ok'; readonly installDir: string; readonly exePath: string }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'failed'
      readonly reason: FailureReason
      readonly detail: string
      /**
       * 片付け（rollback）を実際に走らせたか。
       * **画面の文言がこれで変わる。** 展開前に断った失敗
       * （payload が無い・インストール先が不正）では 1 バイトも置いていないので、
       * 「置いたファイルは削除しました」と書くと嘘になる。
       */
      readonly rolledBack: boolean
    }

/**
 * 失敗の理由。**総称に潰さない**（落とし穴 77）。
 * 画面はこの判別子から 1 対 1 で文言を引く。
 */
export type FailureReason =
  | 'no-space'
  | 'dir-not-writable'
  | 'dir-invalid'
  | 'payload-missing'
  | 'extract-failed'
  | 'shortcut-failed'
  | 'registry-failed'
  | 'unknown'

/** インストール先の検証結果。入力するたびに main へ問い合わせる。 */
export interface DirCheck {
  readonly ok: boolean
  /** 使えない理由。`ok` のときは `null` */
  readonly reason: DirProblem | null
  /** そこに既にインストールされているか（＝上書きになる） */
  readonly existing: boolean
  /** 空き容量（バイト）。取れないときは `null` */
  readonly freeBytes: number | null
  /** 必要な容量（バイト） */
  readonly needBytes: number
}

export type DirProblem =
  | 'empty'
  | 'not-absolute'
  | 'has-quote'
  | 'not-writable'
  | 'no-space'
  | 'is-file'

/** 起動時に main が渡す、変わらない情報。 */
export interface InstallerInfo {
  readonly productName: string
  readonly version: string
  /** Windows のログオン名。「このユーザーにだけ入る」ことを画面で示すのに使う。 */
  readonly userName: string
  readonly defaultInstallDir: string
  /** 展開後に必要な容量（バイト） */
  readonly needBytes: number
  /** アンインストール用に起動されたか */
  readonly uninstallMode: boolean
  /** 既にインストールされている場所（あれば） */
  readonly installedAt: string | null
}

/** `window.installer` の形。**preload はこれ以外を渡さない。** */
export interface InstallerBridge {
  info(): Promise<InstallerInfo>
  /** フォルダ選択ダイアログ。選ばれなければ `null` */
  chooseDir(current: string): Promise<string | null>
  checkDir(dir: string): Promise<DirCheck>
  start(options: InstallOptions): Promise<InstallResult>
  /** 展開中の中止。**途中まで置いたものは main が片付ける。** */
  cancel(): Promise<void>
  uninstall(): Promise<InstallResult>
  onProgress(handler: (p: InstallProgress) => void): () => void
  /** 完了画面から本体を起動して閉じる */
  launchAndExit(exePath: string): Promise<void>
  close(): Promise<void>
  minimize(): Promise<void>
  /** 表示言語。アプリ本体と同じ集合（locales.ts）。 */
  locale(): Promise<Locale>
}

/** IPC のチャンネル名。**文字列を散らさない。** */
export const CHANNEL = {
  info: 'installer:info',
  chooseDir: 'installer:choose-dir',
  checkDir: 'installer:check-dir',
  start: 'installer:start',
  cancel: 'installer:cancel',
  uninstall: 'installer:uninstall',
  progress: 'installer:progress',
  launchAndExit: 'installer:launch-and-exit',
  close: 'installer:close',
  minimize: 'installer:minimize',
  locale: 'installer:locale',
} as const
