import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// **テストが作った一時ファイルを消さないと、ディスクを食い潰す。**
//
// 「2 GiB 超のペイロードを弾く」テストが `truncateSync(path, 2 GiB + 1)` で
// 大きさだけ作っていた。コメントは「疎なファイル」と書いていたが
// **NTFS では疎にならず、実際に 2 GB 確保される**。しかも後始末が無かった。
// 気づいたときには `%TEMP%` に 257 ディレクトリ・**526 GB** が積み上がり、
// C ドライブの空きが 15 GB を切って、テスト自体が ENOSPC で落ちていた。
// 走らせるたびに増えるので、**誰も気づかないまま何日も進行する**。
//
// この番人が見るのは 1 つだけ:
//   テストが `mkdtempSync` / `truncateSync` を**直接**呼んでいないこと。
//   作成と後始末は `test-support/temp-files.ts` に集約してあり、
//   そこを通れば `cleanupTempDirs()` が必ず消せる。
//
// **見ていないもの（正直に）**:
//   - `test-support/temp-files.ts` を import したのに `afterAll` で
//     `cleanupTempDirs()` を呼び忘れた場合は、下の 2 つ目の it が拾う。
//     ただし「`afterAll` の中で呼んでいるか」までは見ない（文字列の有無だけ）。
//   - `writeFileSync` で普通に大きなファイルを書く形は見ていない
//     （現状そういうテストは無い。増えたらここに足す）。
//   - テスト以外（`scripts/` や `.e2e/`）は対象外。
// ---------------------------------------------------------------------------

const MAIN_DIR = dirname(fileURLToPath(import.meta.url))

/** `src/main/` 直下のテストファイルを名前つきで読む。 */
function testFiles(): { name: string; text: string }[] {
  return readdirSync(MAIN_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.test.ts'))
    .map((e) => ({ name: e.name, text: readFileSync(join(MAIN_DIR, e.name), 'utf8') }))
}

/** 行頭の `//` と `*` を落とす（コメントの中の言及は数えない）。 */
function codeLines(text: string): { line: string; n: number }[] {
  return text.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => {
    const t = line.trim()
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
  })
}

describe('テストが一時ファイルを残さない', () => {
  it('走査対象を実際に読めている（空の検査になっていない）', () => {
    const files = testFiles()
    expect(files.length).toBeGreaterThan(5)
    expect(files.some((f) => f.name === 'seed-builder.test.ts')).toBe(true)
    expect(files.some((f) => f.name === 'localized-guard.test.ts')).toBe(true)
  })

  it('`mkdtempSync` / `truncateSync` を直接呼んでいない', () => {
    const offenders: string[] = []
    // この番人自身は、禁じている名前を**検査するために**書いているので除く。
    // 除外はこの 1 ファイルだけ。他を足すとザルになる。
    const SELF = 'temp-file-leak.test.ts'
    // 名前を分割して持つ（自分の中に完全な綴りを置くと、他の検査に引っかかる）。
    const BANNED = ['mkdtemp' + 'Sync', 'truncate' + 'Sync']
    for (const { name, text } of testFiles()) {
      if (name === SELF) continue
      for (const { line, n } of codeLines(text)) {
        for (const bad of BANNED) {
          if (line.includes(bad)) {
            offenders.push(`${name}:${n}  ${bad} を直接呼んでいる（test-support/temp-files.ts を使う）`)
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('一時ファイルを作るテストは、必ず後始末を呼ぶ', () => {
    const offenders: string[] = []
    for (const { name, text } of testFiles()) {
      const makes = text.includes('makeSparseFile(') || text.includes('makeTempDir(')
      if (makes && !text.includes('cleanupTempDirs()')) {
        offenders.push(`${name}: 一時ファイルを作るのに cleanupTempDirs() を呼んでいない`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
