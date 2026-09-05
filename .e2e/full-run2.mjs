// ネットワーク以降を仕上げ、実行時の値と上級者向けを UI から設定して確認まで進める。
import { open } from './drive.mjs'
// 画面の文言は辞書が正。ここに書き写すと訳文を変えたときに**テストだけが落ちる**。
import { ja as DICT } from '../packages/shared/src/i18n/ja.ts'

const d = await open()
const ok = []
const ng = []
const check = (l, c, det = '') => (c ? ok.push(l) : ng.push(`${l}${det ? ` — ${det}` : ''}`))
const step = async (l) => {
  await d.click('nav button', l)
  await d.wait(600)
}

// ------------------------------------------------------------- 4. ネットワーク
await step('ネットワーク')
await d.click('main label', '固定 IP アドレスを使う')
await d.wait(600)
await d.fillByPlaceholder('192.168.1.10/24', '192.168.1.50/24')
await d.fillByPlaceholder('192.168.1.1', '192.168.1.1')
await d.fillByPlaceholder('1.1.1.1, 8.8.8.8', '1.1.1.1, 8.8.8.8')
await d.wait(400)
await d.shot('.e2e/32-network.png')
// `|| true` を付けると常に成功する。入力欄の値を直接読んで確かめる。
check(
  '固定 IP を入力できる',
  await d.eval(
    `return [...document.querySelectorAll('main input')].some((i) => i.value === '192.168.1.50/24')`,
  ),
)

// ------------------------------------------------------------- 5. ディスク
await step('ディスク')
await d.select('main select', 'serial', 0)
await d.wait(500)
await d.fillByPlaceholder('CT500MX*', 'FALLBACKSERIAL01')
await d.wait(300)
// swap は「詳しい設定」（<Disclosure>）の中で、**既定では閉じている**。
// 閉じている間は中身が DOM に無いので、開かずに触ると必ず落ちる。
await d.openDisclosure()
await d.wait(300)
await d.select('main select', 'size', 1)
await d.wait(400)
await d.fillByPlaceholder('4G', '4G')
await d.wait(400)
await d.shot('.e2e/33-storage.png')
check('シリアル指定と swap サイズを設定できる',
  (await d.eval(`return document.querySelector('[placeholder="CT500MX*"]').value`)) === 'FALLBACKSERIAL01')

// ------------------------------------------------------------- 6. 実行時に決める
await step('実行時に決める')
await d.wait(400)
for (const i of [1, 4, 7]) {
  const p = await d.eval(`
    const el = document.querySelectorAll('main input[type="radio"]')[${i}]
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  `)
  await d.clickAt(p.x, p.y)
  await d.wait(250)
}
await d.wait(500)
const rows = await d.eval(`return document.querySelectorAll('main table tbody tr').length`)
for (let i = rows; i < 3; i++) {
  await d.click('main button', 'ホストを追加')
  await d.wait(300)
}
const hosts = [
  ['web01', 'web01', '192.168.1.11/24', '192.168.1.1', '1.1.1.1,8.8.8.8', 'S3Y1NB0K100001'],
  ['web02', 'web02', '192.168.1.12/24', '192.168.1.1', '1.1.1.1,8.8.8.8', 'S3Y1NB0K100002'],
  ['db01', 'db01', '192.168.1.21/24', '192.168.1.1', '1.1.1.1', 'S3Y1NB0K100003'],
]
for (const [row, values] of hosts.entries()) {
  for (const [col, v] of values.entries()) await d.fill('main table input', v, row * 6 + col)
}
await d.wait(600)
await d.shot('.e2e/34-runtime.png')
const rt = await d.text()
for (const h of ['web01', 'web02', 'db01']) check(`起動メニューに ${h}`, rt.includes(`ai.hostname=${h}`))
check('手入力の項目も出る', rt.includes('ai.interactive=1'))
// **単位の語を正規表現に入れない。** ここは長らく `(\d+) bytes` を探していたが、
// 画面が `t('runtime.grubFreeBytes')` を通るようになり日本語では「610 バイト」に
// なったため、**表示は出ているのにテストだけが落ちる**状態になっていた。
// 訳文を変えるたびに壊れる形なので、見出しは辞書から引き、数字だけを取る。
const freeLabel = DICT['runtime.grubFree']
const free = (rt.split(freeLabel + ':')[1] ?? '').match(/^\s*(\d+)/)
check('grub.cfg の残り容量が出る', free !== null, rt.match(/起動メニュー[^\n]*/g)?.join(' | ') ?? '')
if (free) console.log('grub.cfg 残り:', free[1], 'bytes')

