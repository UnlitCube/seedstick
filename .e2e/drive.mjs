// GUI を CDP 経由で「本物の入力イベント」で操作するためのヘルパ。
// Runtime.evaluate で React の状態を直接いじると本番と違う経路になるので、
// クリックとキー入力は Input.dispatchMouseEvent / dispatchKeyEvent を使う。
import { connect } from './cdp.mjs'

export async function open() {
  const c = await connect()
  await c.send('Runtime.enable')
  await c.send('Page.enable')
  await c.send('DOM.enable')

  /** 表示文字列から要素の中心座標 (CSS px) を得る。見つからなければ null。 */
  const centerOf = async (selector, text = null, nth = 0) =>
    c.eval(`
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const want = ${text === null ? 'null' : JSON.stringify(text)}
      const hit = want === null
        ? els
        : els.filter((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').includes(want))
      const el = hit[${nth}]
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent ?? '').trim().slice(0, 60) }
    `)

  const clickAt = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await c.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      })
    }
    await new Promise((r) => setTimeout(r, 160))
  }

  return {
    ...c,
    centerOf,
    clickAt,
    /** 文字列を含む要素をクリックする。見つからなければ例外。 */
    async click(selector, text = null, nth = 0) {
      // scrollIntoView 後に座標が確定するので 2 段階で取る
      await centerOf(selector, text, nth)
      await new Promise((r) => setTimeout(r, 200))
      const p = await centerOf(selector, text, nth)
      if (!p) throw new Error(`クリック対象が見つかりません: ${selector} ${text ?? ''}`)
      await clickAt(p.x, p.y)
      return p
    },
    /** placeholder で入力欄を指定して値を入れる */
    async fillByPlaceholder(placeholder, value, nth = 0) {
      return this.fill(`[placeholder=${JSON.stringify(placeholder)}]`, value, nth)
    },
    /** input / textarea に値を入れる（React の onChange を発火させる） */
    async fill(selector, value, nth = 0) {
      const ok = await c.eval(`
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        const el = els[${nth}]
        if (!el) return false
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      `)
      if (!ok) throw new Error(`入力欄が見つかりません: ${selector}[${nth}]`)
      await new Promise((r) => setTimeout(r, 120))
    },
    /** select を変更する */
    async select(selector, value, nth = 0) {
      const ok = await c.eval(`
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${nth}]
        if (!el) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      `)
      if (!ok) throw new Error(`select が見つかりません: ${selector}[${nth}]`)
      await new Promise((r) => setTimeout(r, 120))
    },
    async wait(ms) {
      await new Promise((r) => setTimeout(r, ms))
    },
    /** 条件が真になるまで待つ */
    async until(expr, timeoutMs = 30000, label = expr) {
      const started = Date.now()
      for (;;) {
        if (await c.eval(`return !!(${expr})`)) return
        if (Date.now() - started > timeoutMs) throw new Error(`待機がタイムアウト: ${label}`)
        await new Promise((r) => setTimeout(r, 400))
      }
    },
    async shot(path) {
      const { writeFileSync } = await import('node:fs')
      const r = await c.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path, Buffer.from(r.data, 'base64'))
      return path
    },
    /** 画面に見えているテキスト（改行区切り） */
    async text() {
      return c.eval(`return document.querySelector('main').innerText`)
    },
  }
}
