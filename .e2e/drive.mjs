// GUI を CDP 経由で「本物の入力イベント」で操作するためのヘルパ。
// Runtime.evaluate で React の状態を直接いじると本番と違う経路になるので、
// クリックとキー入力は Input.dispatchMouseEvent / dispatchKeyEvent を使う。
import { connect } from './cdp.mjs'
// **画面の文言をここに書き写さない。** 辞書が正。
// 書き写すと訳文を変えた瞬間に「画面には出ているのにテストだけが落ちる」になり、
// GUI を起こすまで気づけない（実際に `起動メニューの残り容量: … bytes` でそうなった）。
import { ja } from '../packages/shared/src/i18n/ja.ts'
import { en } from '../packages/shared/src/i18n/en.ts'

const DICTS = { ja, en }

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

  /**
   * いま画面が出している言語を読む。
   *
   * ストアは外から見えないので、**言語切り替えボタンのラベル**から判定する。
   * このボタンは「切り替え*先*」の言語をその言語自身の表記で出す規約なので
   * （`App.tsx`。英語表示のときに "Japanese" にすると切り替え先が伝わらない）、
   * `English` と出ていれば今は日本語。
   */
  const detectLocale = async () =>
    c.eval(`
      const labels = [...document.querySelectorAll('header button')].map((b) => (b.innerText ?? '').trim())
      if (labels.includes('English')) return 'ja'
      if (labels.includes('日本語')) return 'en'
      return 'ja'
    `)

  let locale = await detectLocale()

  return {
    ...c,
    centerOf,
    clickAt,
    /** いま画面が出している言語（`ja` / `en`）。 */
    get locale() {
      return locale
    },
    /** 辞書から訳文を引く。**画面の文言はこれで取る。** */
    t(key) {
      const v = DICTS[locale][key]
      if (v === undefined) throw new Error(`辞書に無いキー: ${key}（locale=${locale}）`)
      return v
    },
    /** 表示言語を切り替える。既にその言語なら何もしない。 */
    async setLocale(want) {
      locale = await detectLocale()
      if (locale === want) return locale
      // 切り替えボタンは「切り替え先の言語」を出しているので、
      // いま ja なら 'English' が、en なら '日本語' が押すべきラベル。
      await this.click('header button', locale === 'ja' ? 'English' : '日本語')
      await new Promise((r) => setTimeout(r, 600))
      locale = await detectLocale()
      if (locale !== want) throw new Error(`言語を ${want} に切り替えられませんでした（いま ${locale}）`)
      return locale
    },
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
    /**
     * 各ステップの「詳しい設定」（`<Disclosure>`）を開く。
     *
     * **既定では閉じている**ので、中の入力欄（swap のサイズなど）に触る前に必ず呼ぶ。
     * 閉じている間は中身が DOM に存在しない（`{open && children}`）ので、
     * `fillByPlaceholder` は「入力欄が見つかりません」で落ちる。
     *
     * 探すのは**表示文言ではなく `data-disclosure` の目印**（`components/ui.tsx`）。
     * 「詳しい設定」という訳文で探すと、文言を変えた瞬間にまた壊れる。
     *
     * @param {number|null} nth 何番目の折りたたみか。null なら画面上の全部を開く。
     * @returns {Promise<number>} 実際に開いた数（もともと開いていたものは数えない）。
     */
    async openDisclosure(nth = null) {
      const sel = 'main [data-disclosure]'
      const total = await c.eval(`return document.querySelectorAll(${JSON.stringify(sel)}).length`)
      if (total === 0) throw new Error(`折りたたみ (${sel}) が 1 つも見つかりません`)
      if (nth !== null && nth >= total) {
        throw new Error(`折りたたみ ${nth} 番目がありません（${total} 個しかない）`)
      }
      const targets = nth === null ? [...Array(total).keys()] : [nth]
      let opened = 0
      for (const i of targets) {
        // 開く／閉じるは `aria-expanded` に出る。既に開いていたら触らない
        // （もう一度クリックすると閉じてしまう）。
        const isOpen = await c.eval(`
          const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]
          return el ? el.getAttribute('aria-expanded') === 'true' : true
        `)
        if (isOpen) continue
        await this.click(sel, null, i)
        await new Promise((r) => setTimeout(r, 250))
        const nowOpen = await c.eval(`
          const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]
          return el ? el.getAttribute('aria-expanded') === 'true' : false
        `)
        // 黙って開かないまま進むと、この下の「入力欄が見つかりません」で
        // 原因の分からない失敗になる。ここで落とす。
        if (!nowOpen) throw new Error(`折りたたみ ${i} 番目を開けませんでした`)
        opened += 1
      }
      return opened
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
