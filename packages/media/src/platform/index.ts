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
