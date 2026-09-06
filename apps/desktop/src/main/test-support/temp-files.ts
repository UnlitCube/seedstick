import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// テストが作る一時ファイルの作成と後始末。**テストからだけ使う。**
//
// ここが独立したファイルになっているのは、同じ処理を各テストに書き写すと
// 片方だけが後始末を忘れるため（落とし穴 74 と同じ理由。判定も後始末も 1 か所）。
//
// ---------------------------------------------------------------------------
// **実際に 526 GB を食い潰した。**
//
// 「2 GiB 超のペイロードを弾く」ことを確かめるテストが
// `truncateSync(path, 2 GiB + 1)` で大きさだけ作っていた。
// コメントには「疎なファイル」と書いてあったが、**NTFS では疎にならない**
// ——`truncateSync` は領域を実際に確保する。
// しかも後始末が無かったので、テストを走らせるたびに 2 GB が残り続けた。
// 気づいたときには `%TEMP%` に 257 ディレクトリ・526 GB が積み上がり、
// C ドライブの空きが 15 GB を切って、テスト自体が ENOSPC で落ちていた。
//
// 対策は 2 つとも要る:
//   1. **Windows では明示的に疎ファイルにする**（`fsutil sparse setflag`）。
//      そうしないと「一時的に 2 GB」でも空きが無ければ失敗する。
//   2. **必ず消す。** 疎ファイルでも、ディレクトリは残り続ける。
// ---------------------------------------------------------------------------

const created: string[] = []

/**
 * 指定した大きさに見えるファイルを作る。**中身は書かない。**
 *
 * 検査側が見るのは `statSync().size` だけなので、疎ファイルで足りる。
 * Windows では `fsutil` で疎フラグを立てる（失敗しても続行するが、
 * その場合は本当に領域を使うので、**必ず `cleanupTempDirs()` を呼ぶこと**）。
 */
export function makeSparseFile(prefix: string, name: string, sizeBytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  const path = join(dir, name)
  writeFileSync(path, '')
  if (process.platform === 'win32') {
    try {
      // 疎フラグは**大きさを決める前**に立てる（あとから立てても既に確保済み）。
      execFileSync('fsutil', ['sparse', 'setflag', path], { stdio: 'ignore', timeout: 10_000 })
    } catch {
      // fsutil が無い / 権限が無い / ファイルシステムが対応していない。
      // 落とさない（後始末があるので、一時的に領域を使うだけで済む）。
    }
  }
  truncateSync(path, sizeBytes)
  return path
}

/** 後始末用の一時ディレクトリを作る（`cleanupTempDirs()` で消える）。 */
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

/**
 * このモジュールが作ったものを全部消す。**`afterAll` で必ず呼ぶ。**
 * 消せなかったものは黙って飲む（テストの失敗にしない）が、
 * 数は返すので、呼び出し側が確かめられる。
 */
export function cleanupTempDirs(): number {
  let removed = 0
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
      removed++
    } catch {
      // 使用中などで消せないことがある。次の実行で消える。
    }
  }
  return removed
}
