import { open, type FileHandle } from 'node:fs/promises'
import { localized, type LocalizedText } from '@autoinstall/shared'
import { SECTOR_SIZE, type BlockDevice } from './index.js'

// 物理デバイス (\\.\PhysicalDriveN, /dev/rdiskN, /dev/sdX) への読み書き。
//
// Windows の落とし穴: `\\.\PhysicalDriveN` はセクタ境界・セクタ長でしか読み書きできない。
// 揃っていないと EINVAL になり、しかもエラーメッセージから原因が分からない。
// そのため読み書きの前後で必ずセクタ境界に丸め、必要なら read-modify-write する。

/**
 * デバイスへの書き込みが 1 バイトも進まなくなった。
 *
 * `RawBlockDevice` はアプリ本体で USB を書く唯一の実装（落とし穴 32）なので、
 * ここで投げた例外は昇格ワーカー → NDJSON → `WriteStatus.message` と辿って
 * **そのまま画面に出る**。実運用で最も起きやすい失敗（書き込み中に USB を抜いた）
 * なので、利用者向けの文言を `text` で運ぶ。
 * `message` の方はオフセット付きの開発者向け診断で、日本語のまま残す。
 */
export class DeviceWriteStalledError extends Error {
  readonly text: LocalizedText = localized('write.deviceStalled')

  constructor(readonly offset: number) {
    super(`write to the device made no progress (offset=${offset}). The USB drive may have been removed.`)
    this.name = 'DeviceWriteStalledError'
  }
}

export interface RawDeviceOptions {
  /** デバイスの論理セクタサイズ。既定 512。4Kn デバイスでは 4096。 */
  readonly sectorSize?: number
  /** 明示的にサイズを指定する（Windows ではデバイスの stat がサイズを返さないため必須） */
  readonly sizeBytes: number
}

export class RawBlockDevice implements BlockDevice {
  private constructor(
    private readonly handle: FileHandle,
    readonly size: number,
    private readonly sectorSize: number,
  ) {}

  static async open(path: string, options: RawDeviceOptions): Promise<RawBlockDevice> {
    const sectorSize = options.sectorSize ?? SECTOR_SIZE
    // 'r+' は既存デバイスを truncate せずに開く。'w' を使うと Windows でデバイスを壊しうる。
    const handle = await open(path, 'r+')
    return new RawBlockDevice(handle, options.sizeBytes, sectorSize)
  }

  private alignDown(n: number): number {
    return n - (n % this.sectorSize)
  }

  private alignUp(n: number): number {
    const r = n % this.sectorSize
    return r === 0 ? n : n + (this.sectorSize - r)
  }

  async read(offset: number, length: number): Promise<Buffer> {
    const start = this.alignDown(offset)
    const end = this.alignUp(offset + length)
    const aligned = Buffer.allocUnsafe(end - start)
    let read = 0
    while (read < aligned.length) {
      const { bytesRead } = await this.handle.read(aligned, read, aligned.length - read, start + read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    if (read < aligned.length) aligned.fill(0, read)
    return aligned.subarray(offset - start, offset - start + length)
  }

  async write(offset: number, data: Buffer): Promise<void> {
    const headPad = offset % this.sectorSize
    const totalLength = headPad + data.length
    const tailPad = (this.sectorSize - (totalLength % this.sectorSize)) % this.sectorSize

    if (headPad === 0 && tailPad === 0) {
      await this.writeAligned(offset, data)
      return
    }
    // 部分セクタは read-modify-write する。ここを省くと Windows で EINVAL になる。
    const start = offset - headPad
    const buf = Buffer.allocUnsafe(totalLength + tailPad)
    if (headPad > 0) {
      const head = await this.readAligned(start, this.sectorSize)
      head.copy(buf, 0)
    }
    if (tailPad > 0) {
      const lastSectorStart = start + buf.length - this.sectorSize
      const tail = await this.readAligned(lastSectorStart, this.sectorSize)
      tail.copy(buf, buf.length - this.sectorSize)
    }
    data.copy(buf, headPad)
    await this.writeAligned(start, buf)
  }

  private async readAligned(offset: number, length: number): Promise<Buffer> {
    const buf = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const { bytesRead } = await this.handle.read(buf, read, length - read, offset + read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    return buf
  }

  private async writeAligned(offset: number, data: Buffer): Promise<void> {
    let written = 0
    while (written < data.length) {
      const { bytesWritten } = await this.handle.write(
        data,
        written,
        data.length - written,
        offset + written,
      )
      if (bytesWritten === 0) throw new DeviceWriteStalledError(offset + written)
      written += bytesWritten
    }
  }

  async flush(): Promise<void> {
    // Windows のデバイスハンドルでは fsync が EINVAL を返すことがあるが、
    // その場合もハンドルを閉じた時点で書き込みは確定するので無視してよい。
    await this.handle.sync().catch(() => undefined)
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}
