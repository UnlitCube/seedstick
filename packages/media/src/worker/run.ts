import { connect, type Socket } from 'node:net'
import { FileBlockDevice } from '../blockdev/index.js'
import { RawBlockDevice } from '../blockdev/raw.js'
import { buildIsoPatches, inspectIso } from '../isopatch/index.js'
import { planUsbLayout } from '../layout/plan.js'
import { executeWritePlan } from '../writer/execute.js'
import { getPlatformOps, type PlatformOps } from '../platform/index.js'
import { encodeMessage, decodeMessages, type ControlMessage, type WorkerJob, type WorkerMessage } from './protocol.js'

// 昇格プロセス側の本体。ジョブ JSON を受け取り、USB に書いて、進捗を TCP で親に返す。
// GUI からは切り離されているので、Electron に一切依存しない。

/** ジョブの patches は base64 なので Buffer に戻す。 */
function decodePatches(job: WorkerJob): { offset: number; data: Buffer; label: string }[] {
  return job.patches.map((p) => ({
    offset: p.offset,
    data: Buffer.from(p.data, 'base64'),
    label: p.label,
  }))
}

function seedFilesOf(job: WorkerJob): { name: string; content: Buffer }[] {
  return job.seedFiles.map((f) => ({ name: f.name, content: Buffer.from(f.content, 'base64') }))
}

/** 決定的な擬似乱数（ジョブに埋め込んだ種から作る。再実行で同じ USB ができる）。 */
function seededRandom(seedBase64: string): (n: number) => Buffer {
  const seed = Buffer.from(seedBase64, 'base64')
  let counter = 0
  return (n: number) => {
    const out = Buffer.allocUnsafe(n)
    for (let i = 0; i < n; i++) {
      out[i] = (seed[(i + counter) % Math.max(1, seed.length)] ?? 0) ^ ((i * 31 + counter) & 0xff)
    }
    counter += n
    return out
  }
}

export interface WorkerReporter {
  send(msg: WorkerMessage): void
  onControl(handler: (msg: ControlMessage) => void): void
  close(): void
}

/** 親プロセスへ NDJSON を送る TCP 接続を作る。 */
export function connectReporter(port: number, token: string): Promise<WorkerReporter> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ port, host: '127.0.0.1' }, () => {
      let buffer = ''
      let controlHandler: ((msg: ControlMessage) => void) | null = null
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        buffer += chunk
        const { messages, rest } = decodeMessages(buffer, token)
        buffer = rest
        for (const m of messages) {
          if ('type' in m && m.type === 'cancel' && controlHandler) controlHandler(m)
        }
      })
      resolve({
        send: (msg) => {
          if (!socket.destroyed) socket.write(encodeMessage(msg, token))
        },
        onControl: (h) => {
          controlHandler = h
        },
        close: () => socket.end(),
      })
    })
    socket.on('error', reject)
  })
}

/**
 * 昇格側でのデバイス再検証。
 *
 * 通常権限の GUI は `classifyDevice()` を通ったものしか選ばせないが、
 * その判定は**通常権限のプロセス**の中にしかない。ジョブ JSON は
 * ユーザーが書ける場所に置かれ、UAC の確認が出ている間に差し替えられる。
 * 差し替えを検知しないと「ユーザーが押した『はい』」がそのままシステムディスクの
 * 破壊に化けるので、書く直前にもう一度確かめる。
 */
export class DeviceRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceRejectedError'
  }
}

