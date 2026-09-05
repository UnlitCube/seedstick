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
import { localized, type LocalizedText, type WriteStatus } from '@autoinstall/shared'

// 書き込みの司令塔。
//
// GUI 本体は通常権限のまま、USB へ書く処理だけを管理者/root で起動した子プロセスに任せる。
// 昇格した子プロセスの標準出力は親から確実には読めない（Windows の runas がその代表）ので、
// 127.0.0.1 の TCP に NDJSON を流し、1 回限りのトークンで認証する。

export type StatusListener = (status: WriteStatus) => void

export class WriteSupervisor {
  private killTimer: ReturnType<typeof setTimeout> | null = null
  /** 昇格ワーカー自身の pid（hello で受け取る）。ラッパーの pid とは別物。 */
  private workerPid: number | null = null
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

  /**
   * 書き込みを開始する。既に走っていれば拒否する。
   *
   * 画面に出す文言は訳さずに `LocalizedText` で返す（main は利用者の言語を知らない）。
   * `detail` は開発者向けの生の診断で、訳さないまま等幅で出す。
   */
  async start(
    job: Omit<WorkerJob, 'reportPort' | 'reportToken' | 'jobId'>,
  ): Promise<{ started: boolean; message?: LocalizedText; detail?: string | null }> {
    if (this.busy) return { started: false, message: localized('write.errorAlreadyRunning') }

    this.jobId = randomBytes(8).toString('hex')
    this.token = randomBytes(24).toString('base64url')
    this.deviceId = job.devicePath
    this.resetWorkerPid()
    this.setStatus({ state: 'preparing', message: localized('write.statusCheckingPrivileges') })

    // ポートを開く・ジョブファイルを書く段階の失敗も必ず捕まえる。
    // ここで抜けると状態が 'preparing' のまま残り、busy が永久に true になって
    // 終了ガードが誤発火し、アプリを閉じられなくなる。
    try {
      const port = await this.startReportServer()
      const fullJob: WorkerJob = { ...job, jobId: this.jobId, reportPort: port, reportToken: this.token }

      const dir = join(app.getPath('userData'), 'jobs')
      await mkdir(dir, { recursive: true })
      this.jobFile = join(dir, `${this.jobId}.json`)
      // ジョブファイルにはパスワードハッシュが入る。プロファイル保存側と同じく 0600 にする。
      await writeFile(this.jobFile, JSON.stringify(fullJob), { encoding: 'utf8', mode: 0o600 })

      const alreadyPrivileged = await getPlatformOps().hasWriteAccess()
      this.setStatus({
        state: 'preparing',
        message: localized(
          alreadyPrivileged ? 'write.statusPreparing' : 'write.statusWaitingElevation',
        ),
      })
      this.child = alreadyPrivileged ? this.spawnDirect(this.jobFile) : this.spawnElevated(this.jobFile)
      this.watchChild(this.child)
      return { started: true }
    } catch (err) {
      await this.cleanup()
      // 総括は訳せる形で、原因（ポートが開けない等の開発者向け診断）は生のまま渡す。
      const detail = (err as Error).message
      this.setStatus({ state: 'error', message: localized('write.errorSpawnFailed'), detail })
      return { started: false, message: localized('write.errorSpawnFailed'), detail }
    }
  }

  isBusy(): boolean {
    return this.busy
  }

