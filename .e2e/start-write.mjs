import { open } from './drive.mjs'
const d = await open()
await d.click('nav button', '書き込み'); await d.wait(1500)
await d.click('main label', 'KIOXIA'); await d.wait(800)
await d.click('main button', '書き込みを開始'); await d.wait(1200)
await d.fillByPlaceholder('消去', '消去'); await d.wait(600)
const p = await d.eval(`
  const bs = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('書き込みを開始') && !b.disabled)
  const el = bs[bs.length - 1]
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width/2, y: r.y + r.height/2 }
`)
await d.clickAt(p.x, p.y)
console.log('書き込みを開始しました。UAC で「はい」を押してください。')
d.close()
