import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { FileBlockDevice, buildIsoPatches, inspectIso, minimumDiskSize, IsoValidationError } from '@autoinstall/media'
import {
  SERIES_CATALOG,
  parseSha256Sums,
  recognizeIso,
  type ChecksumResult,
  type IsoFileInfo,
  type IsoOpenResult,
} from '@autoinstall/shared'

// ISO ファイルの検査とチェックサム確認。ネットワークアクセスは main 側でのみ行う
// （packaged app の CSP は connect-src 'self' なので renderer からは外部に出られない）。

export async function openIso(path: string): Promise<IsoOpenResult> {
  let dev: FileBlockDevice | null = null
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      return { ok: false, reason: 'not-a-file', detail: 'ファイルではありません。' }
    }
    dev = await FileBlockDevice.open(path, 'r')
    const inspection = await inspectIso(dev)

    const recognized = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
    if (recognized.kind !== 'supported') {
      const detail =
        recognized.reason === 'not-ubuntu'
          ? `Ubuntu の ISO ではないようです（ボリューム名: ${recognized.detail}）。`
          : recognized.reason === 'not-server'
            ? `Ubuntu Server の live-server 版ではないようです（ボリューム名: ${recognized.detail}）。Desktop 版や他のフレーバーには対応していません。`
            : `対応していないバージョンです（${recognized.detail}）。`
      return { ok: false, reason: recognized.reason, detail }
    }

    const patchPlan = buildIsoPatches(inspection, { args: ['autoinstall'], markTitle: true })

    const result: IsoFileInfo = {
      path,
      fileName: basename(path),
      sizeBytes: inspection.sizeBytes,
      volumeId: inspection.volumeId,
      diskInfo: inspection.diskInfo,
      identity: recognized.identity,
      grubCfg: inspection.grubCfg.text,
      patchedGrubCfg: patchPlan.newGrubCfg,
      casperFiles: inspection.casperFiles,
      minimumDeviceBytes: minimumDiskSize(inspection.sizeBytes),
    }
    return { ok: true, info: result }
  } catch (err) {
    if (err instanceof IsoValidationError) {
      return { ok: false, reason: err.reason, detail: err.message }
    }
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return { ok: false, reason: 'not-found', detail: 'ファイルが見つかりません。' }
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      return { ok: false, reason: 'permission', detail: 'ファイルを読む権限がありません。' }
    }
    return { ok: false, reason: 'unknown', detail: (err as Error).message }
  } finally {
    await dev?.close().catch(() => undefined)
  }
}

/** ISO の SHA-256 を計算し、可能なら公式の SHA256SUMS と照合する。 */
export async function computeChecksum(
  path: string,
  onProgress?: (bytesDone: number, bytesTotal: number) => void,
  signal?: AbortSignal,
): Promise<ChecksumResult> {
  const info = await stat(path)
  const hash = createHash('sha256')
  let done = 0
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { highWaterMark: 8 * 1024 * 1024 })
    const abort = (): void => {
      stream.destroy(new Error('cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    stream.on('data', (chunk) => {
      hash.update(chunk)
      done += chunk.length
      onProgress?.(done, info.size)
    })
    stream.on('end', () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    })
    stream.on('error', (err) => {
      signal?.removeEventListener('abort', abort)
      reject(err)
    })
  })
  const sha256 = hash.digest('hex')

  const verification = await verifyAgainstOfficial(path, sha256)
  return { sha256, official: verification.official, officialSource: verification.source }
}

/** releases.ubuntu.com の SHA256SUMS と突き合わせる。取得できなければ `unknown`。 */
async function verifyAgainstOfficial(
  path: string,
  sha256: string,
): Promise<{ official: ChecksumResult['official']; source: string | null }> {
  const fileName = basename(path)
  // ファイル名からリリースディレクトリを推測する（ubuntu-24.04.4-live-server-amd64.iso）
  const m = /^ubuntu-(\d+\.\d+)(?:\.\d+)?-live-server-(amd64|arm64)\.iso$/.exec(fileName)
  if (!m) return { official: 'unknown', source: null }
  const series = m[1]!
  const entry = Object.values(SERIES_CATALOG).find((c) => c.series === series)
  if (!entry) return { official: 'unknown', source: null }
  const url = `${entry.releaseDir}SHA256SUMS`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { official: 'unknown', source: null }
    const sums = parseSha256Sums(await res.text())
    const expected = sums.get(fileName)
    if (!expected) return { official: 'unknown', source: url }
    return { official: expected === sha256 ? 'match' : 'mismatch', source: url }
  } catch {
    // オフラインや DNS 失敗。照合できなかっただけで、エラーにはしない。
    return { official: 'unknown', source: null }
  }
}