  async cancel(): Promise<void> {
    if (!this.busy) return
    // まずワーカーに丁寧に伝える。ワーカーは書き込みループの次の区切りで止まる。
    const msg: ControlMessage = { type: 'cancel', jobId: this.jobId }
    this.clientSocket?.write(encodeMessage(msg, this.token))
    // 一定時間で応答が無ければプロセスツリーごと落とす。
    // タイマーはこのジョブの子プロセスを覚えておく。this.child を後で読むと、
    // 5 秒以内にキャンセルが完了して次の書き込みが始まっていた場合、
    // その新しいプロセスを巻き添えで殺してしまう。
    const victim = this.child
    const jobId = this.jobId
    // 昇格経路では victim は PowerShell のラッパーで、書き込んでいるのは
    // hello で pid を知らせてきたワーカー本体。ラッパーを落としても
    // ワーカーは書き続けるので、**両方**を対象にする。
    const workerPid = this.workerPid
    this.killTimer = setTimeout(() => {
      this.killTimer = null
      if (!this.busy || this.jobId !== jobId) return
      // ワーカー本体を落とせたかどうかで判断する。ラッパーは落ちて当然なので、
      // ラッパーの成否を成功と見なすと「止めた」と嘘をつくことになる。
      const { targets, decisive } = planKill(workerPid, victim?.pid ?? null)
      if (targets.length === 0) return
      void Promise.all(targets.map((pid) => killTree(pid).then((ok) => [pid, ok] as const))).then(
        (results) => {
          const killed =
            decisive === null ? false : (results.find(([pid]) => pid === decisive)?.[1] ?? false)
          if (killed || !this.busy || this.jobId !== jobId) return
          // 落とせなかった。黙って 'cancelled' にすると、ユーザーは止まったと信じて
          // USB を抜き、書き込み途中のメディアができる。正直に伝える。
          // 「抜かないでほしい」「タスクマネージャーで終了してほしい」は開発者向けの
          // 診断ではなく利用者への指示なので、detail ではなく訳せる message に置く。
          this.setStatus({
            state: 'error',
            message: localized('write.errorCancelFailed'),
            detail: null,
          })
          // ここだけ cleanup() を呼んでいなかった。ジョブファイルには
          // パスワードハッシュが入っており、進捗受信サーバーも開いたままになる。
          // ワーカーが生き残っていても、こちら側の後始末は済ませてよい。
          void this.cleanup()
        },
      )
    }, 5000)
  }

  /** 次のジョブに前のワーカーの pid を持ち越さない。 */
  private resetWorkerPid(): void {
    this.workerPid = null
  }

  /** 保留中のキルタイマーを解除する（ジョブが終わったら必ず呼ぶ）。 */
  private clearKillTimer(): void {
    if (this.killTimer !== null) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
  }

