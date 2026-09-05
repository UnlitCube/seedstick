import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { FileBlockDevice, buildIsoPatches, inspectIso, minimumDiskSize, IsoValidationError } from '@autoinstall/media'
import {
  SERIES_CATALOG,
  parseSha256Sums,
  recognizeIso,
  localized,
  type ChecksumResult,
  type IsoFileInfo,
  type IsoOpenResult,
  type LocalizedText,
  type MsgKey,
} from '@autoinstall/shared'

// ISO ファイルの検査とチェックサム確認。ネットワークアクセスは main 側でのみ行う
// （packaged app の CSP は connect-src 'self' なので renderer からは外部に出られない）。

/**
 * 認識できなかった ISO の理由を、renderer が訳せる形にする。
 *
 * `detail` は文言ではなく**生のボリューム ID / バージョン文字列**なので、
 * そのまま差し込み値にしてよい（訳す対象ではない）。
 *
 * ここを通すのは、実 ISO を用意せずに分岐を試せるようにするため。
 */
export function unsupportedIsoText(
  reason: 'not-ubuntu' | 'not-server' | 'unknown-series',
  detail: string,
): LocalizedText {
  if (reason === 'not-ubuntu') return localized('iso.rejectNotUbuntu', { volumeId: detail })
  if (reason === 'not-server') return localized('iso.notServer', { volumeId: detail })
  return localized('iso.unknownSeries', { version: detail })
}

/**
 * `IsoValidationError` の理由（ISO の構造が想定と違う）ごとの文言。
 *
 * `satisfies Record<IsoValidationError['reason'], MsgKey>` にしてあるので、
 * `@autoinstall/media` 側の union に理由を 1 つ足すと**ここがコンパイルエラーになる**。
 * 一律 `iso.unsupported` に潰すと、Callout のタイトルと本文が同じ文字列になり、
 * 意味のある情報が開発者向けの `detail` にしか残らない（実際にそう退行した）。
 *
 * 訳文に**数値やオフセットを入れない**。それらは生の `err.message` として
 * `detail` に等幅で出る。訳文が伝えるのは「何が起きたか」と「次に何をするか」だけ。
 */
const INVALID_ISO_KEYS = {
  'not-iso9660': 'iso.rejectNotIso9660',
  'no-casper': 'iso.rejectNoCasper',
  'no-grub-cfg': 'iso.rejectNoGrubCfg',
  'no-kernel-line': 'iso.rejectNoKernelLine',
  'grub-too-large': 'iso.rejectGrubTooLarge',
} satisfies Record<IsoValidationError['reason'], MsgKey>

/**
 * 構造を理由に拒否した ISO の説明を、renderer が訳せる形にする。
 *
 * 実 ISO を用意せずに 5 分岐を試せるように export している。
 */
export function invalidIsoText(reason: IsoValidationError['reason']): LocalizedText {
  // 型の上では網羅しているが、`reason` は別パッケージから来る文字列なので、
  // 版がずれた場合に `undefined` を訳しに行かないように受け止める。
  // （この経路でも生の `err.message` は `detail` に残る）
  const key: MsgKey | undefined = INVALID_ISO_KEYS[reason]
  return localized(key ?? 'iso.unsupported')
}

export async function openIso(path: string): Promise<IsoOpenResult> {
  let dev: FileBlockDevice | null = null
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      return { ok: false, reason: 'not-a-file', text: localized('iso.rejectNotAFile'), detail: null }
    }
    dev = await FileBlockDevice.open(path, 'r')
    const inspection = await inspectIso(dev)

    const recognized = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
    if (recognized.kind !== 'supported') {
      return {
        ok: false,
        reason: recognized.reason,
        text: unsupportedIsoText(recognized.reason, recognized.detail),
        detail: null,
      }
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
      // 壊れた ISO の内部構造（オフセット・バイト数）は**開発者向けの診断**なので訳さない。
      // 訳した総括文 + 生の詳細の 2 本立てにして、詳細は等幅で出してもらう。
      // 総括文は理由ごとに変える。一律にすると Callout のタイトルと本文が同じになる。
      return { ok: false, reason: err.reason, text: invalidIsoText(err.reason), detail: err.message }
    }
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return { ok: false, reason: 'not-found', text: localized('iso.rejectNotFound'), detail: null }
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      return { ok: false, reason: 'permission', text: localized('iso.rejectPermission'), detail: null }
    }
    // 想定していない失敗。原因は分からないので、生のメッセージを詳細として添える。
    return { ok: false, reason: 'unknown', text: localized('error.unknown'), detail: (err as Error).message }
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