async function assertDeviceIsWritable(platform: PlatformOps, job: WorkerJob): Promise<void> {
  const devices = await platform.listDevices()
  const found = devices.find((d) => d.id === job.devicePath)
  if (!found) {
    throw new DeviceRejectedError(
      `書き込み先 ${job.devicePath} が見つかりません。取り外されたか、書き込み対象として認められないデバイスです。`,
    )
  }
  if (!found.selectable) {
    throw new DeviceRejectedError(
      `${job.devicePath} には書き込めません: ${found.blockedReason ?? '対象外のデバイスです'}`,
    )
  }
  // サイズが食い違うと GPT のバックアップを書く位置がずれる。
  // 差し替えの兆候でもあるので厳密に一致を求める。
  if (found.sizeBytes !== job.deviceSizeBytes) {
    throw new DeviceRejectedError(
      `${job.devicePath} の容量が指示書と違います（指示 ${job.deviceSizeBytes} / 実際 ${found.sizeBytes}）。`,
    )
  }
  // デバイスノードは抜き差しで再利用される。容量が同じ別のディスクを
  // 誤って消さないよう、シリアルまで一致を求める。
  // 列挙でシリアルが取れない環境（一部の USB ブリッジ）では説明文で代用する。
  if (job.deviceSerial !== null && found.serial !== job.deviceSerial) {
    throw new DeviceRejectedError(
      `${job.devicePath} は選んだデバイスと違います（シリアル 指示 ${job.deviceSerial} / 実際 ${found.serial ?? '不明'}）。` +
        '取り外して挿し直したか、別のデバイスに入れ替わっています。もう一度選び直してください。',
    )
  }
  if (job.deviceSerial === null && found.description !== job.deviceDescription) {
    throw new DeviceRejectedError(
      `${job.devicePath} は選んだデバイスと違います（指示 "${job.deviceDescription}" / 実際 "${found.description}"）。`,
    )
  }
}

/** ジョブを実行する。例外は呼び出し側で捕まえてエラーメッセージとして送る。 */
export async function runWorkerJob(job: WorkerJob, reporter: WorkerReporter): Promise<void> {
  const controller = new AbortController()
  reporter.onControl((msg) => {
    if (msg.jobId === job.jobId) controller.abort()
  })
  reporter.send({ type: 'hello', jobId: job.jobId, pid: process.pid })

  const platform = getPlatformOps()
  const iso = await FileBlockDevice.open(job.isoPath, 'r')
  let target: RawBlockDevice | null = null
  try {
    const inspection = await inspectIso(iso)
    reporter.send({
      type: 'log',
      jobId: job.jobId,
      level: 'info',
      message: `ISO を認識しました: ${inspection.volumeId}`,
    })

    // patches は親側で作ったものをそのまま使う（親が画面に見せた内容と 1 バイトも違わないことを保証する）
    const patches = job.patches.length > 0 ? decodePatches(job) : buildIsoPatches(inspection, { args: ['autoinstall'] }).patches

    const plan = await planUsbLayout({
      isoDevice: iso,
      diskSizeBytes: job.deviceSizeBytes,
      patches,
      seedFiles: seedFilesOf(job),
      cidataSizeBytes: job.cidataSizeBytes,
      random: seededRandom(job.randomSeedBase64),
      timestamp: new Date(job.timestampIso),
      hideIsoPartitionFromWindows: job.hideIsoPartitionFromWindows,
    })

    // ジョブファイルは通常権限のユーザーが書ける場所にあるので、
    // 昇格側でもう一度デバイスを列挙して「書いてよい相手か」を確かめる。
    // UAC の確認が出ている隙にジョブを差し替えられても、ここで止まる。
    await assertDeviceIsWritable(platform, job)

    reporter.send({
      type: 'log',
      jobId: job.jobId,
      level: 'info',
      message: 'デバイスのマウントを解除しています',
    })
    await platform.prepareForWrite(job.devicePath)

    target = await RawBlockDevice.open(job.devicePath, { sizeBytes: job.deviceSizeBytes })
    const result = await executeWritePlan({
      plan,
      isoDevice: iso,
      targetDevice: target,
      patches,
      verify: job.verify,
      signal: controller.signal,
      onProgress: (p) =>
        reporter.send({
          type: 'progress',
          jobId: job.jobId,
          phase: p.phase,
          bytesDone: p.bytesDone,
          bytesTotal: p.bytesTotal,
          label: p.label,
          bytesPerSecond: p.bytesPerSecond,
          etaSeconds: p.etaSeconds,
        }),
    })

    await target.close()
    target = null
    await platform.finishWrite(job.devicePath)

    reporter.send({
      type: 'done',
      jobId: job.jobId,
      digest: result.digest,
      bytesWritten: result.bytesWritten,
      verified: result.verified,
      elapsedMs: result.elapsedMs,
    })
  } finally {
    await target?.close().catch(() => undefined)
    await iso.close().catch(() => undefined)
  }
}
