// **できあがった Setup.exe を実際に走らせて**、インストールが通ることを確かめる。
//
//   1. `npm run dist:installer`
//   2. `"apps/desktop/release/Seedstick Setup-0.1.0.exe" --remote-debugging-port=9335`
//   3. `CDP_PORT=9335 npx tsx .e2e/installer-run.mjs`
//
// 「.exe ができた」と「それが動く」は別（落とし穴 133）。
// ここでは **展開の進捗が実際に進むこと**と、**展開後に本体の exe が置かれること**まで見る。
//
// **完了後の自動起動は切る**（完了画面を読みたいので）。
// **文言をここに書き写さない。** 辞書が正。
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp.mjs'
import { DICTIONARIES } from '../apps/desktop/installer/shared/labels.ts'

const OUT = process.env.SHOT_DIR ?? tmpdir()
const c = await connect()
await c.send('Runtime.enable')
await c.send('Page.enable')

const locale = await c.eval('return await window.installer.locale()')
const t = (key) => DICTIONARIES[locale][key]
const info = await c.eval('return await window.installer.info()')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function dirSize(d) {
  let total = 0
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) total += dirSize(p)
    else if (e.isFile()) total += statSync(p).size
  }
  return total
}
const problems = []
const note = (m) => problems.push(m)

async function shot(name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'))
  console.log(`  shot ${OUT}/${name}.png`)
}

async function clickText(text) {
  const at = await c.eval(`
    const el = [...document.querySelectorAll('button')]
      .find((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  `)
  if (at === null) throw new Error(`ボタンが見つかりません: ${text}`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', {
      type, x: at.x, y: at.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    })
  }
  await wait(350)
}

/** ラベルの文言からチェックボックスを探して外す。 */
async function uncheck(labelText) {
  const at = await c.eval(`
    const label = [...document.querySelectorAll('label')]
      .find((e) => (e.textContent ?? '').includes(${JSON.stringify(labelText)}))
    if (!label) return null
    const box = label.querySelector('input[type=checkbox]')
    if (!box || !box.checked) return 'already'
    const r = box.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  `)
  if (at === null) throw new Error(`チェックボックスが見つかりません: ${labelText}`)
  if (at === 'already') return
  for (const type of ['mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', {
      type, x: at.x, y: at.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    })
  }
  await wait(200)
}

const body = () => c.eval("return document.body.innerText.replace(/\\s+/g, ' ')")

// --- 1. ようこそ → 設定 -----------------------------------------------------
console.log(`インストール先: ${info.defaultInstallDir}`)
await shot('run-01-welcome')
await clickText(t('welcome.next'))
await uncheck(t('options.launchAfter'))
await shot('run-02-options')

// --- 2. インストール --------------------------------------------------------
await clickText(info.installedAt === null ? t('options.install') : t('options.update'))

// 進捗が**実際に進む**ことを見る（0% のまま終わっていないこと）。
const seen = new Set()
let shotTaken = false
for (let i = 0; i < 240; i++) {
  await wait(500)
  const text = await body()
  const pct = /(\d+)%/.exec(text)
  if (pct !== null) seen.add(Number(pct[1]))
  if (!shotTaken && [...seen].some((p) => p > 5 && p < 95)) {
    await shot('run-03-progress')
    shotTaken = true
  }
  if (text.includes(t('done.ok.title')) || text.includes(t('done.failed.title'))) break
}
const moved = [...seen].filter((p) => p > 0 && p < 100)
if (moved.length < 2) note(`進捗が進んでいない（見えた値: ${[...seen].sort((a, b) => a - b).join(',')}）`)
if (!shotTaken) console.log('  （進捗の途中を捉えられなかった）')

// 段の入りは 320ms + 子の遅延 400ms。**落ち着いてから撮る**
// （画面が出た瞬間に撮ると、透明度の途中が写って「文字が無い」ように見える）。
await wait(1200)
await shot('run-04-done')
const done = await body()
if (!done.includes(t('done.ok.title'))) note(`完了画面が成功ではない: ${done.slice(0, 300)}`)

// --- 3. 置かれたものを確かめる ----------------------------------------------
const dir = info.defaultInstallDir
const mustExist = [
  'Seedstick.exe',
  'resources/app.asar',
  'resources/samples/ip-only.json',
  'uninstall.ps1',
]
// **Setup.exe の複製が残っていないこと。** 以前はここに 196 MB の複製を置いていた。
const mustNotExist = ['Uninstall Seedstick.exe']
for (const rel of mustExist) {
  const p = join(dir, rel)
  if (!existsSync(p)) note(`置かれていない: ${p}`)
  else console.log(`  ok ${rel} (${(statSync(p).size / 1024 / 1024).toFixed(1)} MB)`)
}

for (const rel of mustNotExist) {
  if (existsSync(join(dir, rel))) note(`置かれてはいけない: ${join(dir, rel)}`)
}

// 置いたものの合計。「必要な容量」として画面に出した値を超えていないこと
// （超えていたら、その表示は嘘になっている）。
const total = dirSize(dir)
console.log(
  `  インストール先の合計: ${(total / 1024 / 1024).toFixed(1)} MB` +
    ` (必要と表示した値: ${(info.needBytes / 1024 / 1024).toFixed(1)} MB)`,
)
if (total > info.needBytes * 1.05) {
  note(`置いた量が「必要な容量」を 5% 超えている（${total} > ${info.needBytes}）`)
}

console.log(problems.length === 0 ? '\nOK: インストールを通過' : `\nNG:\n  ${problems.join('\n  ')}`)
c.close()
process.exit(problems.length === 0 ? 0 : 1)