  private startReportServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        let buffer = ''
        let authenticated = false
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => {
          buffer += chunk
          // decodeMessages はトークンが一致しない行を捨てる。
          const { messages, rest } = decodeMessages(buffer, this.token)
          buffer = rest
          if (messages.length > 0 && !authenticated) {
            // **トークン付きのメッセージを出せた相手だけを制御チャネルにする。**
            // 接続してきた順に無条件で差し替えていたため、ローカルの一般プロセスが
            // 後から繋ぐだけで cancel の送り先を奪えた（cancel にはトークンが乗るので、
            // 盗んだ側は以降なりすませる。本物のワーカーには停止要求が届かない）。
            authenticated = true
            this.clientSocket = socket
          }
          for (const m of messages) this.handleWorkerMessage(m as WorkerMessage)
        })
        socket.on('close', () => {
          if (this.clientSocket === socket) this.clientSocket = null
        })
        socket.on('error', () => undefined)
      })
      // 127.0.0.1 に限定する。外部から書き込み進捗を覗かれたり、偽の完了を注入されないため。
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr === null || typeof addr === 'string') {
          // 不変条件違反（listen のコールバックまで来て address() が無い）。
          // 実運用では起きない開発者向けの診断なので訳さない。
          // start() の catch で総括文（write.errorSpawnFailed）が付き、
          // この文字列は detail として等幅で出る。
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
        // 昇格経路では this.child は PowerShell のラッパーで、実際に書いているのは
        // AppInfo が起こした別プロセス。キャンセル時に落とすべきはこちら。
        this.workerPid = msg.pid
        this.setStatus({ state: 'preparing', message: localized('write.statusStarted') })
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
        // 三項で state を決めて `as WriteStatus` で押し込んでいた。
        // 'cancelled' は message も detail も持たない状態なので、
        // アサーションが食い違いを隠していた（型を直すと必ず露出する）。
        if (msg.name === 'WriteCancelledError') {
          this.setStatus({ state: 'cancelled' })
        } else {
          this.setStatus({ state: 'error', message: msg.message, detail: msg.detail })
        }
        void this.cleanup()
        break
      case 'log':
        if (this.status.state === 'preparing') {
          this.setStatus({ state: 'preparing', message: msg.text })
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
      if (cancelledByUser) {
        this.setStatus({ state: 'cancelled' })
        void this.cleanup()
        return
      }
      // 昇格を断られたケースは「異常終了」ではなくユーザーの選択なので、
      // OS の生のエラー文ではなく次にすべきことだけを出す。
      // （Windows の Start-Process は UAC 拒否で InvalidOperationException を吐く）
      if (isElevationDeclined(stderr)) {
        // 次にすべきことだけを出す。生の PowerShell 例外は見せない。
        this.setStatus({
          state: 'error',
          message: localized('write.errorElevationDeclined'),
          detail: null,
        })
        void this.cleanup()
        return
      }
      // stderr があればそれが開発者向けの詳細。無ければ「次にすること」を総括文に畳む
      // （案内文を detail に置くと、等幅の診断欄に利用者向けの文が出てしまう）。
      const raw = stderr.trim()
      this.setStatus({
        state: 'error',
        message: raw
          ? localized('write.errorWorkerExited', { code })
          : localized('write.errorWorkerExitedNoOutput', { code }),
        detail: raw || null,
      })
      void this.cleanup()
    })
    child.on('error', (err) => {
      this.setStatus({
        state: 'error',
        message: localized('write.errorSpawnFailed'),
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
    this.clearKillTimer()
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
 * キャンセル時に落とすべき pid と、「本当に止められたか」を決める。
 *
 * 昇格経路では `child` は PowerShell のラッパーで、実際に USB を書いているのは
 * UAC の AppInfo サービスが起こした別プロセス（`hello` が pid を知らせてくる）。
 * ラッパーは自分の子なので taskkill が必ず成功し、その成否を採ると
 * **ワーカーが書き続けているのに「止めました」と表示してしまう**。
 * 判断はワーカー本体の pid の結果だけで行う。
 */
export function planKill(
  workerPid: number | null,
  wrapperPid: number | null,
): { targets: number[]; decisive: number | null } {
  const targets = [workerPid, wrapperPid].filter(
    (x): x is number => typeof x === 'number' && x > 0,
  )
  // 重複（昇格済みで直接 spawn した場合は同じ pid）は 1 回でよい
  const unique = [...new Set(targets)]
  return { targets: unique, decisive: unique.length === 0 ? null : (workerPid ?? wrapperPid ?? null) }
}

/** taskkill の終了コードを「止められたか」に翻訳する。 */
export function taskkillMeansStopped(code: number | null): boolean {
  // 0 = 落とした / 128 = そんなプロセスは無い（既に終了している＝目的は達成）
  // 1 = アクセス拒否など。昇格ワーカーはここに来るので、成功と見なしてはいけない。
  return code === 0 || code === 128
}

/**
 * プロセスツリーごと終了させる。
 * Windows では child.kill() が孫プロセスを取り残す（昇格した実体は孫になる）。
 */
/**
 * プロセスツリーを落とす。**成功するとは限らない。**
 *
 * Windows では、昇格したワーカーは高整合性プロセスなので、通常権限の
 * このプロセスからは PROCESS_TERMINATE を開けず taskkill が必ず失敗する。
 * さらに UAC 昇格プロセスは AppInfo サービスが起こすため powershell の
 * 子孫ツリーにも入っておらず `/T` でも辿れない。
 * 落とせたかどうかを呼び出し側に返し、落とせなければユーザーに伝える。
 */
function killTree(pid: number): Promise<boolean> {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL')
      return Promise.resolve(true)
    } catch (err) {
      // ESRCH は「既に終了している」= 目的は達成。
      // EPERM は「権限が無くて落とせない」= 失敗。Linux の pkexec / macOS の
      // osascript ではワーカーが root なので、これを成功と見なすと必ず嘘になる。
      const code = (err as NodeJS.ErrnoException).code
      return Promise.resolve(code === 'ESRCH')
    }
  }
  return new Promise((resolve) => {
    const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    child.on('error', () => resolve(false))
    // 終了コードの意味は taskkillMeansStopped に集約してある。
    child.on('exit', (code) => resolve(taskkillMeansStopped(code)))
  })
}

/**
 * 昇格をユーザーが断ったか。
 *
 * OS ごとに出るメッセージが違ううえ、Windows では OS の言語で出るので
 * 文字列一致は使えない。各プラットフォームの「拒否」に固有の識別子で判定する。
 *   Windows : Start-Process が InvalidOperationException を投げる
 *             (FullyQualifiedErrorId が StartProcessCommand)
 *   macOS   : osascript が -128 (User canceled)
 *   Linux   : pkexec が 126 (認証できなかった / ダイアログを閉じた)
 */
export function isElevationDeclined(stderr: string): boolean {
  if (/InvalidOperationException,Microsoft\.PowerShell\.Commands\.StartProcessCommand/.test(stderr)) {
    return true
  }
  if (/\(-128\)|execution error: .*\(-128\)/.test(stderr)) return true
  if (/pkexec must be setuid|Error executing command as another user|Request dismissed/.test(stderr)) {
    return true
  }
  return false
}
