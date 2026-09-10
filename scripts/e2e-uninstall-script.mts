#!/usr/bin/env tsx
// 生成した `uninstall.ps1` を**本物の PowerShell で走らせて**確かめる。
//
//   npm run e2e:uninstall-script
//
// 文字列の検査（`ps-script.test.ts`）だけでは「PowerShell が解析できるか」も
// 「本当に消えるか」も分からない。`e2e:esp-mirror` が生成した late-command を
// 実際の `sh` で走らせているのと同じ考え方（落とし穴 115）。
//
// **本物のインストール先には触らない。** `%TEMP%` に作った砂場と、
// `HKCU:\Software\...\autoinstall-ui-e2e` という**このテスト専用のキー**だけを使う。
// 作ったものは最後に必ず消す（落とし穴 86）。
//
// Windows 以外ではスキップして正常終了する。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildUninstallScriptFile,
  uninstallCommandFor,
} from '../apps/desktop/installer/main/ps-script.js'

if (process.platform !== 'win32') {
  console.log('Windows 専用の検査なのでスキップします')
  process.exit(0)
}

const checks: { name: string; ok: boolean; detail?: string }[] = []
const check = (name: string, ok: boolean, detail?: string): void => {
  checks.push(detail === undefined ? { name, ok } : { name, ok, detail })
}

/** このテスト専用のレジストリキー。**本物 (`...\Uninstall\...`) には触らない。** */
const TEST_KEY = 'HKCU:\\Software\\autoinstall-ui-e2e'

