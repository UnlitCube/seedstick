import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { app } from 'electron'
import { join } from 'node:path'
import {
  decodeMessages,
  encodeMessage,
  getPlatformOps,
  type ControlMessage,
  type WorkerJob,
  type WorkerMessage,
} from '@autoinstall/media'
import type { WriteStatus } from '@autoinstall/shared'

// 書き込みの司令塔。
//
// GUI 本体は通常権限のまま、USB へ書く処理だけを管理者/root で起動した子プロセスに任せる。
// 昇格した子プロセスの標準出力は親から確実には読めない（Windows の runas がその代表）ので、
// 127.0.0.1 の TCP に NDJSON を流し、1 回限りのトークンで認証する。

export type StatusListener = (status: WriteStatus) => void

export class WriteSupervisor {
  private status: WriteStatus = { state: 'idle' }
  private listeners = new Set<StatusListener>()
  private server: Server | null = null
  private child: ChildProcess | null = null
  private clientSocket: Socket | null = null
  private token = ''
  private jobId = ''
  private jobFile: string | null = null
  private deviceId: string | null = null

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStatus(): WriteStatus {
    return this.status
  }

  private setStatus(status: WriteStatus): void {
    this.status = status
    for (const l of this.listeners) l(status)
  }

  get busy(): boolean {
    return this.status.state === 'preparing' || this.status.state === 'writing'
  }

  /** 書き込みを開始する。既に走っていれば拒否する。 */
  async start(job: Omit<WorkerJob, 'reportPort' | 'reportToken' | 'jobId'>): Promise<{ started: boolean; message?: string }> {
    if (this.busy) return { started: false, message: '既に書き込み中です。' }

    this.jobId = randomBytes(8).toString('hex')
    this.token = randomBytes(24).toString('base64url')
    this.deviceId = job.devicePath
    this.setStatus({ state: 'preparing', message: '権限を確認しています' })

    const port = await this.startReportServer()
    const fullJob: WorkerJob = { ...job, jobId: this.jobId, reportPort: port, reportToken: this.token }

    const dir = join(app.getPath('userData'), 'jobs')
    await mkdir(dir, { recursive: true })
    this.jobFile = join(dir, `${this.jobId}.json`)
    await writeFile(this.jobFile, JSON.stringify(fullJob), 'utf8')

    try {
      const alreadyPrivileged = await getPlatformOps().hasWriteAccess()
      this.setStatus({
        state: 'preparing',
        message: alreadyPrivileged ? '書き込みを準備しています' : '管理者権限の許可を待っています',
      })
      this.child = alreadyPrivileged ? this.spawnDirect(this.jobFile) : this.spawnElevated(this.jobFile)
      this.watchChild(this.child)
      return { started: true }
    } catch (err) {
      await this.cleanup()
      this.setStatus({
        state: 'error',
        message: '書き込みプロセスを起動できませんでした。',
        detail: (err as Error).message,
      })
      return { started: false, message: (err as Error).message }
    }
  }

  async cancel(): Promise<void> {
    if (!this.busy) return
    // まずワーカーに丁寧に伝える。ワーカーは書き込みループの次の区切りで止まる。
    const msg: ControlMessage = { type: 'cancel', jobId: this.jobId }
    this.clientSocket?.write(encodeMessage(msg, this.token))
    // 一定時間で応答が無ければプロセスツリーごと落とす。
    setTimeout(() => {
      if (this.busy && this.child?.pid) killTree(this.child.pid)
    }, 5000)
  }

