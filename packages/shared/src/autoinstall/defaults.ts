import type { AutoinstallProfile, UbuntuSeries } from './model.js'

/** 何も設定していない状態のプロファイル。GUI の初期値であり、単体テストの基準でもある。 */
export function createDefaultProfile(
  series: UbuntuSeries = '24.04',
  toolVersion = 'autoinstall-ui/0.1.0',
  createdAt = '1970-01-01T00:00:00.000Z',
): AutoinstallProfile {
  return {
    profileVersion: 1,
    meta: { name: 'default', createdAt, toolVersion },
    series,
    basics: {
      locale: 'en_US.UTF-8',
      keyboard: { layout: 'us', variant: '', toggle: null },
      timezone: 'UTC',
      hostname: 'ubuntu-server',
    },
    user: {
      realname: 'Ubuntu User',
      username: 'ubuntu',
      passwordHash: '',
      sudoNoPassword: false,
    },
    ssh: { installServer: true, authorizedKeys: [], allowPasswordAuth: true },
    // 既定はインストーラ任せ。subiquity は eth*/en* で DHCPv4 を試し、
    // アドレスを取れなかった NIC を自動的に無効化するので、手書きの match より確実。
    network: { mode: 'installer-default' },
    storage: {
      mode: 'lvm',
      match: { kind: 'largest' },
      useWholeDisk: false,
      encryptionPassphrase: '',
      disableSwap: false,
      partitionTable: 'default',
    },
    software: {
      sourceId: 'ubuntu-server',
      packages: [],
      snaps: [],
      updates: 'security',
      installDrivers: false,
      kernelCrashDumps: null,
      ubuntuProToken: '',
    },
    apt: {
      mode: 'default',
      countryCode: '',
      primaryUri: '',
      proxy: '',
      disableComponents: [],
    },
    postInstall: { presets: [], lateCommands: [], firstBootCommands: [], files: [] },
    behavior: {
      interactiveSections: [],
      shutdown: 'reboot',
      refreshInstaller: false,
      reportToConsole: true,
    },
    advanced: { rawOverlayYaml: '', extraKernelArgs: '' },
  }
}
