import { createHash, randomFillSync } from 'node:crypto'

// SHA-512 crypt(3)（`$6$` 形式）の実装。
// autoinstall の identity.password は crypt(3) ハッシュしか受け付けず、平文を書くとログインできない。
// Ulrich Drepper の仕様 (https://www.akkadia.org/drepper/SHA-crypt.txt) に従う。
// glibc / openssl passwd -6 / perl crypt と一致することを単体テストで検証している。

const B64_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const SALT_ALPHABET = B64_ALPHABET

export const DEFAULT_ROUNDS = 5000
const MIN_ROUNDS = 1000
const MAX_ROUNDS = 999_999_999
const MAX_SALT_LENGTH = 16

/**
 * 最終ダイジェスト 64 バイトを base64 化するときのバイト順。
 * Drepper の実装の b64_from_24bit 呼び出し順そのまま。並びが違うと glibc と一致しない。
 */
const B64_ORDER: readonly [number, number, number][] = [
  [0, 21, 42],
  [22, 43, 1],
  [44, 2, 23],
  [3, 24, 45],
  [25, 46, 4],
  [47, 5, 26],
  [6, 27, 48],
  [28, 49, 7],
  [50, 8, 29],
  [9, 30, 51],
  [31, 52, 10],
  [53, 11, 32],
  [12, 33, 54],
  [34, 55, 13],
  [56, 14, 35],
  [15, 36, 57],
  [37, 58, 16],
  [59, 17, 38],
  [18, 39, 60],
  [40, 61, 19],
  [62, 20, 41],
]

function sha512(...parts: Buffer[]): Buffer {
  const h = createHash('sha512')
  for (const p of parts) h.update(p)
  return h.digest()
}

/** `src` を繰り返して `length` バイトを作る（Drepper の `__sha512_process_bytes` のシーケンス生成）。 */
function repeatTo(src: Buffer, length: number): Buffer {
  if (src.length === 0) return Buffer.alloc(length)
  const out = Buffer.allocUnsafe(length)
  for (let i = 0; i < length; i += src.length) {
    src.copy(out, i, 0, Math.min(src.length, length - i))
  }
  return out
}

function b64From24Bit(b2: number, b1: number, b0: number, n: number): string {
  let w = (b2 << 16) | (b1 << 8) | b0
  let out = ''
  for (let i = 0; i < n; i++) {
    out += B64_ALPHABET[w & 0x3f]
    w >>>= 6
  }
  return out
}

export interface Sha512CryptOptions {
  /** 省略時は 16 文字のランダム salt */
  readonly salt?: string
  /** 省略時は 5000。5000 以外を指定すると `$6$rounds=N$...` 形式になる。 */
  readonly rounds?: number
}

/** ランダムな salt（base64 アルファベット 16 文字）を作る。 */
export function generateSalt(length = MAX_SALT_LENGTH): string {
  const bytes = Buffer.allocUnsafe(length)
  randomFillSync(bytes)
  let out = ''
  for (let i = 0; i < length; i++) {
    // 64 は 256 を割り切るのでモジュロバイアスは発生しない
    out += SALT_ALPHABET[bytes[i]! % SALT_ALPHABET.length]
  }
  return out
}

/**
 * SHA-512 crypt ハッシュを作る。
 * @param password UTF-8 として符号化される（マルチバイト文字も glibc と同じ結果になる）
 */
export function sha512Crypt(password: string, options: Sha512CryptOptions = {}): string {
  const rounds = options.rounds ?? DEFAULT_ROUNDS
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new RangeError(`rounds must be an integer from ${MIN_ROUNDS} to ${MAX_ROUNDS}: ${rounds}`)
  }
  const rawSalt = options.salt ?? generateSalt()
  if (rawSalt.includes('$')) throw new Error('the salt must not contain "$"')
  const salt = Buffer.from(rawSalt.slice(0, MAX_SALT_LENGTH), 'utf8')
  const pw = Buffer.from(password, 'utf8')

  // ステップ 4-8: digest B = SHA512(password + salt + password)
  const b = sha512(pw, salt, pw)

  // ステップ 1-3, 9-12: digest A
  const aParts: Buffer[] = [pw, salt, repeatTo(b, pw.length)]
  for (let bits = pw.length; bits > 0; bits >>>= 1) {
    aParts.push((bits & 1) !== 0 ? b : pw)
  }
  const a = sha512(...aParts)

  // ステップ 13-15: DP -> P（パスワード長ぶんの繰り返し列）
  const dpParts: Buffer[] = []
  for (let i = 0; i < pw.length; i++) dpParts.push(pw)
  const p = repeatTo(sha512(...dpParts), pw.length)

  // ステップ 16-19: DS -> S（salt 長ぶんの繰り返し列）
  const dsParts: Buffer[] = []
  const dsCount = 16 + a[0]!
  for (let i = 0; i < dsCount; i++) dsParts.push(salt)
  const s = repeatTo(sha512(...dsParts), salt.length)

  // ステップ 21: 反復
  let c = a
  for (let i = 0; i < rounds; i++) {
    const parts: Buffer[] = []
    parts.push((i & 1) !== 0 ? p : c)
    if (i % 3 !== 0) parts.push(s)
    if (i % 7 !== 0) parts.push(p)
    parts.push((i & 1) !== 0 ? c : p)
    c = sha512(...parts)
  }

  // ステップ 22: base64 化
  let encoded = ''
  for (const [i2, i1, i0] of B64_ORDER) {
    encoded += b64From24Bit(c[i2]!, c[i1]!, c[i0]!, 4)
  }
  encoded += b64From24Bit(0, 0, c[63]!, 2)

  const prefix = rounds === DEFAULT_ROUNDS ? '$6$' : `$6$rounds=${rounds}$`
  return `${prefix}${salt.toString('utf8')}$${encoded}`
}

// 形式判定は renderer からも使うため crypt/validate.ts に分離してある（Node 非依存）。
export { looksLikeCryptHash, isValidSha512CryptHash } from './validate.js'
