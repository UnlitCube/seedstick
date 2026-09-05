import { createHash } from 'node:crypto'
import { localized, type LocalizedText } from '@autoinstall/shared'
import { SECTOR_SIZE, type BlockDevice } from '../blockdev/index.js'
import { applyPatchesToChunk, type Patch } from '../isopatch/index.js'
import type { UsbLayoutPlan, WriteOp } from '../layout/plan.js'

// 書き込み計画（WriteScript）を実行し、進捗を報告し、書き戻して検証する。
// デバイスに触るのはここだけ。レイアウトの正しさは plan.ts 側でテスト済み。

/** 512 バイト単位のアラインメントが必要なデバイス（Windows の \\.\PhysicalDrive）向けのバッファ長。 */
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024

export type WritePhase = 'writing' | 'flushing' | 'verifying' | 'done'

export interface WriteProgress {
  readonly phase: WritePhase
  readonly bytesDone: number
  readonly bytesTotal: number
  /**
   * 今どの手順を実行しているか（UI にそのまま出す）。
   * ここは利用者の言語を知らない（昇格ワーカーは別プロセス）ので訳さずに運ぶ。
   */
  readonly label: LocalizedText
  /** 直近の実測速度 (bytes/sec)。まだ測れていなければ null。 */
  readonly bytesPerSecond: number | null
  /** 残り秒数の見積もり。測れていなければ null。 */
  readonly etaSeconds: number | null
}

export interface WriteResult {
  /** 書き込んだ全バイトの SHA-256（ISO 本体 + CIDATA + テーブル） */
  readonly digest: string
  readonly bytesWritten: number
  readonly verified: boolean
  readonly elapsedMs: number
}

export class WriteCancelledError extends Error {
  /**
   * 画面には出ない（write-supervisor が state を 'cancelled' に落とし、
   * renderer は `write.cancelled` / `write.cancelledBody` を描く）が、
   * 経路が変わっても意味が落ちないように文言も持たせておく。
   */
  readonly text: LocalizedText = localized('write.cancelledBody')

  constructor() {
    super('書き込みがキャンセルされました。USB メモリの内容は壊れています。作り直してください。')
    this.name = 'WriteCancelledError'
  }
}

export class VerificationError extends Error {
  constructor(
    /** 開発者向けの生の文言（どの手順のどこで食い違ったか）。日本語のまま残す。 */
    message: string,
    readonly diskOffset: number,
    /** 画面に出す文言。訳すのは renderer。 */
    readonly text: LocalizedText,
  ) {
    super(message)
    this.name = 'VerificationError'
  }
}

export interface ExecuteOptions {
  readonly plan: UsbLayoutPlan
  readonly isoDevice: BlockDevice
  readonly targetDevice: BlockDevice
  readonly patches: readonly Patch[]
  readonly onProgress?: (p: WriteProgress) => void
  readonly signal?: AbortSignal
  readonly chunkSize?: number
  /** 書き戻して照合するか。既定 true。 */
  readonly verify?: boolean
  /** 現在時刻（経過時間の計測に使う。テストで固定できるようにする） */
  readonly now?: () => number
}

interface RangeDigest {
  readonly diskOffset: number
  readonly length: number
  readonly sha256: string
  readonly label: LocalizedText
}

function opLength(op: WriteOp): number {
  return op.kind === 'bytes' ? op.data.length : op.length
}

interface ByteRange {
  readonly start: number
  readonly end: number
}

/**
 * ある op が書いたバイトのうち、後続の op に上書きされずに残る範囲を求める。
 *
 * 手順の最初で LBA 0 をゼロにし、最後に MBR を書くので、この 2 つは同じ範囲を書く。
 * 検証時に「書いた直後の内容」と比較すると当然食い違うため、
 * 生き残る範囲だけをハッシュ対象にする必要がある。
 */