  private startReportServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        this.clientSocket = socket
        let buffer = ''
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => {
          buffer += chunk
          const { messages, rest } = decodeMessages(buffer, this.token)
          buffer = rest
          for (const m of messages) this.handleWorkerMessage(m as WorkerMessage)
        })
        socket.on('error', () => undefined)
      })
      // 127.0.0.1 に限定する。外部から書き込み進捗を覗かれたり、偽の完了を注入されないため。
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr === null || typeof addr === 'string') {
          reject(new Error('進捗受信用のポートを開けませんでした。'))
          return
        }
        this.server = server
        resolve(addr.port)
      })
      server.on('error', reject)
    })
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    if (!('jobId' in msg) || msg.jobId !== this.jobId) return
    switch (msg.type) {
      case 'hello':
        this.setStatus({ state: 'preparing', message: '書き込みを開始しました' })
        break
      case 'progress':
        this.setStatus({
          state: 'writing',
          phase: msg.phase,
          bytesDone: msg.bytesDone,
          bytesTotal: msg.bytesTotal,
          label: msg.label,
          bytesPerSecond: msg.bytesPerSecond,
          etaSeconds: msg.etaSeconds,
        })
        break
      case 'done':
        this.setStatus({
          state: 'done',
          digest: msg.digest,
          bytesWritten: msg.bytesWritten,
          verified: msg.verified,
          elapsedMs: msg.elapsedMs,
        })
        void this.cleanup()
        break
      case 'error':
        this.setStatus({
          state: msg.name === 'WriteCancelledError' ? 'cancelled' : 'error',
          message: msg.message,
          detail: msg.detail,
        } as WriteStatus)
        void this.cleanup()
        break
      case 'log':
        if (this.status.state === 'preparing') {
          this.setStatus({ state: 'preparing', message: msg.message })
        }
        break
    }
  }

  private watchChild(child: ChildProcess): void {
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024)
    })
    child.on('exit', (code) => {
      // 正常終了（done を受信済み）なら何もしない
      if (this.status.state === 'done' || this.status.state === 'cancelled') return
      if (this.status.state === 'error') return
      const cancelledByUser = code === null
      this.setStatus(
        cancelledByUser
          ? { state: 'cancelled' }
          : {
              state: 'error',
              message: `書き込みプロセスが異常終了しました (終了コード ${code})。`,
              // 昇格プロセスでは権限拒否が最も多い。ユーザーに次の行動を示す。
              detail:
                stderr.trim() ||
                '管理者権限の要求がキャンセルされた可能性があります。もう一度試してください。',
            },
      )
      void this.cleanup()
    })
    child.on('error', (err) => {
      this.setStatus({
        state: 'error',
        message: '書き込みプロセスを起動できませんでした。',
        detail: err.message,
      })
      void this.cleanup()
    })
  }

  /** 既に管理者/root で動いている場合。自分自身を Node として再実行する。 */
  private spawnDirect(jobFile: string): ChildProcess {
    return spawn(process.execPath, [workerEntryPath(), jobFile], {
      // ELECTRON_RUN_AS_NODE を付けると Electron バイナリが素の Node として動く。
      // これを付けないと GUI ウィンドウがもう一つ開いてしまう。
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  /** 権限昇格して起動する。OS ごとに手段が違う。 */
  private spawnElevated(jobFile: string): ChildProcess {
    const worker = workerEntryPath()
    if (process.platform === 'win32') {
      // Start-Process -Verb RunAs で UAC を出す。昇格したプロセスの標準出力は親に繋がらないので、
      // 進捗は TCP 経由で受け取る（それがこの設計の理由）。
      const psArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$env:ELECTRON_RUN_AS_NODE='1'; ` +
          `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' ` +
          `-ArgumentList '"${worker}"','"${jobFile}"' -Verb RunAs -WindowStyle Hidden -Wait`,
      ]
      return spawn('powershell.exe', psArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    }
    if (process.platform === 'darwin') {
      // osascript の "with administrator privileges" は認証ダイアログを出す。
      const cmd = `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(worker)} ${shellQuote(jobFile)}`
      const script = `do shell script ${appleScriptQuote(cmd)} with administrator privileges`
      return spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    }
    // Linux: pkexec は polkit の認証ダイアログを出す。環境変数は既定で引き継がれないので env 経由で渡す。
    return spawn('pkexec', ['env', 'ELECTRON_RUN_AS_NODE=1', process.execPath, worker, jobFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  private async cleanup(): Promise<void> {
    this.clientSocket?.end()
    this.clientSocket = null
    this.server?.close()
    this.server = null
    this.child = null
    if (this.jobFile) {
      // ジョブファイルにはパスワードハッシュを含む user-data が入るので必ず消す
      await rm(this.jobFile, { force: true }).catch(() => undefined)
      this.jobFile = null
    }
    this.deviceId = null
  }

  /** アプリ終了時に呼ぶ。走っている子プロセスを片付ける。 */
  async dispose(): Promise<void> {
    if (this.child?.pid) killTree(this.child.pid)
    await this.cleanup()
  }
}

function workerEntryPath(): string {
  // electron-vite が out/main/worker.js に出力する
  return join(__dirname, 'worker.js')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function appleScriptQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * プロセスツリーごと終了させる。
 * Windows では child.kill() が孫プロセスを取り残す（昇格した実体は孫になる）。
 */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on(
      'error',
      () => undefined,
    )
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 既に終了している
    }
  }
}
