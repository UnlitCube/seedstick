import { open } from './drive.mjs'
const deadline = Date.now() + Number(process.argv[2] ?? 600) * 1000
let last = ''
for (;;) {
  let d
  try { d = await open() } catch { await new Promise(r => setTimeout(r, 3000)); continue }
  const t = await d.eval("return document.querySelector('main').innerText")
  const line = t.split('\n').filter(Boolean).filter(l =>
    /許可|書き込み中|検証|完了|失敗|エラー|%|残り|MB\/s|準備|取り外/.test(l)).slice(0, 6).join(' | ')
  if (line !== last) { console.log(new Date().toLocaleTimeString('ja-JP') + '  ' + line); last = line }
  const done = /完了|失敗|エラー/.test(t)
  d.close()
  if (done || Date.now() > deadline) { console.log(done ? 'DONE' : 'TIMEOUT'); break }
  await new Promise(r => setTimeout(r, 5000))
}
