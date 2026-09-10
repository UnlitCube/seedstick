// 子プロセスの実行と、そのログの蓄積。
//
// インストーラが外へ出すのは `7za.exe` と `powershell.exe` の 2 つだけ。
// どちらも標準出力・標準エラーをそのままログへ積み、失敗したときに
// 完了画面の「詳細」で読めるようにする。

import { spawn, type SpawnOptions } from 'node:child_process'

export interface RunResult {
  readonly ok: boolean
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface Logger {
  append(chunk: string): void
}

export function makeLogger(): Logger & { read(): string } {
  const parts: string[] = []
  return {
    append(chunk: string) {
      parts.push(chunk)
    },
    read() {
      return parts.join('')
    },
  }
}

export function run(
  command: string,
  args: string[],
  opts: SpawnOptions = {},
  logger?: Logger,
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      ...opts,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => {
      stdout += c
      logger?.append(c)
    })
    child.stderr?.on('data', (c: string) => {
      stderr += c
      logger?.append(c)
    })
    child.on('error', (err) => {
      const msg = `\n[ERR] ${command}: ${err.message}\n`
      stderr += msg
      logger?.append(msg)
      resolveRun({ ok: false, exitCode: null, stdout, stderr })
    })
    child.on('close', (code) => {
      logger?.append(`\n[exit ${code ?? 'null'}] ${command} ${args.slice(0, 3).join(' ')}\n`)
      resolveRun({ ok: code === 0, exitCode: code, stdout, stderr })
    })
  })
}

/**
 * PowerShell のスニペットを走らせる。
 *
 * **UTF-8 を明示的に立てる。** 日本語版 Windows の PowerShell は
 * エラーメッセージを OEM コードページ (CP932) で出すのに、こちら側は
 * `setEncoding('utf8')` で読むので、そのままだとログが文字化けする。
 * `$OutputEncoding`（ネイティブ exe へ流すとき）と
 * `[Console]::OutputEncoding`（親へ返すとき）の両方が要る。
 *
 * スクリプトは必ず `ps-script.ts` の `joinPowerShellScript()` を通ったものを渡す
 * （空白で連結すると `#` が行全体を飲み込む。理由はそちらのコメント）。
 */
export function runPowerShell(script: string, logger?: Logger): Promise<RunResult> {
  const utf8Prelude =
    '$OutputEncoding = [System.Text.UTF8Encoding]::new()\n' +
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\n'
  return run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', utf8Prelude + script],
    {},
    logger,
  )
}
