// リムーバブルデバイスの列挙と、書き込み前後の OS 別処理。
// 「システムディスクを絶対に選ばせない」ことが最優先の設計目標。

import { localized, type LocalizedText } from '@autoinstall/shared'

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
  /**
   * ブロックした理由。**訳さずに運ぶ**（このパッケージは利用者の言語を知らない。
   * 昇格ワーカーは別プロセスで locale を持たない）。renderer が `formatLocalized` で訳す。
   */
  readonly blockedReason: LocalizedText | null
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

/** これ未満は Ubuntu Server の ISO が入らない。 */
export const MIN_DEVICE_BYTES = 4 * 1000 * 1000 * 1000
/** これを超えるものは外付け HDD の可能性が高い。誤選択の被害が大きいのでブロックする。 */
export const MAX_DEVICE_BYTES = 2 * 1000 * 1000 * 1000 * 1000

/** 危険なデバイスをブロックする共通判定。列挙結果を必ずこれに通す。 */
export function classifyDevice(
  d: Omit<RemovableDevice, 'selectable' | 'blockedReason'>,
): RemovableDevice {
  const block = (reason: LocalizedText): RemovableDevice => ({
    ...d,
    selectable: false,
    blockedReason: reason,
  })

  if (d.isSystem) return block(localized('device.blockedSystemDisk'))
  if (d.readOnly) return block(localized('device.blockedReadOnly'))
  if (d.sizeBytes <= 0) return block(localized('device.blockedUnknownSize'))
  // 仮想ディスク（.vhd などのファイル実体）は書き込み先として想定していない
  if (d.bus === 'virtual') return block(localized('device.blockedVirtual'))
  // **「内蔵らしいものを弾く」ではなく「取り外せる根拠があるものだけ通す」。**
  //
  // 以前は bus が nvme / sata / scsi のときだけ弾いていたので、
  // RAID コントローラ・iSCSI・ファイバチャネル・virtio のように
  // bus が 'unknown' になるディスクが候補に出ていた。
  // Windows では removable が usb / sd のときしか true にならないので、
  // サーバーの RAID アレイ（2 TB 以下なら容量の条件も抜ける）が
  // 「書き込んでよいデバイス」として画面に並ぶ。消したら戻せない。
  //
  // 分からないものは危険側に倒す。USB か SD、または OS が明示的に
  // removable と言っているものだけを候補にする。
  if (!d.removable && d.bus !== 'usb' && d.bus !== 'sd') {
    return block(localized('device.blockedNotRemovable'))
  }
  // 容量の表記は訳す側で組み立てられないので、ここで整形して差し込む
  // （辞書は「{min} 以上が必要」という枠だけを持つ）。
  if (d.sizeBytes < MIN_DEVICE_BYTES) {
    return block(localized('device.blockedTooSmall', { min: formatSize(MIN_DEVICE_BYTES) }))
  }
  if (d.sizeBytes > MAX_DEVICE_BYTES) {
    return block(localized('device.blockedTooLarge', { max: formatSize(MAX_DEVICE_BYTES) }))
  }
  return { ...d, selectable: true, blockedReason: null }
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}
