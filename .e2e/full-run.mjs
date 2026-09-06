// GUI を最初から最後まで実際に操作して、実 USB に書ける状態まで持っていく。
// 「起動メニューでホストを選ぶ」+「上級者向けキー」を UI から作る。
import { open } from './drive.mjs'

const d = await open()
const ok = []
const ng = []
const check = (label, cond, detail = '') => (cond ? ok.push(label) : ng.push(`${label}${detail ? ` — ${detail}` : ''}`))
const step = async (label) => {
  await d.click('nav button', label)
  await d.wait(600)
}

// ------------------------------------------------------------------ 1. ISO
await step(d.t('step.iso'))
const detected = JSON.stringify(d.t('iso.detected'))
const already = await d.eval(`return document.querySelector('main').innerText.includes(${detected})`)
if (!already) {
await d.click('button', d.t('iso.choose'))
await d.wait(1200)
// ネイティブのファイルダイアログはパスを打ち込む
const { execFileSync } = await import('node:child_process')
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  "Add-Type -AssemblyName System.Windows.Forms; " +
    "[System.Windows.Forms.SendKeys]::SendWait('C:\\Users\\user\\images\\ubuntu-24.04.3-live-server-amd64.iso'); " +
    'Start-Sleep -Milliseconds 800; ' +
    "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
])
}
await d.until(`document.querySelector('main').innerText.includes(${detected})`, 40000, 'ISO 認識')
check('ISO を認識する', (await d.text()).includes('24.04.3'))
await d.shot('.e2e/30-iso.png')

// ------------------------------------------------------------------ 2. 基本設定
await step(d.t('step.basics'))
await d.select('main select', 'ja_JP.UTF-8', 0)
await d.select('main select', 'jp:', 1)
await d.select('main select', 'Asia/Tokyo', 2)
await d.fillByPlaceholder('ubuntu-server', 'e2e-gui')
check('ホスト名を入力できる', (await d.eval(`return document.querySelector('[placeholder="ubuntu-server"]').value`)) === 'e2e-gui')

// ------------------------------------------------------------------ 3. ユーザー
await step(d.t('step.user'))
await d.fillByPlaceholder('Ubuntu User', 'E2E Admin')
await d.fillByPlaceholder('ubuntu', 'e2eadmin')
await d.fill('main input[type="password"]', 'E2e-Passw0rd!-long', 0)
await d.fill('main input[type="password"]', 'E2e-Passw0rd!-long', 1)
// **文言を書き写さない。** 以前は「ハッシュ化して保存されました」など 3 つの
// 文字列を並べていたが、どれも辞書に無い（訳文を変えると静かに待ちが空振りする）。
// 辞書にある `user.passwordStrength` だけを見る。
await d.until(
  `document.querySelector('main').innerText.includes(${JSON.stringify(d.t('user.passwordStrength'))})`,
  20000,
  'パスワード',
)
await d.wait(2500)
await d.shot('.e2e/31-user.png')

// ------------------------------------------------------------------ 4. ネットワーク（既定値として固定 IP）
await step(d.t('step.network'))
await d.click('main label', d.t('network.modeStatic'))
await d.wait(600)
const netDom = await d.eval(`return [...document.querySelectorAll('main input')].map(e => e.placeholder).filter(Boolean)`)
console.log('ネットワーク入力欄:', JSON.stringify(netDom))
// placeholder は `NetworkStep.tsx` の実物と一致していること。
// ここは長らく `192.168.1.50/24`（実物は `.10/24`）を探していて、
// `.catch(() => {})` が握り潰すので**空振りしたまま緑**だった。握り潰さない。
await d.fillByPlaceholder('192.168.1.10/24', '192.168.1.50/24')
await d.wait(400)
await d.shot('.e2e/32-network.png')

// ------------------------------------------------------------------ 5. ディスク
await step(d.t('step.storage'))
await d.select('main select', 'serial', 0)
await d.wait(500)
const diskDom = await d.eval(`return [...document.querySelectorAll('main input')].map(e => e.placeholder).filter(Boolean)`)
console.log('ディスク入力欄:', JSON.stringify(diskDom))
// swap は「詳しい設定」（<Disclosure>）の中で、**既定では閉じている**。
// 閉じている間は中身が DOM に無いので、開かずに触ると必ず落ちる。
await d.openDisclosure()
await d.wait(300)
await d.select('main select', 'size', 1)
await d.wait(400)
await d.fillByPlaceholder('4G', '4G')
await d.wait(300)
await d.shot('.e2e/33-storage.png')

console.log('--- 途中経過 ---')
for (const s of ok) console.log('  ok   ' + s)
for (const s of ng) console.log('  FAIL ' + s)
d.close()
