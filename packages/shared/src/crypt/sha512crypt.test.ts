import { describe, expect, it } from 'vitest'
import {
  generateSalt,
  isValidSha512CryptHash,
  looksLikeCryptHash,
  sha512Crypt,
} from './sha512crypt.js'

// 期待値は `openssl passwd -6 -salt <salt> <password>` と perl の crypt(3) の出力（両者一致を確認済み）。
describe('sha512Crypt', () => {
  it.each([
    [
      'ubuntu',
      'saltsalt',
      '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1',
    ],
    [
      'Ubuntu123!',
      'abcdefghijklmnop',
      '$6$abcdefghijklmnop$EGuHxSD9iSEOoBqkU4sX/m9oNLe5yYIKly3wu6A7CsdvFOfKv9HfpApRkNgkji5sZDE8qwS6v16P9Bey5F2.v0',
    ],
    // マルチバイトは UTF-8 バイト列として扱う。期待値は perl に生の UTF-8 バイト
    // (e38391 e382b9 e383af e383bc e38389 e6bca2 e5ad97) を渡して得たもの。
    [
      'パスワード漢字',
      'utf8salt00000000',
      '$6$utf8salt00000000$n8OQRC7HYAs6nmQ5E4b6DdVo47O8nwhbbf2xNe887zOvQMJnznaB7Yf1ZskoeKeVxP8GjqftHyHRaWaBmUT7I.',
    ],
    [
      'aVeryLongPasswordThatExceedsSixtyFourBytesForSureBecauseItIsQuiteLongIndeed',
      'LongSalt1',
      '$6$LongSalt1$FYAewK3CLCZB5MOrfRs0inbSWsyyMpNckK9Gp.E4T4X3jxrQyyzxtNDv95Hj1dG6J8lddlFJ89VShxs3GIRD//',
    ],
  ])('glibc と一致する (%s)', (password, salt, expected) => {
    expect(sha512Crypt(password, { salt })).toBe(expected)
  })

  it('rounds を指定すると $6$rounds=N$ 形式になる', () => {
    expect(sha512Crypt('ubuntu', { salt: 'saltsalt', rounds: 10_000 })).toBe(
      '$6$rounds=10000$saltsalt$gBPfYRWvK8iOwjU/wKF6TP2CpUy1NaUuzJJETZL9SG3U6qIkSDEl/YdA6bGSLvtdDMqYS4DDeFfig391UK1r2/',
    )
    expect(sha512Crypt('ubuntu', { salt: 'saltsalt', rounds: 1000 })).toBe(
      '$6$rounds=1000$saltsalt$iLB3DUni2k04QYcT1T14/Put3WwpH/hBkncm11QPKQ.ISOY.WP.vQgj.JZk000SskGGMAbabb1ubBVAKP/bzA/',
    )
  })

  it('空パスワードでも例外にならず 86 文字の本体を返す', () => {
    const h = sha512Crypt('', { salt: 'shortsalt' })
    expect(isValidSha512CryptHash(h)).toBe(true)
  })

  it('salt は 16 文字で切り詰められる', () => {
    expect(sha512Crypt('ubuntu', { salt: 'abcdefghijklmnopQRSTUV' })).toBe(
      sha512Crypt('ubuntu', { salt: 'abcdefghijklmnop' }),
    )
  })

  it('salt に $ を含むと拒否する', () => {
    expect(() => sha512Crypt('ubuntu', { salt: 'bad$salt' })).toThrow(/\$/)
  })

  it('rounds が範囲外だと拒否する', () => {
    expect(() => sha512Crypt('ubuntu', { rounds: 999 })).toThrow(RangeError)
    expect(() => sha512Crypt('ubuntu', { rounds: 1_000_000_000 })).toThrow(RangeError)
  })

  it('salt 省略時はランダムで、毎回異なるハッシュになる', () => {
    const a = sha512Crypt('ubuntu')
    const b = sha512Crypt('ubuntu')
    expect(a).not.toBe(b)
    expect(isValidSha512CryptHash(a)).toBe(true)
  })
})

describe('generateSalt', () => {
  it('既定で 16 文字、crypt の base64 アルファベットのみ', () => {
    const s = generateSalt()
    expect(s).toHaveLength(16)
    expect(s).toMatch(/^[./A-Za-z0-9]{16}$/)
  })
})

describe('ハッシュ判定', () => {
  it('平文を crypt ハッシュと誤認しない', () => {
    expect(looksLikeCryptHash('ubuntu')).toBe(false)
    expect(looksLikeCryptHash('$6$abc$def')).toBe(true)
    expect(looksLikeCryptHash('$y$j9T$abc')).toBe(true)
  })

  it('$6$ の厳密判定', () => {
    expect(isValidSha512CryptHash('$6$saltsalt$short')).toBe(false)
    expect(
      isValidSha512CryptHash(
        '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1',
      ),
    ).toBe(true)
  })
})
