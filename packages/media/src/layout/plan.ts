import { localized, type LocalizedText } from '@autoinstall/shared'
import { SECTOR_SIZE, type BlockDevice } from '../blockdev/index.js'
import {
  GPT_ATTR,
  PARTITION_TYPE,
  buildGpt,
  parseMbr,
  randomGuid,
  readGpt,
  updateProtectiveMbr,
  type GptImage,
  type GptPartitionEntry,
} from '../gpt/index.js'
import { buildFatImage, type FatFile } from '../fat/build.js'
import { assertPatchesDisjoint, type Patch } from '../isopatch/index.js'

// USB のレイアウトを決め、「どのオフセットに何を書くか」の完全な指示書（WriteScript）を作る。
//
// 書き込みは必ずこの指示書を通す。実際にデバイスを触るコード（writer）はこの指示書を
// 実行するだけにして、レイアウトの正しさを純粋な計算としてテストできるようにしている。

/** パーティションの開始は 1 MiB 境界に揃える（フラッシュメモリの消去ブロックに合わせる慣習）。 */
export const ALIGNMENT_BYTES = 1024 * 1024
const ALIGNMENT_SECTORS = ALIGNMENT_BYTES / SECTOR_SIZE

export const DEFAULT_CIDATA_SIZE_BYTES = 64 * 1024 * 1024
/** cloud-init の NoCloud が既定で探すラベル。大文字小文字は問わないが FAT は大文字で保持する。 */
export const CIDATA_LABEL = 'CIDATA'

/**
 * 1 手順ぶんの書き込み指示。
 *
 * `label` は進捗バーの下にそのまま出るので**利用者向けの文言**。
 * ここ（と昇格ワーカー）は利用者の言語を知らないので、訳さずに
 * `LocalizedText` で運び、renderer が訳す。
 */
export type WriteOp =
  /** ISO ファイルの一部をコピーする（コピー中に patches を適用する） */
  | {
      readonly kind: 'copy-iso'
      readonly diskOffset: number
      readonly isoOffset: number
      readonly length: number
      readonly label: LocalizedText
    }
  /** 用意済みのバイト列を書く */
  | { readonly kind: 'bytes'; readonly diskOffset: number; readonly data: Buffer; readonly label: LocalizedText }
  /** ゼロで埋める */
  | { readonly kind: 'zero'; readonly diskOffset: number; readonly length: number; readonly label: LocalizedText }

export interface UsbLayoutPlan {
  readonly diskSizeBytes: number
  readonly isoSizeBytes: number
  readonly cidata: {
    readonly startLba: number
    readonly endLba: number
    readonly sizeBytes: number
  }
  readonly gpt: GptImage
  readonly mbr: Buffer
  readonly partitions: readonly Omit<GptPartitionEntry, 'index'>[]
  /**
   * 通常の書き込み手順。順に実行する。
   * 先頭で MBR をゼロにするので、途中で抜かれた USB は「起動しないただのディスク」になる。
   */
  readonly ops: readonly WriteOp[]
  /**
   * 最後に実行する手順（パーティションテーブル）。
   * 本体が完全に書き終わってから書くことで、中断された USB が正常に見えるのを防ぐ。
   */
  readonly finalOps: readonly WriteOp[]
  /** ISO からコピーする総バイト数（進捗計算に使う） */
  readonly totalIsoBytes: number
  /** 書き込む総バイト数 */
  readonly totalBytes: number
}

export class LayoutError extends Error {
  constructor(
    /** 開発者向けの生の文言（ログとバグ報告の突き合わせに使うので日本語のまま）。 */
    message: string,
    readonly reason:
      | 'disk-too-small'
      | 'no-gpt'
      | 'not-protective-mbr'
      | 'cidata-too-small'
      | 'iso-truncated',
    /** 画面に出す文言。訳すのは renderer なので、ここではキーと差し込み値だけを持つ。 */
    readonly text: LocalizedText,
  ) {
    super(message)
    this.name = 'LayoutError'
  }
}

