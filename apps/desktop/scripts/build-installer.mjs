#!/usr/bin/env node
// Electron 製インストーラを 1 本の exe に組み上げる。
//
//   npm run dist:installer
//
// 手順:
//   1. アイコンを用意する（`scripts/make-icon.py`。既にあれば作り直さない）
//   2. アプリ本体を `--dir` で作る → `release/app/win-unpacked/`
//   3. その中身を LZMA2 で `installer-resources/payload.7z` に固める
//      あわせて**展開後の実サイズを測って** `payload-meta.json` に書く
//      （インストーラの「必要な容量」はこの実測値を読む。定数を直書きしない）
//   4. インストーラの main / preload / renderer を作る → `out/installer/`
//   5. それと payload を `electron-builder` の portable で 1 本にまとめる
//
// 圧縮方式を LZMA2 にした理由（実測。詳細は `docs/HANDOFF.md` §3.4）:
//   7z LZMA2 -mx9 -ms=on : 展開後 398.1 MB -> 99.4 MB (25.0%) / 127 秒（並列）
//   brotli q5 / q9       : 37.8% / 35.9%（**本体の exe 1 ファイルだけ**での比較）
//   brotli q11           : 同じ 1 ファイルで 15 分を超えても終わらず、ビルド段には遅すぎる
// 展開側は 7za.exe を同梱する（`7zip-bin`、MIT、x64 で 1.2 MB）。

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO_ROOT = resolve(APP_DIR, '..', '..')

const RELEASE_DIR = join(APP_DIR, 'release')
const APP_BUILD_DIR = join(RELEASE_DIR, 'app')
const APP_UNPACKED = join(APP_BUILD_DIR, 'win-unpacked')
const RESOURCES_DIR = join(APP_DIR, 'installer-resources')
const PAYLOAD = join(RESOURCES_DIR, 'payload.7z')
const PAYLOAD_META = join(RESOURCES_DIR, 'payload-meta.json')

const isWin = process.platform === 'win32'
const npx = isWin ? 'npx.cmd' : 'npx'
const electronVersion = require('electron/package.json').version

if (!isWin) {
  console.error('この配布形式は Windows 専用です（portable exe + 7za.exe）。')
  process.exit(2)
}

// ---------------------------------------------------------------------------

let stepNo = 0
function step(label, fn) {
  stepNo += 1
  process.stdout.write(`\n\u001b[36m▶ ${stepNo}. ${label}\u001b[0m\n`)
  const t0 = Date.now()
  const out = fn()
  process.stdout.write(`\u001b[32m✔ ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)\u001b[0m\n`)
  return out
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: APP_DIR,
    stdio: 'inherit',
    shell: isWin && /\.cmd$/.test(cmd),
    ...opts,
  })
  if (r.status !== 0) {
    throw new Error(`失敗: ${cmd} ${args.join(' ')} (exit ${r.status})`)
  }
}

function human(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** ディレクトリの合計サイズ。展開後に要る容量の実測に使う。 */
function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(p)
    else if (entry.isFile()) total += statSync(p).size
  }
  return total
}

// --- 1. アイコン ------------------------------------------------------------
step('アイコンを用意する', () => {
  mkdirSync(RESOURCES_DIR, { recursive: true })
  const ico = join(APP_DIR, 'build', 'icon.ico')
  if (!existsSync(ico)) {
    // 無いときだけ作る。生成には Pillow が要る（`scripts/make-icon.py`）。
    sh('python', [join(REPO_ROOT, 'scripts', 'make-icon.py')], { cwd: REPO_ROOT })
  }
  if (!existsSync(ico)) {
    throw new Error(`アイコンがありません: ${ico}（python scripts/make-icon.py を実行してください）`)
  }
  copyFileSync(ico, join(RESOURCES_DIR, 'icon.ico'))
})

// --- 2. アプリ本体 ----------------------------------------------------------
step('アプリ本体を作る (electron-vite + electron-builder --dir)', () => {
  // 前回の残りを消す。残っていると payload に古いファイルが混ざる。
  if (existsSync(APP_BUILD_DIR)) rmSync(APP_BUILD_DIR, { recursive: true, force: true })

  sh(npx, ['electron-vite', 'build'])
  sh(npx, [
    'electron-builder',
    '--win',
    '--dir',
    '--config',
    'electron-builder.json',
    `-c.electronVersion=${electronVersion}`,
    // 既定の `release/win-unpacked` はインストーラ自身の出力とぶつかるので分ける。
    '-c.directories.output=release/app',
  ])

  if (!existsSync(APP_UNPACKED)) {
    throw new Error(`${APP_UNPACKED} ができていません`)
  }
})

// --- 3. payload ------------------------------------------------------------
const payloadInfo = step('payload.7z を作る (LZMA2 -mx9)', () => {
  if (existsSync(PAYLOAD)) rmSync(PAYLOAD)

  const { path7za } = require('7zip-bin')
  if (!existsSync(path7za)) {
    throw new Error(`7za.exe が見つかりません: ${path7za}（7zip-bin は入っていますか）`)
  }

  // `win-unpacked` の**中から** `*` を渡す。ディレクトリごと渡すと
  // アーカイブの最上位に `win-unpacked/` が挟まり、展開先が 1 段深くなる。
  sh(
    path7za,
    ['a', '-t7z', '-m0=lzma2', '-mx9', '-mfb=64', '-ms=on', '-mmt=on', '-y', '-bso0', '-bsp1', PAYLOAD, '*'],
    { cwd: APP_UNPACKED },
  )

  copyFileSync(path7za, join(RESOURCES_DIR, '7za.exe'))

  const unpackedBytes = dirSize(APP_UNPACKED)
  const archiveBytes = statSync(PAYLOAD).size
  // **測った値をそのまま持たせる。** インストーラの「必要な容量」は
  // ここで書いた数字を読む（コードに直書きすると本体が太ったときに嘘になる）。
  writeFileSync(
    PAYLOAD_META,
    JSON.stringify({ unpackedBytes, archiveBytes, electronVersion }, null, 2) + '\n',
    'utf8',
  )
  process.stdout.write(
    `  展開後 ${human(unpackedBytes)} → payload.7z ${human(archiveBytes)}` +
      ` (${((archiveBytes / unpackedBytes) * 100).toFixed(1)}%)\n`,
  )
  return { unpackedBytes, archiveBytes }
})

// --- 4. インストーラの本体 --------------------------------------------------
step('インストーラの main / preload / renderer を作る', () => {
  const outDir = join(APP_DIR, 'out', 'installer')
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  sh(npx, ['electron-vite', 'build', '--config', 'electron.vite.installer.config.ts'])
})

// --- 5. 1 本にまとめる ------------------------------------------------------
step('portable exe にまとめる', () => {
  sh(npx, [
    'electron-builder',
    '--win',
    '--config',
    'electron-builder.installer.json',
    `-c.electronVersion=${electronVersion}`,
  ])
})

// --- 6. 報告 ---------------------------------------------------------------
step('できあがり', () => {
  const found = readdirSync(RELEASE_DIR).filter((n) => /Setup.*\.exe$/i.test(n))
  if (found.length === 0) {
    throw new Error(`${RELEASE_DIR} に Setup の exe がありません`)
  }
  for (const name of found) {
    const p = join(RELEASE_DIR, name)
    process.stdout.write(`\n\u001b[35m  ${p}\u001b[0m\n  ${human(statSync(p).size)}\n`)
  }
  process.stdout.write(
    `\n  内訳: 展開後 ${human(payloadInfo.unpackedBytes)} / payload ${human(payloadInfo.archiveBytes)}\n`,
  )
})
