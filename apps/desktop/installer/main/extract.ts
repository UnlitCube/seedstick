// payload.7z の展開。
//
// 圧縮は LZMA2 (`7za a -t7z -m0=lzma2 -mx9 -ms=on`)。
// **実測** (2026-09-11、electron 44.1.1): 展開後 398.1 MB → payload.7z 99.4 MB（25.0%）、
// 127 秒（並列）。Node 内蔵の brotli も測ったが、こちらは
// **本体の exe 1 ファイル（234.8 MB）だけ**での比較で q5 が 37.8% / 8.1 秒、
// q9 が 35.9% / 58.1 秒、q11 は 15 分を超えても終わらなかった。
// **同じ土俵の数字ではない**（7z は全ファイルをまとめた solid 圧縮）が、
// 「brotli では 7z の比に届かず、届かせようとすると桁違いに遅い」ことは言える。
//
// 展開は外部プロセスなので、**中止は「殺す」ことでしか止まらない**。
// Windows では `child.kill()` が届かないことがあるので `taskkill /T /F` も撃つ
// （落とし穴 37）。

import { spawn } from 'node:child_process'
import type { Logger } from './exec.js'

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export interface ExtractProgress {
  /** 0..1 */
  readonly ratio: number
  /** 展開し終えたファイル数。7za が出さない形のときは `undefined`。 */
  readonly files?: number
}

/**
 * `archive` を `destDir` へ展開する。
 *
 * 7za のスイッチ:
 *   `x`      パス付きで展開
 *   `-o…`    展開先（**`=` を入れない**のが 7-Zip の書式）
 *   `-y`     すべて「はい」
 *   `-bsp1`  進捗を標準出力へ
 *   `-bso0`  通常メッセージを捨てる（ファイル名の羅列でログが埋まらないように）
 *   `-bse2`  エラーは標準エラーへ
 */
export function extractPayload(
  sevenZ: string,
  archive: string,
  destDir: string,
  logger: Logger,
  signal: AbortSignal,
  onProgress: (p: ExtractProgress) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const args = ['x', archive, `-o${destDir}`, '-y', '-bsp1', '-bso0', '-bse2']
    let child: ReturnType<typeof spawn>

    const onAbort = (): void => {
      try {
        child?.kill('SIGTERM')
      } catch {
        /* 届かないことがある */
      }
      try {
        if (typeof child?.pid === 'number') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        }
      } catch {
        /* 既に終わっていれば失敗する */
      }
    }

    if (signal.aborted) {
      reject(new CancelledError())
      return
    }

    child = spawn(sevenZ, args, { windowsHide: true })
    let stderr = ''
    signal.addEventListener('abort', onAbort)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    // `-bsp1` は `\r 12% 345 - path` のような形を吐き続ける。
    // **ログには積まない**（何百行もの "1% 2% 3%" で本当のエラーが埋まる）。
    child.stdout?.on('data', (chunk: string) => {
      const matches = [...chunk.matchAll(/(\d+)%(?:\s+(\d+))?/g)]
      const last = matches[matches.length - 1]
      if (last === undefined) return
      const pct = Number.parseInt(last[1] ?? '', 10)
      if (Number.isNaN(pct)) return
      const filesRaw = last[2]
      const files = filesRaw === undefined ? undefined : Number.parseInt(filesRaw, 10)
      onProgress({
        ratio: Math.min(1, Math.max(0, pct / 100)),
        files: files !== undefined && !Number.isNaN(files) ? files : undefined,
      })
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      logger.append(chunk)
    })
    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) reject(new CancelledError())
      else if (code === 0) resolvePromise()
      else reject(new Error(`7za exit ${code}: ${stderr.trim() || 'no detail'}`))
    })
  })
}