export function survivingRanges(
  op: { diskOffset: number; length: number },
  laterOps: readonly { diskOffset: number; length: number }[],
): ByteRange[] {
  let ranges: ByteRange[] = [{ start: op.diskOffset, end: op.diskOffset + op.length }]
  for (const later of laterOps) {
    const ls = later.diskOffset
    const le = later.diskOffset + later.length
    const next: ByteRange[] = []
    for (const r of ranges) {
      if (le <= r.start || ls >= r.end) {
        next.push(r)
        continue
      }
      if (ls > r.start) next.push({ start: r.start, end: ls })
      if (le < r.end) next.push({ start: le, end: r.end })
    }
    ranges = next
    if (ranges.length === 0) break
  }
  return ranges
}

/**
 * 512 バイト境界に揃っていることを確認する。
 * Windows の `\\.\PhysicalDriveN` はセクタ境界・セクタ長でしか書けず、
 * 違反すると EINVAL になる（原因が分かりにくいので事前に弾く）。
 */
function assertAligned(op: WriteOp): void {
  const len = opLength(op)
  if (op.diskOffset % SECTOR_SIZE !== 0 || len % SECTOR_SIZE !== 0) {
    // 不変条件違反（＝こちらのバグ）なので訳さない。
    // ただし `op.label` は LocalizedText なので、そのまま埋めると "[object Object]" になる。
    // 手順を識別できればよいのでキーを出す。
    throw new Error(
      `書き込みがセクタ境界に揃っていません: "${op.label.key}" offset=${op.diskOffset} length=${len}`,
    )
  }
}

