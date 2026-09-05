// Electron の renderer を CDP で操作する最小クライアント。
// GUI を「本物のアプリのまま」動かして確認するために使う。
import { WebSocket } from 'ws'

const PORT = process.env.CDP_PORT ?? '9333'

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('page target が見つかりません')
  return page.webSocketDebuggerUrl
}

export async function connect() {
  const ws = new WebSocket(await target())
  await new Promise((res, rej) => {
    ws.once('open', res)
    ws.once('error', rej)
  })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error)))
      else p.res(msg.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id
      pending.set(n, { res, rej })
      ws.send(JSON.stringify({ id: n, method, params }))
    })

  return {
    send,
    close: () => ws.close(),
    /** ページ内で式を評価して値を返す */
    async eval(expr) {
      const r = await send('Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
      return r.result.value
    },
  }
}