// ------------------------------------------------------------- 8. 上級者向け
await step('インストール後')
// 「上級者向け」はタブではなく折りたたみになった。文言でボタンを探すと
// 訳文を変えた瞬間に壊れるうえ、既に開いていると**閉じてしまう**ので目印で開く。
await d.openDisclosure()
await d.wait(500)
await d.select('main select', 'webhook', 0)
await d.wait(400)
await d.fillByPlaceholder('https://hooks.example.com/install', 'https://hooks.example.local/e2e')
await d.fill('main textarea', 'postfix postfix/main_mailer_type select No configuration', 1)
await d.wait(400)
await d.shot('.e2e/35-advanced.png')
check('通知先を webhook にできる',
  (await d.eval(`return document.querySelector('[placeholder="https://hooks.example.com/install"]').value`)) === 'https://hooks.example.local/e2e')

// ------------------------------------------------------------- 9. 確認
await step('確認')
await d.until(`document.querySelectorAll('main pre').length > 0`, 20000, '設定生成')
await d.wait(1500)
await d.shot('.e2e/36-review.png')
const review = await d.text()
check('エラーが残っていない', !review.includes('エラーがあります'), review.split('\n').slice(0, 6).join(' / '))
check('実行時の値が集計される', /メニュー 3 件/.test(review), review.match(/実行時に決める値[\s\S]{0,120}/)?.[0] ?? '')

// autoinstall.yaml / grub.cfg のタブを見る
await d.click('main button', 'autoinstall.yaml')
await d.wait(600)
const yaml = await d.eval(`return document.querySelector('main pre').innerText`)
// プレースホルダは廃止した（落とし穴 18・21）。subiquity が PyYAML で書き直すので
// 引用形式は残らず、置換に失敗した YAML が残る設計自体が成立しない。
// いまは既定値をそのまま書き、early-commands が python + PyYAML で上書きする。
check('YAML にプレースホルダが残っていない', !/@@AI_[A-Z0-9_]+@@/.test(yaml))
check('既定値がそのまま入っている（引数が来なくても有効な YAML）', /hostname:/.test(yaml))
check('early-commands が入る', yaml.includes('early-commands'))
check('swap 4G が入る', /size:\s*4G/.test(yaml))
check('reporting webhook が入る', yaml.includes('hooks.example.local/e2e'))
check('debconf-selections が入る', yaml.includes('debconf-selections'))
await d.shot('.e2e/37-yaml.png')

await d.click('main button', 'grub.cfg')
await d.wait(600)
const grub = await d.eval(`return document.querySelector('main pre').innerText`)
for (const h of ['web01', 'web02', 'db01']) check(`grub.cfg に ${h} の menuentry`, grub.includes(`ai.hostname=${h}`))
check('grub.cfg が 2048 バイト以内', new TextEncoder().encode(grub).length <= 2048, String(new TextEncoder().encode(grub).length))
await d.shot('.e2e/38-grub.png')
console.log('grub.cfg のサイズ:', new TextEncoder().encode(grub).length, 'bytes')

console.log('\n--- 結果 ---')
for (const s of ok) console.log('  ok   ' + s)
for (const s of ng) console.log('  FAIL ' + s)
console.log(`${ok.length + ng.length} 件中 ${ok.length} 件成功、${ng.length} 件失敗`)
d.close()
process.exit(ng.length ? 1 : 0)
