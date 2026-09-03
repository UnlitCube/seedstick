import { describe, expect, it } from 'vitest'
import { isValidSha512CryptHash, looksLikeCryptHash, stripLineTerminators } from './validate.js'

const LS = String.fromCharCode(0x2028) // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029) // U+2029 PARAGRAPH SEPARATOR

describe('stripLineTerminators', () => {
  it('CR / LF を除去する', () => {
    expect(stripLineTerminators('abc\r\ndef')).toBe('abcdef')
    expect(stripLineTerminators('abc\ndef')).toBe('abcdef')
    expect(stripLineTerminators('abc\rdef')).toBe('abcdef')
  })

  it('U+2028 / U+2029 も除去する（エディタからのコピーで混入する）', () => {
    expect(stripLineTerminators(`abc${LS}def${PS}ghi`)).toBe('abcdefghi')
  })

  it('前後や途中の空白は残す（パスワードの一部かもしれない）', () => {
    expect(stripLineTerminators('  pass word  ')).toBe('  pass word  ')
    expect(stripLineTerminators('タブ\tあり')).toBe('タブ\tあり')
  })

  it('改行が無ければそのまま返す', () => {
    expect(stripLineTerminators('P@ssw0rd!')).toBe('P@ssw0rd!')
    expect(stripLineTerminators('')).toBe('')
  })
})

describe('ハッシュ形式の判定', () => {
  it('平文を crypt ハッシュと誤認しない', () => {
    expect(looksLikeCryptHash('ubuntu')).toBe(false)
    expect(looksLikeCryptHash('')).toBe(false)
  })

  it('主要な crypt 形式を認識する', () => {
    expect(looksLikeCryptHash('$6$abc$def')).toBe(true)
    expect(looksLikeCryptHash('$y$j9T$abc')).toBe(true)
    expect(looksLikeCryptHash('$2b$12$abc')).toBe(true)
  })

  it('$6$ の厳密判定は本体 86 文字を要求する', () => {
    expect(isValidSha512CryptHash('$6$saltsalt$short')).toBe(false)
    expect(
      isValidSha512CryptHash(
        '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1',
      ),
    ).toBe(true)
  })
})