export async function executeWritePlan(options: ExecuteOptions): Promise<WriteResult> {
  const { plan, isoDevice, targetDevice, patches } = options
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const now = options.now ?? (() => Date.now())
  const verify = options.verify ?? true
  const startedAt = now()

  const allOps = [...plan.ops, ...plan.finalOps]
  for (const op of allOps) assertAligned(op)

  const total = plan.totalBytes
  let done = 0
  const overall = createHash('sha256')
  const ranges: RangeDigest[] = []
  let lastReport = 0
  let lastReportBytes = 0
  let speed: number | null = null

  const check = (): void => {
    if (options.signal?.aborted) throw new WriteCancelledError()
  }

  const report = (phase: WritePhase, label: LocalizedText, force = false): void => {
    if (!options.onProgress) return
    const t = now()
    if (!force && t - lastReport < 200) return
    if (lastReport > 0 && t > lastReport) {
      const inst = ((done - lastReportBytes) * 1000) / (t - lastReport)
      // 指数移動平均で速度を滑らかにする（USB は書き込み速度が大きく揺れる）
      speed = speed === null ? inst : speed * 0.7 + inst * 0.3
    }
    lastReport = t
    lastReportBytes = done
    options.onProgress({
      phase,
      bytesDone: done,
      bytesTotal: total,
      label,
      bytesPerSecond: speed,
      etaSeconds: speed && speed > 0 ? Math.max(0, (total - done) / speed) : null,
    })
  }

  const writeChunked = async (
    diskOffset: number,
    length: number,
    produce: (offsetInOp: number, len: number) => Promise<Buffer>,
    label: LocalizedText,
    survives: readonly ByteRange[],
  ): Promise<void> => {
    // 生き残る範囲ごとにハッシュを取る（あとで読み戻して照合する）
    const hashes = survives.map(() => createHash('sha256'))
    for (let pos = 0; pos < length; pos += chunkSize) {
      check()
      const len = Math.min(chunkSize, length - pos)
      const buf = await produce(pos, len)
      const abs = diskOffset + pos
      await targetDevice.write(abs, buf)
      overall.update(buf)
      survives.forEach((r, i) => {
        const from = Math.max(abs, r.start)
        const to = Math.min(abs + len, r.end)
        if (from < to) hashes[i]!.update(buf.subarray(from - abs, to - abs))
      })
      done += len
      report('writing', label)
    }
    survives.forEach((r, i) => {
      ranges.push({
        diskOffset: r.start,
        length: r.end - r.start,
        sha256: hashes[i]!.digest('hex'),
        label,
      })
    })
  }

  const runOp = async (op: WriteOp, survives: readonly ByteRange[]): Promise<void> => {
    switch (op.kind) {
      case 'copy-iso':
        await writeChunked(
          op.diskOffset,
          op.length,
          async (pos, len) => {
            const buf = await isoDevice.read(op.isoOffset + pos, len)
            // ISO ファイルは変更せず、コピー中のバッファにだけパッチを当てる
            applyPatchesToChunk(buf, op.isoOffset + pos, patches)
            return buf
          },
          op.label,
          survives,
        )
        break
      case 'bytes': {
        // 大きなバッファでも一定サイズに切って書く（Windows のドライバが巨大な書き込みで失敗することがある）
        await writeChunked(
          op.diskOffset,
          op.data.length,
          (pos, len) => Promise.resolve(op.data.subarray(pos, pos + len)),
          op.label,
          survives,
        )
        break
      }
      case 'zero': {
        const zero = Buffer.alloc(Math.min(chunkSize, op.length))
        await writeChunked(
          op.diskOffset,
          op.length,
          (_pos, len) => Promise.resolve(len === zero.length ? zero : Buffer.alloc(len)),
          op.label,
          survives,
        )
        break
      }
    }
  }

  const geometry = allOps.map((op) => ({ diskOffset: op.diskOffset, length: opLength(op) }))
  const survivingFor = (index: number): ByteRange[] =>
    survivingRanges(geometry[index]!, geometry.slice(index + 1))

  const verifyRanges = async (targets: readonly RangeDigest[]): Promise<void> => {
    if (!verify || targets.length === 0) return
    report('verifying', localized('writeOp.verifying'), true)
    for (const r of targets) {
      check()
      const h = createHash('sha256')
      for (let pos = 0; pos < r.length; pos += chunkSize) {
        const len = Math.min(chunkSize, r.length - pos)
        h.update(await targetDevice.read(r.diskOffset + pos, len))
      }
      if (h.digest('hex') !== r.sha256) {
        throw new VerificationError(
          // 開発者向けの生の文言。`r.label` は LocalizedText なのでキーを出す
          // （そのまま埋めると "[object Object]" になる）。
          `書き込み結果が一致しません: ${r.label.key} (オフセット ${r.diskOffset})。USB メモリが故障しているか、書き込み中に抜かれた可能性があります。`,
          r.diskOffset,
          localized('write.verifyMismatch', { offset: r.diskOffset }),
        )
      }
    }
  }

  for (const [i, op] of plan.ops.entries()) await runOp(op, survivingFor(i))

  report('flushing', localized('writeOp.flushing'), true)
  await targetDevice.flush()

  // 本体の照合は**パーティションテーブルを書く前**に済ませる。
  //
  // 実機で判明した問題: パーティションテーブルを書いた瞬間に Windows がディスクを
  // 再スキャンし、CIDATA (FAT) を自動マウントして `System Volume Information` を作る。
  // その結果、正常に書けた USB でも読み戻しハッシュが一致せず「書き込みに失敗しました」に
  // なっていた。ここまではディスクに有効なパーティションテーブルが無い（最初の op で
  // LBA0 をゼロにしている）ので、OS はマウントできず、書いたバイトがそのまま読み戻せる。
  const bodyRanges = ranges.slice()
  await verifyRanges(bodyRanges)

  // パーティションテーブルは最後に書く。ここまでに中断された USB は起動しない。
  for (const [i, op] of plan.finalOps.entries()) {
    await runOp(op, survivingFor(plan.ops.length + i))
  }
  await targetDevice.flush()

  // テーブル自体の照合。OS はマウント時にここへは書かないので、書いた直後で問題ない。
  await verifyRanges(ranges.slice(bodyRanges.length))
  const verified = verify

  report('done', localized('write.done'), true)
  return {
    digest: overall.digest('hex'),
    bytesWritten: done,
    verified,
    elapsedMs: now() - startedAt,
  }
}
