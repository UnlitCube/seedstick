import { open, type FileHandle } from 'node:fs/promises'
import { readFileSync } from 'node:fs'

// 「バイト列をランダムアクセスで読み書きできる何か」の抽象。
// 実ファイル / 実デバイス / メモリ / 疎なテストフィクスチャを同じコードで扱うためにある。

export const SECTOR_SIZE = 512
export const ISO_SECTOR_SIZE = 2048

export interface BlockDevice {
  /** バイト数。書き込み専用の新規ファイルなど不明な場合は -1。 */
  readonly size: number
  read(offset: number, length: number): Promise<Buffer>
  write(offset: number, data: Buffer): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

/** バッファ全体がゼロか。8 バイト単位で見るので大きなバッファでも速い。 */
function isAllZero(buf: Buffer): boolean {
  const n = buf.length
  let i = 0
  for (; i + 8 <= n; i += 8) {
    if (buf.readBigUInt64LE(i) !== 0n) return false
  }
  for (; i < n; i++) {
    if (buf[i] !== 0) return false
  }
  return true
}

/** 読み取り専用デバイスに write が来たら即座に落とす（テストと安全策）。 */
export class ReadOnlyError extends Error {
  constructor(offset: number) {
    super(`読み取り専用デバイスへの書き込みが試みられました (offset=${offset})`)
    this.name = 'ReadOnlyError'
  }
}

/** 通常のファイル（ISO ファイル、生成した .img）。 */
export class FileBlockDevice implements BlockDevice {
  private constructor(
    private readonly handle: FileHandle,
    readonly size: number,
    private readonly readonlyMode: boolean,
  ) {}

  static async open(path: string, mode: 'r' | 'r+' | 'w+' = 'r'): Promise<FileBlockDevice> {
    const handle = await open(path, mode)
    const stat = await handle.stat()
    return new FileBlockDevice(handle, stat.size, mode === 'r')
  }

