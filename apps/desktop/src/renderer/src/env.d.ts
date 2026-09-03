/// <reference types="vite/client" />
import type { AutoinstallApi } from '@autoinstall/shared'

declare global {
  interface Window {
    /** preload の contextBridge が公開する API。契約は @autoinstall/shared の AutoinstallApi。 */
    autoinstall: AutoinstallApi
  }
}

export {}
