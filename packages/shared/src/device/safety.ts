import type { DeviceInfo } from '../ipc/types.js'

// デバイス選択の安全判定のうち、renderer からも使う純粋な部分。
// Node に依存しないのでバレルに載せられる（実際の列挙は @autoinstall/media 側）。

/**
 * 「選べるが、確認をより強くすべき」デバイスの閾値。
 * 64 GB を超えるものや USB 以外の接続は、外付け HDD / SSD の可能性が高い。
 */
export const EXTRA_CAUTION_SIZE_BYTES = 64 * 1000 * 1000 * 1000

/** 特に注意を促すべきデバイスか（UI が確認文言を強める）。 */
export function needsExtraCaution(d: Pick<DeviceInfo, 'sizeBytes' | 'bus'>): boolean {
  return d.sizeBytes > EXTRA_CAUTION_SIZE_BYTES || d.bus !== 'usb'
}