export interface PlanUsbLayoutOptions {
  readonly isoDevice: BlockDevice
  /** 書き込み先のディスク全体のバイト数 */
  readonly diskSizeBytes: number
  /** grub.cfg 等のインプレース改変 */
  readonly patches: readonly Patch[]
  /** CIDATA に入れるファイル（user-data / meta-data / 追加ファイル） */
  readonly seedFiles: readonly FatFile[]
  /** CIDATA パーティションのバイト数。既定 64 MiB。 */
  readonly cidataSizeBytes?: number
  /** GUID とボリューム ID を決める乱数源（テストで固定できるようにする） */
  readonly random: (n: number) => Buffer
  /** FAT のタイムスタンプ（再現性のため呼び出し側が決める） */
  readonly timestamp: Date
  /**
   * ISO9660 パーティションに「ドライブレターを割り当てない」属性 (GPT bit 63) を立てる。
   * Windows が「ディスクをフォーマットする必要があります」と表示するのを防ぐ。既定 true。
   */
  readonly hideIsoPartitionFromWindows?: boolean
}

function alignUp(sectors: number, alignment: number): number {
  return Math.ceil(sectors / alignment) * alignment
}

// 文言に差し込む容量は**ここで文字列にしてから**渡す。
// `LocalizedText.params` は `string | number` だけを運ぶ純粋なデータ（JSON を往復する）なので、
// 「バイト数と単位」を分けて持たせることはできない。
const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(2)} GB`
const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(0)} MB`

