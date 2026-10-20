#!/usr/bin/env node
// パッケージ済みのアプリを**実際に起動して**、画面が出ることを確かめる（落とし穴 133）。
//
//   node scripts/smoke-packaged.mjs <実行ファイル> [--timeout 90]
//
//   Windows  apps/desktop/release/canary/win-unpacked/Seedstick.exe
//   macOS    apps/desktop/release/mac-arm64/Seedstick.app/Contents/MacOS/Seedstick
//   Linux    apps/desktop/release/linux-unpacked/seedstick   （xvfb-run の下で）
//
// `npm run dev` と違い、パッケージ版は asar の中から読むので、`files` の指定漏れや
// preload の解決失敗はここでしか出ない。見るもの:
//   - renderer の本文が描画された（文字数）
//   - preload の橋渡し (window.autoinstall) が生きている
//   - IPC が応答する（getSettings を往復させる）
//   - Error Boundary が出ていない（data-error-boundary の目印）
//
// 終わったら**プロセスツリーごと**落とす（Windows では child.kill() が孫を残す。落とし穴 37）。

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const args = process.argv.slice(2)
const exe = args.find((a) => !a.startsWith('--'))
const timeoutArg = args.indexOf('--timeout')
const TIMEOUT_S = timeoutArg >= 0 ? Number(args[timeoutArg + 1]) : 90
if (!exe) {
  console.error('usage: node scripts/smoke-packaged.mjs <executable> [--timeout 90]')
  process.exit(2)
}

const PORT = 9300 + (process.pid % 600)
// Electron は --user-data-dir を userData に使わないので、アプリの設定はふだんの場所を読む
// （CI では毎回まっさら）。ここで作るのは Chromium のキャッシュの置き場だけ。
const profileDir = mkdtempSync(join(tmpdir(), 'seedstick-smoke-'))
const extra = process.platform === 'linux' ? ['--no-sandbox'] : []
const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--disk-cache-dir=${profileDir}`, ...extra], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (d) => (log += d))
child.stderr.on('data', (d) => (log += d))
let exited = null
child.on('exit', (code, signal) => (exited = { code, signal }))

function killTree() {
  if (exited) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageTarget() {
  const deadline = Date.now() + TIMEOUT_S * 1000
  while (Date.now() < deadline) {
    if (exited) throw new Error(`アプリが起動直後に終了した: ${JSON.stringify(exited)}\n${log}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* まだ上がっていない */
    }
    await sleep(500)
  }
  throw new Error(`${TIMEOUT_S} 秒待っても DevTools のページが出ない\n${log}`)
}

async function evaluate(ws, expression) {
  const id = Math.floor(Math.random() * 1e9)
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  for (;;) {
    const msg = await new Promise((r) => ws.once('message', (m) => r(JSON.parse(m.toString()))))
    if (msg.id !== id) continue
    // 文書の差し替え中は「Execution context was destroyed」が result ではなく error で返る
    if (msg.error) throw new Error(JSON.stringify(msg.error))
    if (msg.result?.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails))
    return msg.result?.result?.value
  }
}

let ok = false
try {
  const ws = new WebSocket(await pageTarget())
  await new Promise((res, rej) => {
    ws.once('open', res)
    ws.once('error', rej)
  })
  const deadline = Date.now() + TIMEOUT_S * 1000
  let state
  let lastError = null
  while (Date.now() < deadline) {
    // DevTools にページが出た直後は、まだ文書が差し替わる途中のことがある
    // （Linux の CI で `document.documentElement` が null だった）。
    // 投げたら「まだ」とみなして待ち直し、最後まで読めなければその理由を出す。
    try {
      state = await evaluate(
        ws,
        `(async () => ({
        title: document.title,
        lang: document.documentElement ? document.documentElement.lang : null,
        textLen: document.body ? document.body.innerText.length : 0,
        buttons: document.querySelectorAll('button').length,
        bridge: typeof window.autoinstall,
        boundary: document.querySelector('[data-error-boundary]') !== null,
        ipc: typeof window.autoinstall === 'object'
          ? await window.autoinstall.getSettings().then((s) => typeof s, (e) => 'error: ' + e)
          : 'no bridge',
      }))()`,
      )
      lastError = null
    } catch (e) {
      lastError = e
      await sleep(500)
      continue
    }
    if (state.textLen > 200 || state.boundary) break
    await sleep(500)
  }
  ws.close()
  if (state === undefined) throw lastError ?? new Error('画面の状態を一度も読めなかった')
  console.log(JSON.stringify(state, null, 2))
  const failures = []
  if (!(state.textLen > 200)) failures.push(`本文が描画されていない (${state.textLen} 文字)`)
  if (state.bridge !== 'object') failures.push(`preload の橋渡しが無い (window.autoinstall: ${state.bridge})`)
  if (state.ipc !== 'object') failures.push(`IPC が応答しない (getSettings: ${state.ipc})`)
  if (state.boundary) failures.push('Error Boundary が出ている')
  if (failures.length) {
    for (const f of failures) console.error(`FAIL: ${f}`)
  } else {
    ok = true
    console.log('ok: the packaged app starts and renders')
  }
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  killTree()
  await sleep(1000)
  try {
    rmSync(profileDir, { recursive: true, force: true })
  } catch {
    /* Windows はプロセスが掴んだまま少し残ることがある */
  }
}
process.exit(ok ? 0 : 1)
