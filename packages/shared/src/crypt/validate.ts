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
 * shadow の `chpasswd --encrypted` が受け付ける形。
 *
 * **Ubuntu 26.10 の chpasswd (passwd 1:4.19.3) に実際に食わせて確かめた**
 * （`validate.test.ts` の表がその結果）。26.10 の subiquity は管理ユーザーを
 * cloud-init に任せず postinstall で `chpasswd --encrypted` に通すので、
 * ここで弾かれる形はインストールの**最後の段階**で失敗する（落とし穴 156）。
 * 追加ユーザーは全リリースで late-commands の `chpasswd -e` を通る。
 *
 * - salt は `$` `:` 改行以外なら何でもよい（`-` `_` も通る）が 16 文字まで
 * - `rounds=` は 1000〜999999999（先頭 0 は不可）
 * - `$7$`（scrypt）と `$gy$`（gost-yescrypt）は libxcrypt が作れても chpasswd が拒む
 */
const CHPASSWD_HASH_SHAPES: readonly RegExp[] = [
  /^\$6\$(?:rounds=[1-9]\d{3,8}\$)?[^$:\n]{1,16}\$[./A-Za-z0-9]{86}$/,
  /^\$5\$(?:rounds=[1-9]\d{3,8}\$)?[^$:\n]{1,16}\$[./A-Za-z0-9]{43}$/,
  /^\$1\$[^$:\n]{1,8}\$[./A-Za-z0-9]{22}$/,
  /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/,
  /^\$y\$[./A-Za-z0-9]+\$[./A-Za-z0-9]{1,86}\$[./A-Za-z0-9]{43}$/,
]

/** `chpasswd --encrypted` がそのまま受け付ける crypt ハッシュか。 */
export function isAcceptedByChpasswd(value: string): boolean {
  return CHPASSWD_HASH_SHAPES.some((re) => re.test(value))
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
