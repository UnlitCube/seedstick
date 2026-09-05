import { writeFileSync } from 'node:fs'
import { connect } from './cdp.mjs'
const out = process.argv[2] ?? '.e2e/shot.png'
const c = await connect()
const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
writeFileSync(out, Buffer.from(r.data, 'base64'))
console.log(out)
c.close()
