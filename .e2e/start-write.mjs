// 書き込みステップまで進めて「書き込みを開始」を押す。**ここから先は UAC が出る。**
//
// **画面の文言をここに書き写さない。** 辞書 (`d.t()`) が正。
// 書き写すと訳文を変えた瞬間に静かに壊れ、しかも英語表示では 1 行目から通らない。
// （`full-run.mjs` / `full-run2.mjs` は先に直したが、この 2 本は残っていた。）
import { open } from './drive.mjs'

const d = await open()

await d.click('nav button', d.t('step.write'))
await d.wait(1500)
// デバイスの行に出るのは製造元・モデル名（`device.description`）なので訳文ではない。
// ここだけは実物の文字列で選ぶ。**書き込み先が違うと別の USB が消える**ので、
// 見つからなければ `click` が例外を投げるままにしておく（黙って進めない）。
await d.click('main label', 'KIOXIA')
await d.wait(800)

await d.click('main button', d.t('write.start'))
await d.wait(1200)

// 確認モーダルの入力欄は、placeholder も「一致しないと押せない値」も
// どちらも `write.confirmWord`（`views/WriteStep.tsx`）。同じキーから取る。
const confirmWord = d.t('write.confirmWord')
await d.fillByPlaceholder(confirmWord, confirmWord)
await d.wait(600)

// モーダル側の「書き込みを開始」は画面側と同じラベルなので、
// **押せる（disabled でない）ものの最後**を取る。
const startLabel = d.t('write.start')
const p = await d.eval(`
  const bs = [...document.querySelectorAll('button')]
    .filter((b) => (b.textContent ?? '').includes(${JSON.stringify(startLabel)}) && !b.disabled)
  const el = bs[bs.length - 1]
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
`)
// 黙って進むと「押したつもりで何も起きていない」になる。ここで落とす。
if (!p) throw new Error(`確認モーダルの「${startLabel}」が押せる状態になっていません`)
await d.clickAt(p.x, p.y)

console.log('書き込みを開始しました。UAC で「はい」を押してください。')
d.close()
