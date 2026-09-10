// インストーラが触る場所を 1 か所で決める。
//
// パッケージ済みのインストーラでは、`payload.7z` と `7za.exe` は
// electron-builder の `extraResources` によって exe の隣の `resources/` に入る。
// 開発中（`electron-vite dev --config electron.vite.installer.config.ts`）は
// リポジトリの `apps/desktop/installer-resources/` を見る。
//
// **payload が無くても起動はする。** 画面だけを直したいときに
// 400 MB の payload を作り直させるのは無駄なので、`hasPayload: false` を返して
// インストールの実行だけを `payload-missing` で止める（落とし穴 61 の考え方：
// 使えない機能があっても、画面まで塞がない）。

import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PRODUCT_NAME = 'Autoinstall USB Creator'
/** 展開後に置かれる本体の exe 名。electron-builder の `productName` と一致させる。 */
export const APP_EXE_NAME = `${PRODUCT_NAME}.exe`
/**
 * インストール先に置くアンインストールの手順書。
 *
 * **Setup.exe を複製しない。** 複製は payload を抱えたまま 196 MB あり、
 * 398 MB のアプリに対して 50% の無駄になる（実測で合計 595 MB になった）。
 * 消すのに要るのはショートカット 2 つ・レジストリ 1 キー・フォルダ 1 つだけなので、
 * 1 KB の PowerShell で足りる。
 *
 * **`-File` で走らせた `.ps1` は自分の入っているフォルダごと削除できる**
 * （PowerShell はスクリプトを読み終えたら掴み続けない。実測で確認）。
 */
export const UNINSTALL_SCRIPT_NAME = 'uninstall.ps1'

export interface ResolvedAssets {
  readonly payloadArchive: string
  readonly sevenZ: string
  readonly iconPath: string
  /** payload の展開に必要な容量。`payload-meta.json` に**ビルド時の実測**が入る。 */
  readonly needBytes: number
  /** `build-installer.mjs` が作った配布物から動いているか。 */
  readonly hasPayload: boolean
}

/**
 * 必要な容量の控えの値。
 *
 * **配布物ではこれを使わない。** `build-installer.mjs` が展開後の実サイズを
 * 測って `payload-meta.json` に書き、`resolveAssets()` がそれを読む。
 * ここに数字を直書きして放置すると、本体が太ったときに
 * 「空き容量は足りている」と言いながら途中で失敗する。
 */
export const FALLBACK_NEED_BYTES = 512 * 1024 * 1024

/** `payload-meta.json` の `unpackedBytes`。読めなければ控えの値。 */
function readNeedBytes(dir: string): number {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, 'payload-meta.json'), 'utf8'))
    const value =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)['unpackedBytes']
        : undefined
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : FALLBACK_NEED_BYTES
  } catch {
    return FALLBACK_NEED_BYTES
  }
}

export function resolveAssets(): ResolvedAssets {
  const candidates = [
    // パッケージ済み: extraResources は app.asar の隣に置かれる。
    app.isPackaged ? process.resourcesPath : null,
    // ビルドスクリプトからの明示指定。
    process.env['INSTALLER_RESOURCES_DIR']
      ? resolve(process.env['INSTALLER_RESOURCES_DIR'])
      : null,
    // 開発時: apps/desktop/installer-resources/
    app.isPackaged ? null : resolve(__dirname, '../../../installer-resources'),
  ].filter((v): v is string => typeof v === 'string')

  for (const dir of candidates) {
    const archive = join(dir, 'payload.7z')
    if (existsSync(archive)) {
      return {
        payloadArchive: archive,
        sevenZ: join(dir, '7za.exe'),
        iconPath: join(dir, 'icon.ico'),
        needBytes: readNeedBytes(dir),
        hasPayload: true,
      }
    }
  }

  const fallback = candidates[0] ?? __dirname
  return {
    payloadArchive: join(fallback, 'payload.7z'),
    sevenZ: join(fallback, '7za.exe'),
    iconPath: join(fallback, 'icon.ico'),
    needBytes: FALLBACK_NEED_BYTES,
    hasPayload: false,
  }
}

/**
 * 既定のインストール先。**このユーザーだけ**に入れる。
 *
 * `Program Files` にすると管理者権限が要る。このアプリの設計は
 * 「本体は通常権限で動き、USB へ書く子プロセスだけを昇格する」なので、
 * インストーラだけが管理者を要求するのは筋が通らない
 * （そして未署名の exe に `requireAdministrator` を付けると
 * SmartScreen の警告が強くなる）。
 */
export function defaultInstallDir(): string {
  const localAppData =
    process.env['LOCALAPPDATA'] ??
    (process.env['USERPROFILE']
      ? join(process.env['USERPROFILE'], 'AppData', 'Local')
      : 'C:\\')
  return join(localAppData, 'Programs', PRODUCT_NAME)
}

/** スタートメニュー（このユーザー）。 */
export function startMenuDir(): string {
  const appData =
    process.env['APPDATA'] ??
    (process.env['USERPROFILE']
      ? join(process.env['USERPROFILE'], 'AppData', 'Roaming')
      : 'C:\\')
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
}

/**
 * このインストーラ自身の実体。
 *
 * portable ターゲットの exe は自己展開して `%TEMP%` から動くので、
 * `process.execPath` は一時ディレクトリを指す。**元の exe のパスは
 * `PORTABLE_EXECUTABLE_FILE` にしか無い**（アンインストーラの複製元になる）。
 */
export function selfExePath(): string {
  return process.env['PORTABLE_EXECUTABLE_FILE'] || process.execPath
}
