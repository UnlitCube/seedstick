// インストーラの文言。**ja が原文、en は `satisfies` でキー整合を型に守らせる。**
//
// アプリ本体の `packages/shared/src/i18n` と同じ考え方だが、辞書は**共有しない**。
// インストーラはアプリのコードを 1 行も読み込まない（読み込むと payload と
// インストーラの両方に同じものが入る）ので、辞書も独立させる。
//
// **画面に出る文言をコードへ直書きしない。** main も同じで、進捗は
// `ProgressPhase` の判別子で運び、訳すのは renderer だけ（落とし穴 78）。
// この規約が守られていることは `labels.test.ts` が機械で数える。

// **型だけ**を import する。.e2e のスクリプトは Node の型除去でこのファイルを直接読むので、
// 実行時の import（'./locales.js'）があると解決できずに落ちる。
import type { Locale } from './locales.js'

export type { Locale }

/** locales.ts の FALLBACK_LOCALE と同じ値（上の理由で import しない）。 */
const FALLBACK: Locale = 'en'

/** 差し込み。数と名前は ja / en で一致していること（テストが数える）。 */
export type Params = Readonly<Record<string, string | number>>

const ja = {
  'common.loading': '起動しています…',
  'common.cancel': 'キャンセル',
  'common.back': '戻る',
  'common.close': '閉じる',
  'common.minimize': '最小化',

  'app.setup': 'セットアップ',
  'app.uninstall': 'アンインストール',

  'rail.welcome': 'ようこそ',
  'rail.options': 'インストール設定',
  'rail.progress': 'インストール',
  'rail.done': '完了',
  'rail.uninstallConfirm': '確認',
  'rail.uninstallProgress': '削除',
  'rail.uninstallDone': '完了',

  'welcome.title': 'Seedstick',
  'welcome.tagline': 'Ubuntu Server の無人インストール USB を、ISO を再構築せずに作る',
  'welcome.version': 'バージョン {version}',
  'welcome.upgrade': '{version} が既にインストールされています。上書きして更新します。',
  'welcome.f1.title': 'ISO はそのまま',
  'welcome.f1.body':
    '数セクタのインプレース改変と CIDATA パーティションの追加だけで、元の ISO ファイルには触れません。',
  'welcome.f2.title': '危険なディスクは出さない',
  'welcome.f2.body':
    'システムディスク・内蔵ディスク・2 TB 超は、列挙の時点で候補から外します。',
  'welcome.f3.title': '書き込みだけを昇格する',
  'welcome.f3.body':
    '本体は通常権限のまま。USB へ書く子プロセスだけが管理者権限で動きます。',
  'welcome.next': 'はじめる',
  'welcome.uninstall': 'アンインストール',

  'options.title': 'インストール設定',
  'options.lead': 'インストール先とショートカットを確認してください。',
  'options.dir': 'インストール先',
  'options.browse': '参照…',
  'options.shortcuts': 'ショートカット',
  'options.desktop': 'デスクトップに作る',
  'options.startMenu': 'スタートメニューに登録する',
  'options.launchAfter': 'インストール後にアプリを起動する',
  'options.perUser':
    'このユーザー ({user}) にだけインストールします。管理者権限は必要ありません。',
  'options.need': '必要な容量 {size}',
  'options.free': '空き {size}',
  'options.freeUnknown': '空き容量を取得できませんでした',
  'options.existing': 'ここには既にインストールされています。中身を入れ替えます。',
  'options.install': 'インストール',
  'options.update': '更新する',

  'dir.empty': 'インストール先を入力してください。',
  'dir.not-absolute': '絶対パスで指定してください。',
  'dir.has-quote': 'パスに引用符は使えません。',
  'dir.not-writable': 'この場所には書き込めません。別のフォルダを選んでください。',
  'dir.no-space': '空き容量が足りません。',
  'dir.is-file': '同じ名前のファイルがあります。別のフォルダを選んでください。',

  'progress.title': 'インストールしています',
  'progress.lead': 'ウィンドウを閉じずにお待ちください。',
  'progress.cancel': '中止',
  'progress.confirm.title': 'インストールを中止しますか？',
  'progress.confirm.body': '途中まで置いたファイルは削除して、元の状態に戻します。',
  'progress.confirm.ok': '中止する',
  'progress.confirm.no': '続ける',
  'progress.files': '{count} 個のファイルを展開しました',

  'phase.preparing': 'インストール先を準備しています…',
  'phase.extracting': 'ファイルを展開しています…',
  'phase.shortcuts': 'ショートカットを作成しています…',
  'phase.registering': 'アンインストール情報を登録しています…',
  'phase.cleaning': '元に戻しています…',
  'phase.finished': '完了しました',

  'done.ok.title': 'インストールが完了しました',
  'done.ok.lead': 'ISO を選ぶところから始められます。',
  'done.ok.where': 'インストール先',
  'done.launch': 'アプリを起動',
  'done.cancelled.title': 'インストールを中止しました',
  'done.cancelled.lead': '置いたファイルは削除しました。もう一度実行できます。',
  'done.failed.title': 'インストールできませんでした',
  'done.failed.lead': '置いたファイルは削除しました。理由は次のとおりです。',
  'done.failedNoChange.lead': 'このコンピューターには何も書き込んでいません。理由は次のとおりです。',
  'done.detail': '詳細',

  'fail.no-space': 'インストール先の空き容量が足りません。',
  'fail.dir-not-writable': 'インストール先に書き込めませんでした。',
  'fail.dir-invalid': 'インストール先の指定が正しくありません。',
  'fail.payload-missing':
    '展開するファイル (payload.7z) が見つかりません。配布用の Setup.exe から実行してください。',
  'fail.extract-failed': 'ファイルの展開に失敗しました。',
  'fail.shortcut-failed': 'ショートカットの作成に失敗しました。',
  'fail.registry-failed': 'アンインストール情報の登録に失敗しました。',
  'fail.unknown': '予期しないエラーが発生しました。',

  'uninstall.title': 'アンインストール',
  'uninstall.lead': '{product} をこのコンピューターから削除します。',
  'uninstall.where': '削除するフォルダ',
  'uninstall.keeps': '作成した USB と、保存したプロファイル JSON は削除しません。',
  'uninstall.run': '削除する',
  'uninstall.progress.title': '削除しています',
  'uninstall.done.title': 'アンインストールが完了しました',
  'uninstall.done.lead': 'ご利用ありがとうございました。',
  'uninstall.failed.title': 'アンインストールできませんでした',
} as const