/** ISO を書き込んだ USB のレイアウトを計算する。デバイスには一切書かない。 */
export async function planUsbLayout(options: PlanUsbLayoutOptions): Promise<UsbLayoutPlan> {
  const { isoDevice, diskSizeBytes } = options
  const isoSizeBytes = isoDevice.size
  const diskSectors = Math.floor(diskSizeBytes / SECTOR_SIZE)
  const cidataSizeBytes = options.cidataSizeBytes ?? DEFAULT_CIDATA_SIZE_BYTES

  const mbrSector = await isoDevice.read(0, SECTOR_SIZE)
  const mbr = parseMbr(mbrSector)
  if (!mbr.valid || !mbr.isProtective) {
    throw new LayoutError(
      'this ISO has no protective MBR; it may not be an Ubuntu live-server ISO',
      'not-protective-mbr',
      localized('layout.notProtectiveMbr'),
    )
  }
  const isoGpt = await readGpt(isoDevice)
  if (!isoGpt) {
    throw new LayoutError(
      'this ISO has no GPT; unsupported layout',
      'no-gpt',
      localized('layout.noGpt'),
    )
  }

  // **ISO のパーティションがファイルの中に収まっているかを先に確かめる。**
  //
  // CIDATA はファイルサイズから置き場所を決めるが、ISO のパーティション表は
  // ISO から丸ごと写す。途中までしかダウンロードできていない ISO だと
  // 「ファイルは 100 MB なのに ISO9660 パーティションは 3 GB」という状態になり、
  // CIDATA が ISO9660 の内側に置かれた GPT ができあがる。
  // しかも読み戻し検証は「書いたものが読めるか」しか見ないので成功してしまう。
  // 出来上がるのは起動しない USB なので、ここで止める。
  const isoSectorsTotal = Math.ceil(isoSizeBytes / SECTOR_SIZE)
  for (const e of isoGpt.entries) {
    if (e.endLba >= isoSectorsTotal) {
      const needed = (e.endLba + 1) * SECTOR_SIZE
      throw new LayoutError(
        `this ISO is truncated: partition "${e.name}" extends to ` +
          `${gb(needed)}, but the file is only ` +
          `${gb(isoSizeBytes)}. ` +
          'Check that the download finished and that its SHA256 matches the official one.',
        'iso-truncated',
        localized('layout.isoTruncated', {
          partition: e.name,
          needed: gb(needed),
          fileSize: gb(isoSizeBytes),
        }),
      )
    }
  }

  // ISO 末尾（バックアップ GPT を含む）の直後、1 MiB 境界から CIDATA を置く
  const isoSectors = Math.ceil(isoSizeBytes / SECTOR_SIZE)
  const cidataStartLba = alignUp(isoSectors, ALIGNMENT_SECTORS)
  const cidataSectors = Math.floor(cidataSizeBytes / SECTOR_SIZE)

  // GPT のバックアップはディスク末尾 63 セクタを使う（248 エントリ × 128B = 62 セクタ + ヘッダ 1）
  const entrySectors = Math.ceil(
    (isoGpt.header.numberOfPartitionEntries * 128) / SECTOR_SIZE,
  )
  const lastUsableLba = diskSectors - 1 - entrySectors - 1
  const cidataEndLba = cidataStartLba + cidataSectors - 1

  if (cidataEndLba > lastUsableLba) {
    const needed = (cidataStartLba + cidataSectors + entrySectors + 2) * SECTOR_SIZE
    throw new LayoutError(
      `the USB drive is too small: the ISO (${gb(isoSizeBytes)}) and the config partition (${mb(cidataSizeBytes)}) need at least ${gb(needed)}, but the device is ${gb(diskSizeBytes)}`,
      'disk-too-small',
      localized('layout.diskTooSmall', {
        isoSize: gb(isoSizeBytes),
        cidataSize: mb(cidataSizeBytes),
        required: gb(needed),
        deviceSize: gb(diskSizeBytes),
      }),
    )
  }
  if (cidataSectors < 2048) {
    throw new LayoutError(
      'the config partition must be at least 1 MiB',
      'cidata-too-small',
      localized('layout.cidataTooSmall'),
    )
  }

  // --- パーティションテーブル ---
  const hideIso = options.hideIsoPartitionFromWindows ?? true
  const partitions: Omit<GptPartitionEntry, 'index'>[] = isoGpt.entries.map((e) => ({
    typeGuid: e.typeGuid,
    uniqueGuid: e.uniqueGuid,
    startLba: e.startLba,
    endLba: e.endLba,
    attributes:
      hideIso && e.name === 'ISO9660' ? e.attributes | GPT_ATTR.NO_DRIVE_LETTER : e.attributes,
    name: e.name,
  }))
  partitions.push({
    typeGuid: PARTITION_TYPE.MICROSOFT_BASIC_DATA,
    uniqueGuid: randomGuid(options.random),
    startLba: cidataStartLba,
    endLba: cidataEndLba,
    attributes: 0n,
    name: CIDATA_LABEL,
  })

  const gpt = buildGpt({
    diskSectors,
    diskGuid: isoGpt.header.diskGuid,
    entries: partitions,
    numberOfPartitionEntries: isoGpt.header.numberOfPartitionEntries,
    partitionEntryLba: isoGpt.header.partitionEntryLba,
    firstUsableLba: isoGpt.header.firstUsableLba,
  })

  // --- CIDATA の中身 ---
  const volumeId = options.random(4).readUInt32LE(0)
  const fat = buildFatImage({
    sizeBytes: cidataSectors * SECTOR_SIZE,
    label: CIDATA_LABEL,
    files: options.seedFiles,
    hiddenSectors: cidataStartLba,
    volumeId,
    timestamp: options.timestamp,
  })

  assertPatchesDisjoint(options.patches)

  // --- 書き込み手順 ---
  // ISO 本体のうち、パーティションテーブル領域 (LBA 0-63) を除いた部分をコピーする。
  // LBA 0 の MBR と LBA 1-63 の GPT は最後に自前のものを書く。
  const isoBodyStart = isoGpt.header.firstUsableLba * SECTOR_SIZE
  // ISO 末尾の 63 セクタは古いバックアップ GPT。書き込まずにゼロで潰す。
  const staleBackupGptSectors = entrySectors + 1
  const isoBodyEnd = (isoSectors - staleBackupGptSectors) * SECTOR_SIZE

  const ops: WriteOp[] = [
    // 最初に MBR を消す。ここで中断されても「起動しないディスク」になり、
    // 中途半端に起動して壊れたインストールが走ることがない。
    { kind: 'zero', diskOffset: 0, length: SECTOR_SIZE, label: localized('writeOp.clearTable') },
    {
      kind: 'copy-iso',
      diskOffset: isoBodyStart,
      isoOffset: isoBodyStart,
      length: isoBodyEnd - isoBodyStart,
      label: localized('writeOp.isoBody'),
    },
    {
      kind: 'zero',
      diskOffset: isoBodyEnd,
      length: (isoSectors * SECTOR_SIZE) - isoBodyEnd,
      label: localized('writeOp.clearStaleGpt'),
    },
    {
      kind: 'zero',
      diskOffset: isoSectors * SECTOR_SIZE,
      length: cidataStartLba * SECTOR_SIZE - isoSectors * SECTOR_SIZE,
      label: localized('writeOp.clearGap'),
    },
    {
      kind: 'bytes',
      diskOffset: cidataStartLba * SECTOR_SIZE,
      data: fat.data,
      label: localized('writeOp.cidata'),
    },
    {
      kind: 'bytes',
      diskOffset: gpt.backupEntriesLba * SECTOR_SIZE,
      data: gpt.entryArray,
      label: localized('writeOp.backupGptEntries'),
    },
    {
      kind: 'bytes',
      diskOffset: gpt.backupHeaderLba * SECTOR_SIZE,
      data: gpt.backupHeader,
      label: localized('writeOp.backupGptHeader'),
    },
  ]

  const finalOps: WriteOp[] = [
    {
      kind: 'bytes',
      diskOffset: isoGpt.header.partitionEntryLba * SECTOR_SIZE,
      data: gpt.entryArray,
      label: localized('writeOp.gptEntries'),
    },
    {
      kind: 'bytes',
      diskOffset: 1 * SECTOR_SIZE,
      data: gpt.primaryHeader,
      label: localized('writeOp.gptHeader'),
    },
    {
      kind: 'bytes',
      diskOffset: 0,
      data: updateProtectiveMbr(mbrSector, diskSectors),
      label: localized('writeOp.protectiveMbr'),
    },
  ]

  const sizeOf = (op: WriteOp): number =>
    op.kind === 'bytes' ? op.data.length : op.kind === 'zero' ? op.length : op.length

  return {
    diskSizeBytes,
    isoSizeBytes,
    cidata: {
      startLba: cidataStartLba,
      endLba: cidataEndLba,
      sizeBytes: cidataSectors * SECTOR_SIZE,
    },
    gpt,
    mbr: mbrSector,
    partitions,
    ops,
    finalOps,
    totalIsoBytes: isoBodyEnd - isoBodyStart,
    totalBytes: [...ops, ...finalOps].reduce((n, op) => n + sizeOf(op), 0),
  }
}

/** この ISO を書くのに最低限必要なディスク容量。 */
export function minimumDiskSize(isoSizeBytes: number, cidataSizeBytes = DEFAULT_CIDATA_SIZE_BYTES): number {
  const isoSectors = Math.ceil(isoSizeBytes / SECTOR_SIZE)
  const cidataStart = alignUp(isoSectors, ALIGNMENT_SECTORS)
  const cidataSectors = Math.ceil(cidataSizeBytes / SECTOR_SIZE)
  // 248 エントリ分のバックアップ GPT (62 セクタ) + ヘッダ 1 セクタ + 余裕
  return (cidataStart + cidataSectors + 64) * SECTOR_SIZE
}
