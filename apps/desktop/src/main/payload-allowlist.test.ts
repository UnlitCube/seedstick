import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// electron の app.getPath を差し替える。main のモジュールは electron に依存するので、
// テストからは import する前にモックを置く必要がある。
const userData = mkdtempSync(join(tmpdir(), 'payload-allow-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => userData },
}))

const { rememberChosenPayload, wasChosenByUser, resetPayloadAllowlistCache } = await import(
  './payload-allowlist.js'
)

// 「他人からもらったプロファイルに書かれた任意のパスを読める」ことが実際に起きていた。
// 実在確認は安全性の検査ではない、というのがこの記録の存在理由。
describe('ペイロードの許可記録', () => {
  beforeEach(() => {
    resetPayloadAllowlistCache()
  })

  it('選んでいないパスは許可されない（実在していても）', async () => {
    // このテストファイル自体は確実に存在するが、利用者が選んだわけではない
    expect(await wasChosenByUser(import.meta.filename)).toBe(false)
  })

  it('自分で選んだパスは、開き直しても許可される', async () => {
    await rememberChosenPayload('C:/payloads/app.tar.gz')
    resetPayloadAllowlistCache() // アプリを再起動した状況
    expect(await wasChosenByUser('C:/payloads/app.tar.gz')).toBe(true)
  })

  it('別のパスまで許可しない', async () => {
    await rememberChosenPayload('C:/payloads/app.tar.gz')
    expect(await wasChosenByUser('C:/Users/me/.ssh/id_rsa')).toBe(false)
    expect(await wasChosenByUser('C:/payloads/other.tar.gz')).toBe(false)
  })

  it('Windows では大小と区切り文字の違いを吸収する', async () => {
    await rememberChosenPayload('C:\\Payloads\\App.tar.gz')
    const expected = process.platform === 'win32'
    expect(await wasChosenByUser('c:/payloads/app.tar.gz')).toBe(expected)
  })

  it('同じパスを何度選んでも重複しない', async () => {
    await rememberChosenPayload('C:/payloads/app.tar.gz')
    await rememberChosenPayload('C:/payloads/app.tar.gz')
    expect(await wasChosenByUser('C:/payloads/app.tar.gz')).toBe(true)
  })
})
