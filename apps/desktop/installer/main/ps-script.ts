// PowerShell スクリプトの組み立てを 1 か所に集める。
//
// **なぜ 1 か所なのか**
//
// `powershell.exe -Command <str>` は、文字列に本物の改行が入っていない限り
// 全体を**1 論理行**として扱う。ここから 2 つの事故が起きる。
//
//   1. 行のどこかに `#` があると、**その行の残り全部**がコメントになる。
//      `['# 目印', '$dir = ...', 'for (...) { ... }'].join(' ')` は
//      「1 行まるごとコメント」に潰れ、PowerShell は何も実行せずに終了 0 を返す。
//      呼んだ側からは**成功に見える**。
//   2. 空白で並べた文だけでは区切られない。PowerShell は文の間に改行か `;` を要求する
//      （閉じ `}` だけは自分で終端する）。`;` を 1 つ忘れると
//      「終了コードが 0 でない」以外に何の手掛かりも無い解析エラーになる。
//
// なので **行の配列を改行で連結する**。`joinPowerShellScript()` がその唯一の入口で、
// 既知の地雷（空・非文字列・要素の中に改行）を投げて弾く。
// これは `ps-script.test.ts` が変異させて確かめている（落とし穴 57）。
//
// もう 1 つの規約: **値は必ず `psSingleQuote()` を通す**。
// インストール先は利用者が自由に入力できるので、素で埋めるとクォートを抜けられる
// （このリポジトリが 4 巡目の監査で実際に踏んだ形。落とし穴 46）。

export class PowerShellScriptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PowerShellScriptError'
  }
}

/**
 * 後片付けの常駐ポーラに埋める目印。
 * 書く側 (`buildSelfDeleteScript`) と探して殺す側
 * (`buildKillLeftoverCleanupScript`) が**同じ定数から導く**ので食い違わない。
 */
export const CLEANUP_POLL_MARKER = 'seedstick-cleanup-poll'

/**
 * アンインストール情報のレジストリキー。**HKCU**（このユーザーだけ）。
 * インストール先が `%LOCALAPPDATA%` なので、HKLM に書くと
 * 「他のユーザーのプログラムと機能に、そのユーザーからは消せない項目が出る」ことになる。
 */
export const UNINSTALL_REGISTRY_KEY =
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Seedstick'

