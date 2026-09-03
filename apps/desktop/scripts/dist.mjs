#!/usr/bin/env node
// electron-builder を呼ぶラッパ。
//
// npm workspaces では electron がリポジトリルートに巻き上げられるため、
// electron-builder が「Cannot compute electron version」で落ちる。
// require で解決したバージョンを明示的に渡すことで回避する。

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDir = dirname(dirname(fileURLToPath(import.meta.url)))

const electronVersion = require('electron/package.json').version
const flags = process.argv.slice(2)
const targets = flags.filter((f) => ['--win', '--mac', '--linux'].includes(f))
if (targets.length === 0) {
  console.error('プラットフォームを指定してください: --win / --mac / --linux')
  process.exit(2)
}

console.log(`electron ${electronVersion} でパッケージします (${targets.join(' ')})`)

// electron-vite build を先に通す
const build = spawnSync('npx', ['electron-vite', 'build'], {
  cwd: appDir,
  stdio: 'inherit',
  // Windows では npx が .cmd なので shell が必要
  shell: process.platform === 'win32',
})
if (build.status !== 0) process.exit(build.status ?? 1)

const result = spawnSync(
  'npx',
  ['electron-builder', ...targets, '--config', 'electron-builder.json', `-c.electronVersion=${electronVersion}`],
  { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' },
)
if (result.status !== 0) process.exit(result.status ?? 1)

console.log(`\n成果物: ${join(appDir, 'release')}`)