function ps(script: string): { ok: boolean; out: string; code: number | null } {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  )
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`, code: r.status }
}

/**
 * `UninstallString` を **Windows と同じ層で**実行する。
 *
 * 「プログラムと機能」は登録された文字列を `CreateProcess` にそのまま渡す。
 * **`cmd.exe /c` を挟んではいけない** ——挟むと cmd が入れ子のクォートを畳んで
 * `-File '"C:\...\Autoinstall'` のように途中で割れ、
 * **実装は正しいのに検査だけが落ちる**（落とし穴 93 / 116）。
 * Node では `windowsVerbatimArguments` が「引数をそのまま渡す」を意味する。
 */
function runCommandLine(command: string): { code: number | null; out: string } {
  const m = /^(\S+)\s+([\s\S]*)$/.exec(command)
  if (m === null) throw new Error(`コマンド行を分解できません: ${command}`)
  const r = spawnSync(m[1] as string, [m[2] as string], {
    windowsVerbatimArguments: true,
    encoding: 'utf8',
    windowsHide: true,
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

const sandbox = mkdtempSync(join(tmpdir(), 'autoinstall-uninst-'))
const installDir = join(sandbox, 'Autoinstall USB Creator')
const desktopLink = join(sandbox, 'Desktop', 'Autoinstall USB Creator.lnk')
const startMenuLink = join(sandbox, 'StartMenu', 'Autoinstall USB Creator.lnk')

try {
  // --- 砂場を作る -----------------------------------------------------------
  mkdirSync(join(installDir, 'resources', 'samples'), { recursive: true })
  mkdirSync(join(sandbox, 'Desktop'), { recursive: true })
  mkdirSync(join(sandbox, 'StartMenu'), { recursive: true })
  writeFileSync(join(installDir, 'Autoinstall USB Creator.exe'), 'x')
  writeFileSync(join(installDir, 'resources', 'app.asar'), 'x')
  writeFileSync(join(installDir, 'resources', 'samples', 'ip-only.json'), '{}')
  writeFileSync(desktopLink, 'x')
  writeFileSync(startMenuLink, 'x')
  // 消してはいけないもの（インストール先の外）。
  const keepMe = join(sandbox, 'profiles', 'my-profile.json')
  mkdirSync(join(sandbox, 'profiles'), { recursive: true })
  writeFileSync(keepMe, '{}')

  ps(`New-Item -Path '${TEST_KEY}' -Force | Out-Null`)
  check('前準備: テスト用レジストリキーができた', ps(`Test-Path '${TEST_KEY}'`).out.trim() === 'True')

  // --- 生成して置く ---------------------------------------------------------
  // 本物と同じ関数で作るが、レジストリキーだけはテスト用に差し替える
  // （**本物のキーを消す検査は書かない**。走らせるたびに実際のインストールが壊れる）。
  const real = buildUninstallScriptFile({ installDir, desktopLink, startMenuLink })
  const script = real.replace(
    /HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Autoinstall USB Creator/,
    TEST_KEY.replace('HKCU:\\', 'HKCU:\\'),
  )
  check('差し替え: テスト用キーを指している', script.includes(TEST_KEY) && !script.includes('CurrentVersion'))

  const scriptPath = join(installDir, 'uninstall.ps1')
  writeFileSync(scriptPath, '﻿' + script + '\r\n', 'utf8')

  // --- 解析できるか（実行する前に） ----------------------------------------
  const parsed = ps(
    `$e = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile(` +
      `'${scriptPath.replace(/'/g, "''")}', [ref]$null, [ref]$e); ` +
      `if ($e -and $e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { 'PARSE_OK' }`,
  )
  check('PowerShell の構文解析を通る', parsed.out.includes('PARSE_OK'), parsed.out.trim().slice(0, 200))

  // --- 実行する -------------------------------------------------------------
  const command = uninstallCommandFor(scriptPath)
  check('登録するコマンドがパスをクォートしている', command.includes(`-File "${scriptPath}"`))

  const run = runCommandLine(command)
  check('終了コード 0 で終わる', run.code === 0, `exit ${run.code}: ${run.out.trim().slice(0, 200)}`)

  // --- 何が消えて、何が残ったか --------------------------------------------
  check('インストール先が消えた', !existsSync(installDir))
  check('デスクトップのショートカットが消えた', !existsSync(desktopLink))
  check('スタートメニューのショートカットが消えた', !existsSync(startMenuLink))
  check('レジストリの項目が消えた', ps(`Test-Path '${TEST_KEY}'`).out.trim() === 'False')
  // **利用者のものは消さない。**
  check('インストール先の外にあるものは残っている', existsSync(keepMe))

  // --- 中身が残っているときは失敗として返すこと -----------------------------
  // 掴まれたファイルを再現する: 開いたままのハンドルを持つファイルを 1 つ置く。
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'locked.bin'), 'x')
  writeFileSync(scriptPath, '﻿' + script + '\r\n', 'utf8')
  // 掴まれたファイルは PowerShell 側で共有なし (`'None'`) で開いて再現する。
  // Node の `fs.open` は Windows で共有を許すので、この形でしか作れない。
  const argsPart = /^(\S+)\s+([\s\S]*)$/.exec(command)?.[2] ?? ''
  const locked = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `$f = [System.IO.File]::Open('${join(installDir, 'locked.bin').replace(/'/g, "''")}', 'Open', 'Read', 'None'); ` +
        // `-ArgumentList` に**文字列を 1 本**渡すと、PowerShell はそれを
        // そのままコマンド行に付ける（＝CreateProcess と同じ層）。
        `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList '${argsPart.replace(/'/g, "''")}' -Wait -PassThru -WindowStyle Hidden; ` +
        `$f.Close(); ` +
        `Write-Output $p.ExitCode`,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const lockedExit = Number.parseInt(locked.stdout.trim(), 10)
  check(
    '消せないファイルが残ったら終了コード 1（黙って成功にしない）',
    lockedExit === 1,
    `exit ${locked.stdout.trim()} ${locked.stderr.trim().slice(0, 160)}`,
  )
  // **その 1 が「起動に失敗した 1」でないこと**を確かめる（落とし穴 116）。
  // 掴んでいたファイルは残り、それ以外は消えているはず。
  check('掴まれていたファイルだけが残る', existsSync(join(installDir, 'locked.bin')))
  check('掴まれていないもの（uninstall.ps1）は消えている', !existsSync(scriptPath))
} finally {
  ps(`Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath '${TEST_KEY}'`)
  rmSync(sandbox, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.ok)
for (const c of checks) {
  console.log(`${c.ok ? '  ok  ' : '  NG  '}${c.name}${c.detail !== undefined && !c.ok ? ` — ${c.detail}` : ''}`)
}
console.log(`\n${checks.length - failed.length} / ${checks.length}`)
process.exit(failed.length === 0 ? 0 : 1)
