import { describe, expect, it } from 'vitest'
import {
  isAcceptedByChpasswd,
  isValidSha512CryptHash,
  looksLikeCryptHash,
  stripLineTerminators,
} from './validate.js'

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

  // Ubuntu 26.10 の `chpasswd --encrypted` (passwd 1:4.19.3) に 1 件ずつ食わせた結果。
  // ハッシュは WSL の libxcrypt で使い捨ての文字列から作った（実在の資格情報ではない）。
  // 「受け付けるか」の正解は消費者が決める（落とし穴 117: 消費者そのものに読ませて突き合わせる）。
  const SHA512 =
    '$6$saltsalt$jPFmux42ppvmXOZiV4wrVAdXByUKFhgW9VunjQZYD7bs08AnEQBX99Ajhv/VvveMSZRujV.UK7KFRreHUWD900'
  const BODY = SHA512.split('$')[3]!
  const MEASURED: ReadonlyArray<readonly [string, string, boolean]> = [
    ['sha512', SHA512, true],
    ['sha512 rounds=5000', `$6$rounds=5000$saltsalt$${BODY}`, true],
    ['sha512 salt 16', `$6$abcdefghijklmnop$${BODY}`, true],
    ['sha512 salt に -', `$6$salt-x$${BODY}`, true],
    ['sha512 salt に _', `$6$salt_x$${BODY}`, true],
    ['sha512 rounds=1000', `$6$rounds=1000$saltsalt$${BODY}`, true],
    ['sha512 rounds=999999999', `$6$rounds=999999999$saltsalt$${BODY}`, true],
    ['sha256', '$5$saltsalt$Z4ahrUnqGiI/YU1T8foHy6stlKjq8aImtl2mHNA9OC0', true],
    ['md5', '$1$saltsalt$jtIXG..2qg3boH5l7Ybr20', true],
    ['bcrypt 2b', '$2b$10$aaaaaaaaaaaaaaaaaaaaaOaMZTYzuuJegIjVXz9q9ptwJMwBboDSq', true],
    ['bcrypt 2a', '$2a$10$aaaaaaaaaaaaaaaaaaaaaOaMZTYzuuJegIjVXz9q9ptwJMwBboDSq', true],
    ['bcrypt 2y', '$2y$10$aaaaaaaaaaaaaaaaaaaaaOaMZTYzuuJegIjVXz9q9ptwJMwBboDSq', true],
    ['bcrypt 2x', '$2x$10$aaaaaaaaaaaaaaaaaaaaaOaMZTYzuuJegIjVXz9q9ptwJMwBboDSq', true],
    ['yescrypt', '$y$j9T$saltsaltsaltsalt$oP99llOUKosYBQkgSa64zQcw9gJcIuPM562m9zhLRy3', true],
    ['sha512 本体 85', SHA512.slice(0, -1), false],
    ['sha512 本体 87', `${SHA512}a`, false],
    [
      'sha512 本体 81（26.10 の VM で落ちた旧フィクスチャ）',
      '$6$vme2e$Qv1sKq4bWbG3hQeYwZ7YyQ0cQ9hQb1s2Y3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6.',
      false,
    ],
    ['sha512 本体に使えない文字', `${SHA512.slice(0, -1)}-`, false],
    ['sha512 末尾に空白', `${SHA512} `, false],
    ['sha512 salt 空', `$6$$${BODY}`, false],
    ['sha512 salt 17', `$6$abcdefghijklmnopq$${BODY}`, false],
    ['sha512 rounds=999', `$6$rounds=999$saltsalt$${BODY}`, false],
    ['sha512 rounds=0999', `$6$rounds=0999$saltsalt$${BODY}`, false],
    ['sha512 rounds=1000000000', `$6$rounds=1000000000$saltsalt$${BODY}`, false],
    ['sha256 本体 42', '$5$saltsalt$Z4ahrUnqGiI/YU1T8foHy6stlKjq8aImtl2mHNA9OC', false],
    ['yescrypt 本体 42', '$y$j9T$saltsaltsaltsalt$oP99llOUKosYBQkgSa64zQcw9gJcIuPM562m9zhLRy', false],
    ['md5 salt 9', '$1$saltsalt9$jtIXG..2qg3boH5l7Ybr20', false],
    ['scrypt $7$', `$7$CU..../....abc$${'a'.repeat(43)}`, false],
  ]

  it.each(MEASURED)('chpasswd の実測と一致する: %s', (_name, hash, accepted) => {
    expect(isAcceptedByChpasswd(hash)).toBe(accepted)
  })

  it('looksLikeCryptHash は通すが chpasswd が拒む形がある（だから別の判定が要る）', () => {
    // 接頭辞しか見ない判定では、26.10 でインストールの最後に落ちるハッシュを通してしまう
    const rejected = MEASURED.filter(([, , ok]) => !ok).map(([, h]) => h)
    expect(rejected.filter((h) => looksLikeCryptHash(h)).length).toBeGreaterThan(10)
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
