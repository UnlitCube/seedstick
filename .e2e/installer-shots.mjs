// インストーラの画面を CDP で一巡し、各段のスクリーンショットを撮る。
//
//   1. apps/desktop で `npx electron-vite build --config electron.vite.installer.config.ts`
//   2. `npx electron apps/desktop/out/installer/main/index.js --remote-debugging-port=9334`
//   3. `CDP_PORT=9334 node .e2e/installer-shots.mjs`
//
// **payload.7z が無い状態で走らせる**のが目的の一つ。
// その場合インストールは `payload-missing` で止まるので、
// 失敗の完了画面（理由が 1 対 1 で訳されること）まで確認できる。
//
// **文言をここに書き写さない。** 辞書 (installer/shared/labels.ts) が正。
import { writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp.mjs'
import { DICTIONARIES } from '../apps/desktop/installer/shared/labels.ts'

const OUT = process.env.SHOT_DIR ?? tmpdir()
const c = await connect()
await c.send('Runtime.enable')
await c.send('Page.enable')

const locale = await c.eval('return await window.installer.locale()')
const t = (key) => DICTIONARIES[locale][key]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  const path = `${OUT}/${name}.png`
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  console.log(path)
}

/** 表示文字列からボタンの中心座標を得る。 */
async function centerOf(text) {
  return c.eval(`
    const els = [...document.querySelectorAll('button, input')]
    const el = els.find((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.width === 0 ? null : { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  `)
}

async function click(text) {
  const at = await centerOf(text)
  if (at === null) throw new Error(`ボタンが見つかりません: ${text}`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', {
      type,
      x: at.x,
      y: at.y,
      button: 'left',
      clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    })
  }
  await wait(400)
}

/** インストール先の入力欄を「本物の入力イベント」で置き換える。 */
async function typeInstallDir(value) {
  const at = await c.eval(`
    const el = document.querySelector('input.field')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  `)
  if (at === null) throw new Error('入力欄が見つかりません')
  for (const type of ['mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', {
      type,
      x: at.x,
      y: at.y,
      button: 'left',
      clickCount: 3,
      buttons: type === 'mousePressed' ? 1 : 0,
    })
  }
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 })
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 })
  await c.send('Input.insertText', { text: value })
  await wait(500)
}

const problems = []
const bodyText = () => c.eval("return document.body.innerText.replace(/\\s+/g, ' ')")
async function expectVisible(label, text) {
  const body = await bodyText()
  if (!body.includes(text)) problems.push(`${label}: 画面に無い -> ${text}`)
}

// --- 1. ようこそ ------------------------------------------------------------
await expectVisible('welcome', t('welcome.tagline'))
await expectVisible('welcome', t('welcome.f2.title'))
await shot('inst-01-welcome')

// --- 2. インストール設定 ----------------------------------------------------
await click(t('welcome.next'))
await expectVisible('options', t('options.dir'))
await expectVisible('options', t('options.desktop'))
await shot('inst-02-options')

// 使えないパス（ドライブのルート）を入れて、理由が 1 対 1 で出ること。
await typeInstallDir('C:\\')
await expectVisible('options-invalid', t('dir.not-absolute'))
{
  const disabled = await c.eval(`
    const b = [...document.querySelectorAll('button')]
      .find((e) => (e.textContent ?? '').includes(${JSON.stringify(t('options.install'))}))
    return b === undefined ? null : b.disabled
  `)
  if (disabled !== true) problems.push('options-invalid: 使えないパスでもインストールが押せる')
}
await shot('inst-03-options-invalid')

// --- 3. 進捗 → 完了（payload が無いので失敗する） ---------------------------
await typeInstallDir(join(homedir(), 'AppData', 'Local', 'Programs', 'Seedstick'))
await wait(400)
await click(t('options.install'))
await wait(1200)
await expectVisible('done', t('done.failed.title'))
await expectVisible('done', t('fail.payload-missing'))
await shot('inst-04-done-failed')

console.log(problems.length === 0 ? 'OK: 全部の確認を通過' : `NG:\n  ${problems.join('\n  ')}`)
c.close()
process.exit(problems.length === 0 ? 0 : 1)