export type LabelKey = keyof typeof ja

const en = {
  'common.loading': 'Starting…',
  'common.cancel': 'Cancel',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.minimize': 'Minimize',

  'app.setup': 'Setup',
  'app.uninstall': 'Uninstall',

  'rail.welcome': 'Welcome',
  'rail.options': 'Options',
  'rail.progress': 'Install',
  'rail.done': 'Done',
  'rail.uninstallConfirm': 'Confirm',
  'rail.uninstallProgress': 'Remove',
  'rail.uninstallDone': 'Done',

  'welcome.title': 'Seedstick',
  'welcome.tagline':
    'Build an unattended Ubuntu Server install USB without rebuilding the ISO',
  'welcome.version': 'Version {version}',
  'welcome.upgrade': '{version} is already installed. It will be replaced.',
  'welcome.f1.title': 'The ISO stays untouched',
  'welcome.f1.body':
    'A few sectors are patched in place and a CIDATA partition is appended — the ISO file itself is never modified.',
  'welcome.f2.title': 'Dangerous disks never show up',
  'welcome.f2.body':
    'System disks, internal disks and anything over 2 TB are ruled out while enumerating.',
  'welcome.f3.title': 'Only the write is elevated',
  'welcome.f3.body':
    'The app runs unprivileged; just the child process that writes the USB asks for administrator rights.',
  'welcome.next': 'Get started',
  'welcome.uninstall': 'Uninstall',

  'options.title': 'Install options',
  'options.lead': 'Check the destination and which shortcuts to create.',
  'options.dir': 'Destination folder',
  'options.browse': 'Browse…',
  'options.shortcuts': 'Shortcuts',
  'options.desktop': 'Create on the desktop',
  'options.startMenu': 'Add to the Start menu',
  'options.launchAfter': 'Launch the app when the install finishes',
  'options.perUser':
    'Installs for this user ({user}) only. No administrator rights are needed.',
  'options.need': 'Needs {size}',
  'options.free': '{size} free',
  'options.freeUnknown': 'Could not read the free space',
  'options.existing': 'Something is already installed here. Its contents will be replaced.',
  'options.install': 'Install',
  'options.update': 'Update',

  'dir.empty': 'Enter a destination folder.',
  'dir.not-absolute': 'Use an absolute path.',
  'dir.has-quote': 'Quotation marks are not allowed in the path.',
  'dir.not-writable': 'This location is not writable. Pick another folder.',
  'dir.no-space': 'Not enough free space.',
  'dir.is-file': 'A file with that name already exists. Pick another folder.',

  'progress.title': 'Installing',
  'progress.lead': 'Please leave this window open.',
  'progress.cancel': 'Stop',
  'progress.confirm.title': 'Stop the installation?',
  'progress.confirm.body':
    'Files written so far are deleted and everything is put back the way it was.',
  'progress.confirm.ok': 'Stop',
  'progress.confirm.no': 'Keep going',
  'progress.files': '{count} files extracted',

  'phase.preparing': 'Preparing the destination…',
  'phase.extracting': 'Extracting files…',
  'phase.shortcuts': 'Creating shortcuts…',
  'phase.registering': 'Registering the uninstall entry…',
  'phase.cleaning': 'Rolling back…',
  'phase.finished': 'Finished',

  'done.ok.title': 'Installation complete',
  'done.ok.lead': 'Start by picking an ISO.',
  'done.ok.where': 'Installed to',
  'done.launch': 'Launch the app',
  'done.cancelled.title': 'Installation stopped',
  'done.cancelled.lead': 'The files written so far were removed. You can run this again.',
  'done.failed.title': 'Installation failed',
  'done.failed.lead': 'The files written so far were removed. Here is why.',
  'done.failedNoChange.lead': 'Nothing was written to this computer. Here is why.',
  'done.detail': 'Details',

  'fail.no-space': 'There is not enough free space at the destination.',
  'fail.dir-not-writable': 'The destination folder is not writable.',
  'fail.dir-invalid': 'The destination folder is not valid.',
  'fail.payload-missing':
    'payload.7z was not found. Run the Setup.exe produced by a distribution build.',
  'fail.extract-failed': 'Extracting the files failed.',
  'fail.shortcut-failed': 'Creating the shortcuts failed.',
  'fail.registry-failed': 'Registering the uninstall entry failed.',
  'fail.unknown': 'An unexpected error occurred.',

  'uninstall.title': 'Uninstall',
  'uninstall.lead': 'Remove {product} from this computer.',
  'uninstall.where': 'Folder to remove',
  'uninstall.keeps': 'USB sticks you created and saved profile JSON files are left alone.',
  'uninstall.run': 'Remove',
  'uninstall.progress.title': 'Removing',
  'uninstall.done.title': 'Uninstall complete',
  'uninstall.done.lead': 'Thanks for using it.',
  'uninstall.failed.title': 'Uninstall failed',
} satisfies Record<LabelKey, string>

export const DICTIONARIES: Readonly<Record<Locale, Readonly<Record<LabelKey, string>>>> = {
  ja,
  en,
}

/** `{name}` を差し替える。**`params` が壊れていても投げない**（落とし穴 30 / 76）。 */
export function interpolate(text: string, params?: Params): string {
  if (params === null || typeof params !== 'object') return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = (params as Record<string, unknown>)[name]
    return value === undefined || value === null ? whole : String(value)
  })
}

export function createTranslator(locale: Locale) {
  // 訳が無ければ en（ja 以外の利用者に日本語を出さない）、それも無ければ原文の ja。
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[FALLBACK]
  return (key: LabelKey, params?: Params): string =>
    interpolate(dict[key] ?? DICTIONARIES[FALLBACK][key] ?? DICTIONARIES.ja[key] ?? key, params)
}

export type Translator = ReturnType<typeof createTranslator>