  async read(offset: number, length: number): Promise<Buffer> {
    const buf = Buffer.allocUnsafe(length)
    let read = 0
    while (read < length) {
      const { bytesRead } = await this.handle.read(buf, read, length - read, offset + read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    if (read < length) {
      // 末尾を超えた読み取りはゼロ埋めで返す（ISO 末尾のセクタ整合のため）
      buf.fill(0, read)
    }
    return buf
  }

  async write(offset: number, data: Buffer): Promise<void> {
    if (this.readonlyMode) throw new ReadOnlyError(offset)
    let written = 0
    while (written < data.length) {
      const { bytesWritten } = await this.handle.write(
        data,
        written,
        data.length - written,
        offset + written,
      )
      if (bytesWritten === 0) throw new Error(`書き込みが進みませんでした (offset=${offset + written})`)
      written += bytesWritten
    }
  }

  async flush(): Promise<void> {
    if (!this.readonlyMode) await this.handle.sync()
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

/** メモリ上の疎なブロックデバイス。テストで数 GB のイメージを扱うために使う。 */
export class MemoryBlockDevice implements BlockDevice {
  /** 4 MiB のチャンク単位で確保する */
  private static readonly CHUNK = 4 * 1024 * 1024
  private readonly chunks = new Map<number, Buffer>()

  constructor(readonly size: number) {}

  private chunkFor(index: number, create: boolean): Buffer | undefined {
    let c = this.chunks.get(index)
    if (!c && create) {
      c = Buffer.alloc(MemoryBlockDevice.CHUNK)
      this.chunks.set(index, c)
    }
    return c
  }

  read(offset: number, length: number): Promise<Buffer> {
    const out = Buffer.alloc(length)
    let done = 0
    while (done < length) {
      const abs = offset + done
      const idx = Math.floor(abs / MemoryBlockDevice.CHUNK)
      const within = abs % MemoryBlockDevice.CHUNK
      const n = Math.min(length - done, MemoryBlockDevice.CHUNK - within)
      const c = this.chunkFor(idx, false)
      if (c) c.copy(out, done, within, within + n)
      done += n
    }
    return Promise.resolve(out)
  }

  write(offset: number, data: Buffer): Promise<void> {
    let done = 0
    while (done < data.length) {
      const abs = offset + done
      const idx = Math.floor(abs / MemoryBlockDevice.CHUNK)
      const within = abs % MemoryBlockDevice.CHUNK
      const n = Math.min(data.length - done, MemoryBlockDevice.CHUNK - within)
      const slice = data.subarray(done, done + n)
      // 未確保のチャンクにゼロを書いても読み出し結果は変わらないので確保しない。
      // これで数 GB のイメージをメモリ上で丸ごと扱える（テストで実 ISO を書き込むのに必要）。
      const existing = this.chunkFor(idx, false)
      if (!existing && isAllZero(slice)) {
        done += n
        continue
      }
      const c = existing ?? this.chunkFor(idx, true)!
      slice.copy(c, within)
      done += n
    }
    return Promise.resolve()
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  /** 実際に書き込まれたチャンク数（疎であることの確認に使う） */
  get allocatedChunks(): number {
    return this.chunks.size
  }
}

// ---------------------------------------------------------------------------
// 疎なテストフィクスチャ
// ---------------------------------------------------------------------------

interface FixtureChunk {
  readonly offset: number
  readonly note: string
  /** base64 */
  readonly data: string
}

export interface IsoFixture {
  readonly url: string
  readonly size: number
  readonly volumeId: string
  readonly diskInfo: string
  readonly grubCfg: { readonly extent: number; readonly size: number }
  readonly chunks: readonly FixtureChunk[]
}

/**
 * 実 ISO から必要セクタだけを切り出したフィクスチャを読む読み取り専用デバイス。
 * 3 GB の ISO をダウンロードせずに、実データに対して ISO 解析・GPT 解析をテストできる。
 * フィクスチャに含まれない領域はゼロを返す（そこを読むコードがあればテストが落ちるので、それが検出になる）。
 */
export class SparseFixtureDevice implements BlockDevice {
  readonly size: number
  private readonly ranges: { start: number; end: number; data: Buffer }[]

  constructor(readonly fixture: IsoFixture) {
    this.size = fixture.size
    this.ranges = fixture.chunks
      .map((c) => {
        const data = Buffer.from(c.data, 'base64')
        return { start: c.offset, end: c.offset + data.length, data }
      })
      .sort((a, b) => a.start - b.start)
  }

  static fromFile(path: string): SparseFixtureDevice {
    return new SparseFixtureDevice(JSON.parse(readFileSync(path, 'utf8')) as IsoFixture)
  }

  /** そのオフセットが実データで裏付けられているか（テストの厳密性チェック用） */
  isBacked(offset: number, length: number): boolean {
    let pos = offset
    const end = offset + length
    while (pos < end) {
      const r = this.ranges.find((x) => pos >= x.start && pos < x.end)
      if (!r) return false
      pos = r.end
    }
    return true
  }

  read(offset: number, length: number): Promise<Buffer> {
    const out = Buffer.alloc(length)
    for (const r of this.ranges) {
      const from = Math.max(offset, r.start)
      const to = Math.min(offset + length, r.end)
      if (from < to) r.data.copy(out, from - offset, from - r.start, to - r.start)
    }
    return Promise.resolve(out)
  }

  write(offset: number): Promise<void> {
    return Promise.reject(new ReadOnlyError(offset))
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

/** 既存のデバイスに書き込みだけを別デバイスへ流す「コピーオンライト」。テストで改変結果を確認するのに使う。 */
export class OverlayBlockDevice implements BlockDevice {
  private readonly overlay: MemoryBlockDevice
  private readonly written: { start: number; end: number }[] = []

  constructor(private readonly base: BlockDevice, size = base.size) {
    this.size = size
    this.overlay = new MemoryBlockDevice(size)
  }

  readonly size: number

  async read(offset: number, length: number): Promise<Buffer> {
    const out = await this.base.read(offset, length)
    for (const w of this.written) {
      const from = Math.max(offset, w.start)
      const to = Math.min(offset + length, w.end)
      if (from < to) {
        const patch = await this.overlay.read(from, to - from)
        patch.copy(out, from - offset)
      }
    }
    return out
  }

  async write(offset: number, data: Buffer): Promise<void> {
    await this.overlay.write(offset, data)
    this.written.push({ start: offset, end: offset + data.length })
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  /** 書き込みが起きたバイト範囲（重複あり）。「余計なセクタを触っていない」ことの検証に使う。 */
  get writtenRanges(): readonly { start: number; end: number }[] {
    return this.written
  }
}
