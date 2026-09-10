/// <reference types="vite/client" />

import type { InstallerBridge } from '../../shared/protocol.js'

declare global {
  interface Window {
    /** preload が渡す唯一の入口。`shared/protocol.ts` の契約だけ。 */
    readonly installer: InstallerBridge
  }
}

export {}
