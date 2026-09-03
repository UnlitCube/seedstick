// crypt(3) ハッシュの形式判定。ブラウザ (renderer) からも使うので Node の API に依存しない。
// 実際のハッシュ生成は Node 専用の sha512crypt.ts にあり、main プロセスからのみ import する。

/** crypt(3) ハッシュに見えるか（autoinstall に平文を書いてしまう事故を検出する）。 */
export function looksLikeCryptHash(value: string): boolean {
  return /^\$(?:1|2[aby]|5|6|y|7|gy)\$/.test(value)
}

/** `$6$` (SHA-512 crypt) ハッシュとして妥当か（salt と 86 文字の本体を持つか）。 */
export function isValidSha512CryptHash(value: string): boolean {
  return /^\$6\$(?:rounds=\d{4,9}\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}$/.test(value)
}

/**
 * 貼り付けで紛れ込む改行を除去する。パスワードや SSH 公開鍵の入力欄で使う。
 *
 * 前後の空白はパスワードの一部かもしれないので触らない
 * （Raspberry Pi Imager の stripLineTerminators と同じ方針）。
 * Unicode プロパティ Zl / Zp で U+2028 / U+2029 もまとめて落とす
 * （一部のエディタからコピーすると混入し、YAML を壊す）。
 */
export function stripLineTerminators(value: string): string {
  return value.replace(/[\r\n]|\p{Zl}|\p{Zp}/gu, '')
}
