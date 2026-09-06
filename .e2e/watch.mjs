// 書き込みの進捗を監視して、状態が変わった行だけを出す。
//
// **画面の文言をここに書き写さない。** 辞書 (`d.t()`) が正。
// ここは長らく `/許可|書き込み中|検証|完了|失敗|エラー|.../` という
// 日本語の正規表現で拾っていたので、英語表示にすると
// **1 行も拾えず、しかも終了条件が来ないので必ず TIMEOUT になる**（無言で壊れる）。
import { open } from './drive.mjs'

const deadline = Date.now() + Number(process.argv[2] ?? 600) * 1000

/**
 * 進捗として意味のある行を選ぶための語。
 *
 * **キーを配列にまとめて `d.t(k)` で回さない。** 番人
 * (`apps/desktop/src/main/e2e-placeholder-drift.test.ts`) は `d.t('…')` の
 * 呼び出し位置を走査してキーの実在を確かめるので、変数越しに引くと
 * **打ち間違えても誰も気づかない**（GUI を起こすまで分からない）。
 */
const interestingWords = (d) => [
  d.t('write.elevationNeeded'),
  d.t('write.statusWaitingElevation'),
  d.t('write.statusPreparing'),
  d.t('write.statusStarted'),
  d.t('write.unmounting'),
  d.t('write.writing'),
  d.t('write.flushing'),
  d.t('write.verifying'),
  d.t('write.speed'),
  d.t('write.remaining'),
  d.t('write.done'),
  d.t('write.doneBody'),
  d.t('write.failed'),
  d.t('write.cancelled'),
]

/** これが画面に出たら監視を終える（完了・失敗・中止）。 */
const terminalWords = (d) => [d.t('write.done'), d.t('write.failed'), d.t('write.cancelled')]

let last = ''
for (;;) {
  let d
  try {
    d = await open()
  } catch {
    await new Promise((r) => setTimeout(r, 3000))
    continue
  }
  // 言語は `open()` ごとに検出し直すので、監視中に切り替えても追従する。
  const interesting = interestingWords(d)
  const terminal = terminalWords(d)

  const t = await d.eval("return document.querySelector('main').innerText")
  const line = t
    .split('\n')
    .filter(Boolean)
    // `%` は進捗の数値に付くもので、言語に依らない。
    .filter((l) => l.includes('%') || interesting.some((w) => l.includes(w)))
    .slice(0, 6)
    .join(' | ')
  if (line !== last) {
    // 時刻はこちらのログの体裁なので、画面の言語とは無関係（24 時間表記に固定）。
    console.log(new Date().toLocaleTimeString('en-GB') + '  ' + line)
    last = line
  }
  const done = terminal.some((w) => t.includes(w))
  d.close()
  if (done || Date.now() > deadline) {
    console.log(done ? 'DONE' : 'TIMEOUT')
    break
  }
  await new Promise((r) => setTimeout(r, 5000))
}
