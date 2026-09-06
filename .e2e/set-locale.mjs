// 表示言語を切り替えるだけの小さな道具。
//
//   node .e2e/set-locale.mjs en
//   node .e2e/set-locale.mjs ja
//
// `full-run.mjs` / `full-run2.mjs` は画面の文言を**辞書から引く**ので、
// 切り替えたあとそのまま通せる（言語ごとに書き分ける必要は無い）。
import { open } from './drive.mjs'

const want = process.argv[2]
if (want !== 'ja' && want !== 'en') {
  console.error('使い方: node .e2e/set-locale.mjs <ja|en>')
  process.exit(2)
}
const d = await open()
const before = d.locale
await d.setLocale(want)
console.log(`表示言語: ${before} → ${d.locale}`)
d.close()
