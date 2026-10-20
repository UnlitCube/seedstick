// 全言語 × 全ステップを巡回して、訳の「見た目の不具合」を機械で数える。
//
//   node .e2e/locale-sweep.mjs [出力先ディレクトリ]   （既定 .e2e/locales）
//
// 先にアプリを `--remote-debugging-port=9333` で起動し、ISO を選んでおく
// （`full-run.mjs` を 1 回通しておけば全ステップに中身が出る）。
//
// 言語ごとに見るもの:
//   1. **辞書のキー名がそのまま出ていない**（訳し忘れ・キーの打ち間違い）
//   2. ja 以外に**かなが混ざっていない**（日本語の直書き。漢字は中国語と区別できないので見ない）
//   3. **横にはみ出している要素が無い**（訳文が長い言語でボタンや見出しが切れる）
//   4. Error Boundary が出ていない
// ステップごとにスクリーンショットを残すので、最後は目で見る。
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { open } from './drive.mjs'
import { LOCALES } from '../packages/shared/src/i18n/locales.ts'
import { ja } from '../packages/shared/src/i18n/ja.ts'

const outDir = process.argv[2] ?? join('.e2e', 'locales')
mkdirSync(outDir, { recursive: true })

const KEYS = Object.keys(ja)
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

const d = await open()
const startLocale = d.locale
const problems = []
/** 意図して省略記号で切っているもの。不具合ではないが、目で見る候補として出す。 */
const truncated = new Map()
let shots = 0

// YAML のコメント言語は表示言語とは別の設定（`commentLanguage`）。
// 利用者が特定の言語に固定していると、表示を英語にしても YAML は日本語のままになる。
// それは正しい挙動なので、巡回中だけ「表示言語に合わせる」にして、最後に元へ戻す。
const originalComment = await d.eval(`return (await window.autoinstall.getSettings()).commentLanguage`)
const setComment = (value) =>
  d.eval(`
    const s = await window.autoinstall.getSettings()
    await window.autoinstall.saveSettings({ ...s, commentLanguage: ${JSON.stringify(value)} })
    return true
  `)
await setComment('ui')

for (const locale of LOCALES) {
  await d.setLocale(locale)
  await d.wait(500)
  const steps = await d.eval(`return [...document.querySelectorAll('nav button')].length`)
  for (let i = 0; i < steps; i++) {
    await d.eval(`document.querySelectorAll('nav button')[${i}].scrollIntoView({ block: 'nearest' })`)
    const pt = await d.eval(`
      const r = document.querySelectorAll('nav button')[${i}].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    `)
    await d.clickAt(pt.x, pt.y)
    await d.wait(500)
    const report = await d.eval(`
      const text = document.body.innerText
      // はみ出し: 自分の幅より中身が広く、しかも切り取り（overflow: hidden 等）か
      // 省略記号で見えなくしている要素。スクロールできる領域は除く。
      const overflow = []
      const ellipsis = []
      for (const el of document.querySelectorAll('main *, nav *, header *')) {
        if (!(el instanceof HTMLElement) || el.offsetParent === null) continue
        if (el.scrollWidth <= el.clientWidth + 1) continue
        const cs = getComputedStyle(el)
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue
        if (el.tagName === 'PRE' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT') continue
        if (el.closest('pre, textarea, [data-allow-overflow]')) continue
        // 支援技術向けに視覚的に隠した要素（sr-only）は 1px に潰してあるので必ず「はみ出す」
        if (el.getBoundingClientRect().width <= 1) continue
        const label = (el.innerText || '').trim().slice(0, 60)
        if (!label) continue
        // 省略記号で切るのは設計（ナビの要約など）。別に数える
        if (cs.textOverflow === 'ellipsis') ellipsis.push(label)
        else overflow.push(el.tagName.toLowerCase() + ': ' + label)
      }
      const step = document.querySelectorAll('nav button')[${i}].innerText.trim().split('\\n')[0]
      return { text, overflow: overflow.slice(0, 8), ellipsis, step }
    `)
    const where = `${locale} / ${report.step}`
    const leakedKeys = KEYS.filter((k) => report.text.includes(k))
    if (leakedKeys.length > 0) problems.push(`${where}: キー名が出ている ${leakedKeys.slice(0, 5).join(', ')}`)
    if (locale !== 'ja') {
      const lines = report.text.split('\n').filter((l) => KANA.test(l))
      if (lines.length > 0) problems.push(`${where}: かなが混ざっている「${lines[0].slice(0, 60)}」`)
    }
    if (report.overflow.length > 0) problems.push(`${where}: はみ出し ${report.overflow.join(' | ')}`)
    for (const e of report.ellipsis) {
      if (!truncated.has(`${locale}: ${e}`)) truncated.set(`${locale}: ${e}`, `${locale}-${String(i).padStart(2, '0')}.png`)
    }
    // Boundary は目印を持たないので、その言語の見出しで見る（辞書から引く）
    if (report.text.includes(d.t('boundary.title'))) problems.push(`${where}: Error Boundary が出ている`)
    await d.shot(join(outDir, `${locale}-${String(i).padStart(2, '0')}.png`))
    shots++
  }
}

await d.setLocale(startLocale ?? 'ja')
await setComment(originalComment ?? 'ui')
console.log(`${LOCALES.length} 言語 / スクリーンショット ${shots} 枚 → ${outDir}`)
console.log(`省略記号で切られた表示 ${truncated.size} 件（設計どおり。目で見る候補）`)
for (const [label, shot] of truncated) console.log(`  · ${label}  (${shot})`)
if (problems.length === 0) {
  console.log('問題 0 件')
} else {
  console.log(`問題 ${problems.length} 件`)
  for (const p of problems) console.log(`  - ${p}`)
}
d.close()
process.exit(problems.length === 0 ? 0 : 1)
