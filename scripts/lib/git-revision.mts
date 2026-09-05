/**
 * 実機ログの先頭に「どのコードで走った結果なのか」を残すための小さなヘルパ。
 *
 * 背景（`docs/HANDOFF.md` 3.2）: `e2e:usb` = 19/19 / `e2e:usb-worker` = 18/18 の
 * 実機ログを取ったあとに書き込み経路を変更したが、**ログを見てもどのコードに対する
 * 結果なのか分からなかった**。SHA を出せば以後この乖離が見える。
 *
 * 守っていること:
 *   - **汚れを隠さない。** コミット SHA だけ出して作業ツリーの汚れを黙っていると、
 *     「この SHA のコードで通った」という嘘のログになる。汚れていれば必ず
 *     `(uncommitted changes: N files)` と付ける。
 *   - **取れなくても落とさない。** git が無い環境・リポジトリの外に置いた環境でも
 *     実機検証は走らせたい。取れなければ `unknown` と出して続行する。
 *   - **`shell: true` を使わない。** 引数を連結した 1 本の文字列を作らないので、
 *     パスに空白や引用符があっても壊れず、注入の余地も無い。
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** このファイルは `<repo>/scripts/lib/` に置く前提。cwd ではなく自分の位置から引く。 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface RevisionInfo {
  /** HEAD の 40 桁 hex。取れなければ `null`。 */
  head: string | null
  /**
   * 作業ツリーが汚れているか。**取れなければ `null`。**
   * 「分からない」を `false`（＝きれい）に丸めない。
   */
  dirty: boolean | null
  /** 汚れているファイル数。`dirty === true` のときだけ意味がある。 */
  dirtyCount: number
}

/** テストから差し替えるためだけの逃げ道。実行時は既定のまま使う。 */
export interface RevisionOptions {
  /** git を走らせるディレクトリ（既定: このリポジトリのルート）。 */
  cwd?: string
  /** git の実行ファイル名（既定: `git`）。 */
  gitBin?: string
}

function runGit(args: readonly string[], options: RevisionOptions): string | null {
  try {
    return execFileSync(options.gitBin ?? 'git', [...args], {
      cwd: options.cwd ?? REPO_ROOT,
      encoding: 'utf8',
      // stderr は捨てる。「リポジトリではありません」がログに混ざると
      // 本当の失敗と見分けにくい。判定には終了コードだけを使う。
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
  } catch {
    // git が無い / リポジトリではない / タイムアウト / 出力が大きすぎる。
    // ここで投げると実機検証そのものが走らなくなるので、必ず飲み込む。
    return null
  }
}

/** HEAD と作業ツリーの汚れを読む。**例外を投げない。** */
export function readRevision(options: RevisionOptions = {}): RevisionInfo {
  const raw = runGit(['rev-parse', 'HEAD'], options)
  const head = raw === null ? null : raw.trim()
  // コミットが 1 つも無いリポジトリなどで空が返ることがある。形まで確かめる。
  if (head === null || !/^[0-9a-f]{40}$/.test(head)) {
    return { head: null, dirty: null, dirtyCount: 0 }
  }
  const status = runGit(['status', '--porcelain'], options)
  if (status === null) return { head, dirty: null, dirtyCount: 0 }
  const lines = status.split('\n').filter((l) => l.trim() !== '')
  return { head, dirty: lines.length > 0, dirtyCount: lines.length }
}

/** ログに出す 1 行。 */
export function formatRevision(rev: RevisionInfo): string {
  if (rev.head === null) return 'unknown (git が無いか、リポジトリの外です)'
  if (rev.dirty === null) return `${rev.head} (working tree unknown)`
  if (rev.dirty) return `${rev.head} (uncommitted changes: ${rev.dirtyCount} files)`
  return `${rev.head} (clean)`
}

/**
 * 実行開始時にログの先頭へ出す 2 行。
 *
 * **この情報を出すのはここ 1 か所だけ。** `.e2e/run-elevated.ps1` は
 * この出力をそのままログへ流すので、あちらでは出さない（二重に出すと
 * 食い違ったときにどちらが本当か分からなくなる）。
 */
export function printRevisionBanner(scriptPath: string, options: RevisionOptions = {}): void {
  console.log(`実行  : ${scriptPath}  ${new Date().toISOString()}`)
  console.log(`HEAD  : ${formatRevision(readRevision(options))}`)
}
