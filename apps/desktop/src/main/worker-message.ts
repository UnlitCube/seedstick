import { isLocalizedText, localized, type LocalizedText } from '@autoinstall/shared'

// ワーカーが親へ送るメッセージの組み立て。
//
// `worker.ts` から切り出してある。あちらは読み込むだけで `main()` が走る
// エントリポイントなので、テストから import すると書き込みが始まってしまう。

/**
 * 画面に出す総括文を取り出す。
 *
 * `@autoinstall/media` の例外は `message`（日本語・開発者向け。ログとテストが読む）を
 * 残したまま `text` を持つ。ここで捕まえるのはそれだけではない（`readFile` の ENOENT、
 * `JSON.parse` の SyntaxError など素の Error も来る）ので、**形を確かめてから**使い、
 * 読めなければ「予期しないエラー」に落とす。
 * 生の内容は `detail` で渡すので、ここで落としても情報は消えない。
 */
export function displayTextOf(err: Error): LocalizedText {
  const text = (err as { text?: unknown }).text
  // NDJSON を通るので中身まで見る（`deep`）。判定そのものは `@autoinstall/shared` に
  // 1 つだけ置いてある——ここに書き写すと、契約が広がったとき写しだけが取り残される。
  // 実際に一度そうなり、理由つきの拒否が境界で捨てられて
  // 「予期しないエラーが発生しました」だけが画面に出ていた。
  return isLocalizedText(text, true) ? text : localized('error.unknown')
}
