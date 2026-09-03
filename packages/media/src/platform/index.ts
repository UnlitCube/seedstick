import type { PlatformOps } from './types.js'
import { win32Ops } from './win32.js'
import { darwinOps } from './darwin.js'
import { linuxOps } from './linux.js'

export * from './types.js'
export { parseWindowsDisks, diskNumberFromId, mapBusType } from './win32.js'
export { parsePlist, toDevice, mapBusProtocol } from './darwin.js'
export { parseLsblk, mapTransport } from './linux.js'

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`このプラットフォームには対応していません: ${platform}`)
    this.name = 'UnsupportedPlatformError'
  }
}

/** 実行中の OS に対応する実装を返す。 */
export function getPlatformOps(platform: NodeJS.Platform = process.platform): PlatformOps {
  switch (platform) {
    case 'win32':
      return win32Ops
    case 'darwin':
      return darwinOps
    case 'linux':
      return linuxOps
    default:
      throw new UnsupportedPlatformError(platform)
  }
}

/** OS ごとの「管理者権限で実行し直す方法」の説明（UI にそのまま出す）。 */
export function elevationHint(platform: NodeJS.Platform = process.platform): {
  ja: string
  en: string
} {
  switch (platform) {
    case 'win32':
      return {
        ja: 'USB への書き込みには管理者権限が必要です。「管理者として実行」の確認ダイアログが表示されます。',
        en: 'Writing to USB requires administrator rights. A User Account Control prompt will appear.',
      }
    case 'darwin':
      return {
        ja: 'USB への書き込みには管理者権限が必要です。macOS のパスワード入力ダイアログが表示されます。',
        en: 'Writing to USB requires administrator rights. macOS will ask for your password.',
      }
    default:
      return {
        ja: 'USB への書き込みには root 権限が必要です。認証ダイアログ (polkit) が表示されます。',
        en: 'Writing to USB requires root. A polkit authentication dialog will appear.',
      }
  }
}
