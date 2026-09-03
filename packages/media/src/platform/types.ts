// リムーバブルデバイスの列挙と、書き込み前後の OS 別処理。
// 「システムディスクを絶対に選ばせない」ことが最優先の設計目標。

export type DeviceBus = 'usb' | 'sd' | 'nvme' | 'sata' | 'scsi' | 'virtual' | 'unknown'

export interface RemovableDevice {
  /** OS が使う識別子。Windows: `\\.\PhysicalDrive2`、macOS: `/dev/disk4`、Linux: `/dev/sdb` */
  readonly id: string
  /** 画面に出す名前（例 `SanDisk Ultra USB 3.0`） */
  readonly description: string
  readonly sizeBytes: number
  readonly bus: DeviceBus
  readonly removable: boolean
  /** OS が入っているディスク。**絶対に書き込ませない**。 */
  readonly isSystem: boolean
  /** 現在マウントされているパス（Windows のドライブレターを含む） */
  readonly mountpoints: readonly string[]
  readonly serial: string | null
  /** 読み取り専用（SD カードの物理ロック等） */
  readonly readOnly: boolean
  /**
   * このデバイスを候補として出してよいか。false の場合 `blockedReason` に理由が入る。
   * 判定は列挙側で完結させ、UI 側に安全判断を持ち込ませない。
   */
  readonly selectable: boolean
  readonly blockedReason: string | null
}

export interface PlatformOps {
  /** 書き込み候補になりうるデバイスを列挙する。 */
  listDevices(): Promise<RemovableDevice[]>
  /**
   * 書き込み前の準備。マウントを外し、Windows ではボリュームをロックする。
   * これをしないと Windows 8 以降はパーティション領域への書き込みが拒否される。
   */
  prepareForWrite(deviceId: string): Promise<void>
  /** 書き込み後の後始末（再スキャン、アンマウント/イジェクト）。 */
  finishWrite(deviceId: string): Promise<void>
  /** 現在のプロセスが raw デバイスに書ける権限を持っているか。 */
  hasWriteAccess(): Promise<boolean>
}

// 「確認を強めるべきか」の判定は renderer からも使うので @autoinstall/shared 側にある。
export { EXTRA_CAUTION_SIZE_BYTES, needsExtraCaution } from '@autoinstall/shared'

/** 危険なデバイスをブロックする共通判定。列挙結果を必ずこれに通す。 */
export function classifyDevice(
  d: Omit<RemovableDevice, 'selectable' | 'blockedReason'>,
): RemovableDevice {
  const block = (reason: string): RemovableDevice => ({ ...d, selectable: false, blockedReason: reason })

  if (d.isSystem) return block('OS が入っているシステムディスクです')
  if (d.readOnly) return block('書き込み禁止になっています')
  if (d.sizeBytes <= 0) return block('容量を取得できませんでした')
  // 内蔵ディスクは既定で除外する。誤ってサーバーの内蔵 SSD を消す事故を防ぐ。
  if (!d.removable && (d.bus === 'nvme' || d.bus === 'sata' || d.bus === 'scsi')) {
    return block('内蔵ディスクのため対象外です')
  }
  // 4 GB 未満は Ubuntu Server の ISO が入らない
  if (d.sizeBytes < 4 * 1000 * 1000 * 1000) return block('容量が小さすぎます（4 GB 以上が必要）')
  // 2 TB 超のデバイスは外付け HDD の可能性が高い。誤選択の被害が大きいので警告的にブロックする。
  if (d.sizeBytes > 2 * 1000 * 1000 * 1000 * 1000) {
    return block('2 TB を超えるデバイスは対象外です（外付けドライブの誤選択防止）')
  }
  return { ...d, selectable: true, blockedReason: null }
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}