/** PowerShell の単一引用符リテラルへ埋めるためのエスケープ。`'` を 2 つにするだけ。 */
export function psSingleQuote(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * 行の配列を `-Command` に渡せる 1 本のスクリプトにする。**必ず改行で連結する。**
 * 空白連結の事故（上のコメント）を二度と入れられないように、既知の地雷を投げて弾く。
 *
 * この戻り値を渡してよいのは `spawn` の引数配列（`['-Command', script]`）だけ。
 * `cmd.exe` 経由（`exec()`）に埋め込むと改行がクォートを壊すので、
 * そちら向けは 1 行の文字列として別に組む（`build*Command` の名前で区別する）。
 */
export function joinPowerShellScript(lines: readonly string[]): string {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PowerShellScriptError('empty PowerShell script')
  }
  for (const line of lines) {
    if (typeof line !== 'string') {
      throw new PowerShellScriptError(`non-string PowerShell line: ${String(line)}`)
    }
    if (/\r|\n/.test(line)) {
      throw new PowerShellScriptError(
        'PowerShell line contains an embedded newline ' +
          `(split it into separate array elements): ${JSON.stringify(line)}`,
      )
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// ショートカット
// ---------------------------------------------------------------------------

export function buildShortcutScript(
  linkPath: string,
  target: string,
  workingDir: string,
): string {
  const lp = psSingleQuote(linkPath)
  const t = psSingleQuote(target)
  const w = psSingleQuote(workingDir)
  return joinPowerShellScript([
    'try {',
    '  $wsh = New-Object -ComObject WScript.Shell',
    `  $s = $wsh.CreateShortcut('${lp}')`,
    `  $s.TargetPath = '${t}'`,
    `  $s.WorkingDirectory = '${w}'`,
    `  $s.IconLocation = '${t},0'`,
    '  $s.Save()',
    '} catch { Write-Error $_; exit 1 }',
  ])
}

export function buildMkdirScript(folder: string): string {
  return joinPowerShellScript([
    'try {',
    `  New-Item -ItemType Directory -Force -Path '${psSingleQuote(folder)}' | Out-Null`,
    '} catch { Write-Error $_; exit 1 }',
  ])
}

/**
 * ファイルを消す。**`-LiteralPath`** を使う。
 * インストール先の名前に `[` `]` `*` `?` が入っていると、
 * `-Path` はワイルドカードとして展開してしまう（＝別のものを消しうる）。
 */
export function buildDeleteFileScript(path: string): string {
  return joinPowerShellScript([
    `Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath '${psSingleQuote(path)}'`,
  ])
}

export function buildDeleteFolderScript(folder: string): string {
  return joinPowerShellScript([
    `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath '${psSingleQuote(folder)}'`,
  ])
}

// ---------------------------------------------------------------------------
// プログラムと機能（アンインストール情報）
// ---------------------------------------------------------------------------

export interface UninstallEntryFields {
  readonly productName: string
  readonly version: string
  readonly publisher: string
  readonly installDir: string
  /** 「プログラムと機能」から起動されるコマンド行。`uninstallCommandFor()` が作る。 */
  readonly uninstallCommand: string
  readonly iconPath: string
}

export function buildWriteUninstallEntryScript(f: UninstallEntryFields): string {
  const key = UNINSTALL_REGISTRY_KEY
  const name = psSingleQuote(f.productName)
  const version = psSingleQuote(f.version)
  const publisher = psSingleQuote(f.publisher)
  const icon = psSingleQuote(f.iconPath)
  const dir = psSingleQuote(f.installDir)
  const command = psSingleQuote(f.uninstallCommand)
  return joinPowerShellScript([
    `New-Item -Path '${key}' -Force | Out-Null`,
    `Set-ItemProperty -Path '${key}' -Name 'DisplayName' -Value '${name}'`,
    `Set-ItemProperty -Path '${key}' -Name 'DisplayVersion' -Value '${version}'`,
    `Set-ItemProperty -Path '${key}' -Name 'Publisher' -Value '${publisher}'`,
    `Set-ItemProperty -Path '${key}' -Name 'DisplayIcon' -Value '${icon}'`,
    `Set-ItemProperty -Path '${key}' -Name 'InstallLocation' -Value '${dir}'`,
    `Set-ItemProperty -Path '${key}' -Name 'UninstallString' -Value '${command}'`,
    `Set-ItemProperty -Path '${key}' -Name 'QuietUninstallString' -Value '${command}'`,
    `Set-ItemProperty -Path '${key}' -Name 'NoModify' -Value 1 -Type DWord`,
    `Set-ItemProperty -Path '${key}' -Name 'NoRepair' -Value 1 -Type DWord`,
    // 「プログラムと機能」のサイズ欄。取れなくてもインストールは成功なので握り潰す。
    `try { $size = (Get-ChildItem -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath '${dir}' | Measure-Object -Sum Length).Sum; if ($size) { Set-ItemProperty -Path '${key}' -Name 'EstimatedSize' -Value ([int]([math]::Round($size / 1024))) -Type DWord } } catch {}`,
  ])
}

export function buildDeleteUninstallEntryScript(): string {
  return joinPowerShellScript([
    `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath '${UNINSTALL_REGISTRY_KEY}'`,
  ])
}

/**
 * 既存インストールの 1 項目を読む。**`exec()`（cmd.exe）に渡す 1 行**なので
 * 改行を入れてはいけない。`field` は呼び出し側の定数だけ。
 */
export function buildReadUninstallFieldCommand(field: string): string {
  return `(Get-ItemProperty -Path '${UNINSTALL_REGISTRY_KEY}' -ErrorAction SilentlyContinue).${field}`
}

// ---------------------------------------------------------------------------
// 後始末（アンインストールの自己削除）
// ---------------------------------------------------------------------------

/**
 * インストール先に置く `uninstall.ps1` の中身。
 *
 * 「プログラムと機能」からはこれが直接呼ばれる（`uninstallCommandFor()`）。
 * **Setup.exe を複製しない**理由は `paths.ts` の `UNINSTALL_SCRIPT_NAME`。
 *
 * `-File` で走らせた `.ps1` は**自分の入っているフォルダごと削除できる**
 * （PowerShell は読み終えたら掴み続けない。実測で確認）。
 * ただし現在のディレクトリがその中だと削除できないので、先に `%TEMP%` へ移る。
 *
 * **消すのはこのインストーラが置いたものだけ。**
 * 作った USB も、保存したプロファイル JSON も、アプリの設定 (`%APPDATA%`) も残す。
 */
export function buildUninstallScriptFile(opts: {
  readonly installDir: string
  readonly desktopLink: string
  readonly startMenuLink: string
}): string {
  const dir = psSingleQuote(opts.installDir)
  const desktop = psSingleQuote(opts.desktopLink)
  const startMenu = psSingleQuote(opts.startMenuLink)
  return joinPowerShellScript([
    '# Seedstick - uninstall',
    `$dir = '${dir}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath '${desktop}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath '${startMenu}'`,
    `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath '${UNINSTALL_REGISTRY_KEY}'`,
    // 現在のディレクトリが $dir の中だと、そのフォルダは削除できない。
    'Set-Location $env:TEMP',
    // アプリが動いていると数秒つかまれる。30 回 x 400ms（約 12 秒）まで待つ。
    'for ($i = 0; $i -lt 30; $i++) {',
    '  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $dir',
    '  if (-not (Test-Path -LiteralPath $dir)) { break }',
    '  Start-Sleep -Milliseconds 400',
    '}',
    'if (-not (Test-Path -LiteralPath $dir)) { exit 0 }',
    // **「ファイルが残った」と「空のフォルダだけ残った」を分ける。**
    //
    // 中身を全部消せたのにフォルダだけ残るのは、別のプロセスが
    // そのディレクトリのハンドルを持っているとき（実測: 前のセッションで
    // 起動しっぱなしだった別のインストーラが掴んでいた）。
    // アンインストール自体は済んでいるので、これを「失敗」と報告すると
    // 管理ツールに嘘をつくことになる。空フォルダは終了コード 0 で伝える。
    '$left = @(Get-ChildItem -Force -ErrorAction SilentlyContinue -LiteralPath $dir)',
    'if ($left.Count -gt 0) {',
    '  Write-Error "could not remove $($left.Count) item(s) under $dir"',
    '  exit 1',
    '}',
    'exit 0',
  ])
}

/** 「プログラムと機能」に登録するコマンド行。**二重引用符はここだけで使う。** */
export function uninstallCommandFor(scriptPath: string): string {
  // レジストリの値は CreateProcess にそのまま渡るので、
  // 空白を含むパスは二重引用符で括る。パス自体に `"` は入れない
  // （`install-dir.ts` が引用符入りのインストール先を断っている）。
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`
}

/**
 * 自分自身が入っているフォルダを、自分が終わってから消すためのポーラ。
 *
 * インストーラの UI からアンインストールしたときに使う。そちらは
 * インストール先の外（`%TEMP%` に自己展開した Setup.exe）から動くので
 * フォルダは掴んでいないが、**アプリ本体が起動中**だと消せないことがある。
 * 切り離した PowerShell に 2 秒おきの削除を 30 回（約 60 秒）まで試させる。
 *
 * 先頭の `# 目印` は**その行だけ**のコメント（改行連結だから成立する）。
 * `Win32_Process.CommandLine` に残るので、次のインストール時に
 * 居残ったポーラを見つけて殺せる。
 */
export function buildSelfDeleteScript(installDir: string): string {
  const dir = psSingleQuote(installDir)
  return joinPowerShellScript([
    `# ${CLEANUP_POLL_MARKER}`,
    `$dir = '${dir}'`,
    'for ($i = 0; $i -lt 30; $i++) {',
    '  Start-Sleep -Seconds 2',
    '  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $dir',
    '  if (-not (Test-Path -LiteralPath $dir)) { break }',
    '}',
  ])
}

export function selfDeleteSpawnArgs(script: string): string[] {
  return ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script]
}

/** 前回のアンインストールが残したポーラを探して殺す。目印は上と同じ定数から。 */
export function buildKillLeftoverCleanupScript(): string {
  return joinPowerShellScript([
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |`,
    `  Where-Object { $_.CommandLine -and $_.CommandLine -like '*${CLEANUP_POLL_MARKER}*' } |`,
    '  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }',
  ])
}

// ---------------------------------------------------------------------------
// 起動中のアプリの検出
// ---------------------------------------------------------------------------

/**
 * インストール先の下から動いているプロセス名を返す。
 * **`exec()`（cmd.exe）に渡す 1 行**なので改行を入れてはいけない。
 */
export function buildDetectRunningInstanceCommand(installDir: string): string {
  const dir = psSingleQuote(installDir)
  return (
    'Get-Process -ErrorAction SilentlyContinue | ' +
    "Where-Object { $_.Path -and $_.Path.StartsWith(" +
    `'${dir}', [StringComparison]::OrdinalIgnoreCase) } | ` +
    'Select-Object -ExpandProperty Name | ' +
    'Sort-Object -Unique'
  )
}
