import type {
  AdditionalUser,
  Deployment,
  GpuConfig,
  SystemdService,
} from './provisioning.js'

// GUI が編集する「プロファイル」型。これが唯一の入力で、ここから autoinstall YAML を決定的に生成する。
// autoinstall のキー名をそのまま使わず、初心者に意味が分かる語彙にしている（変換は generate.ts）。

/** サポートする Ubuntu Server のシリーズ。ISO の Volume ID から自動判定する。 */
export type UbuntuSeries = '22.04' | '24.04' | '25.10' | '26.04'

export const UBUNTU_SERIES: readonly UbuntuSeries[] = ['22.04', '24.04', '25.10', '26.04']

/** シリーズごとの autoinstall 機能差。subiquity の autoinstall-schema.json 実測に基づく。 */
export interface SeriesFeatures {
  /** `interactive-sections`（22.04 のスキーマには無いが実装は存在。GUI では 24.04+ でのみ提示） */
  interactiveSections: boolean
  /** `source`（インストール範囲の選択: ubuntu-server / ubuntu-server-minimal） */
  source: boolean
  /** `ubuntu-pro`（22.04 は `ubuntu-advantage` のみ） */
  ubuntuPro: boolean
  /** `codecs` / `oem` / `active-directory` */
  codecsOemAd: boolean
  /** `kernel-crash-dumps`（25.10 で追加） */
  kernelCrashDumps: boolean
  /** `zdevs`（s390x 向け。25.10 で追加） */
  zdevs: boolean
  /** HWE カーネルの menuentry が grub.cfg にある（25.10 以降は無い） */
  hweMenuEntry: boolean
}

export const SERIES_FEATURES: Record<UbuntuSeries, SeriesFeatures> = {
  '22.04': {
    interactiveSections: false,
    source: false,
    ubuntuPro: false,
    codecsOemAd: false,
    kernelCrashDumps: false,
    zdevs: false,
    hweMenuEntry: true,
  },
  '24.04': {
    interactiveSections: true,
    source: true,
    ubuntuPro: true,
    codecsOemAd: true,
    kernelCrashDumps: false,
    zdevs: false,
    hweMenuEntry: true,
  },
  '25.10': {
    interactiveSections: true,
    source: true,
    ubuntuPro: true,
    codecsOemAd: true,
    kernelCrashDumps: true,
    zdevs: true,
    hweMenuEntry: false,
  },
  '26.04': {
    interactiveSections: true,
    source: true,
    ubuntuPro: true,
    codecsOemAd: true,
    kernelCrashDumps: true,
    zdevs: true,
    hweMenuEntry: false,
  },
}

// ---------------------------------------------------------------------------
// ネットワーク
// ---------------------------------------------------------------------------

/** どの NIC に設定を当てるか。`any` は netplan の `match` を書かず全 ethernet に当てる。 */
export type InterfaceSelector =
  | { readonly kind: 'any' }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'mac'; readonly macaddress: string }

export type NetworkConfig =
  /**
   * `network` キーを出力しない（推奨）。subiquity の既定は
   * 「`eth*` / `en*` に一致する全 NIC で DHCPv4 を試し、アドレスを取れなかった NIC は無効化する」
   * （autoinstall リファレンスに明記）。手書きの match より確実なので既定にしている。
   */
  | { readonly mode: 'installer-default' }
  | {
      readonly mode: 'dhcp'
      readonly target: InterfaceSelector
      /** true にすると `optional: true`。未接続 NIC で起動が 2 分待たされるのを防ぐ。 */
      readonly optional: boolean
    }
  | {
      readonly mode: 'static'
      readonly target: InterfaceSelector
      /** CIDR 表記（例 `192.168.1.10/24`） */
      readonly address: string
      readonly gateway: string
      readonly nameservers: readonly string[]
      readonly searchDomains: readonly string[]
      readonly optional: boolean
    }
  /** 上級者向け: netplan v2 の YAML をそのまま渡す */
  | { readonly mode: 'raw'; readonly yaml: string }

// ---------------------------------------------------------------------------
// ストレージ
// ---------------------------------------------------------------------------

/** インストール先ディスクの選び方。複数ディスク機では必須。 */
export type DiskMatch =
  /** `match: {size: largest}`。インストールメディア自身は選ばれない（subiquity の仕様）。 */
  | { readonly kind: 'largest' }
  | { readonly kind: 'smallest' }
  | { readonly kind: 'ssd' }
  /** `match: {path: ...}`。glob 可（例 `/dev/nvme0n1`） */
  | { readonly kind: 'path'; readonly path: string }
  /** `match: {serial: ...}`。glob 可（例 `CT*`）。複数ディスク機で最も確実。 */
  | { readonly kind: 'serial'; readonly serial: string }
  | { readonly kind: 'model'; readonly model: string }
  /** `match: {}`。任意の 1 台。単一ディスク機向け。 */
  | { readonly kind: 'any' }

export type StorageConfig =
  | {
      readonly mode: 'lvm' | 'direct' | 'zfs'
      readonly match: DiskMatch
      /**
       * `sizing-policy: all` にすると root LV がディスク全体を使う。
       * 既定の `scaled` はスナップショット用に領域を残す（200 GiB 超なら root は 100 GiB で頭打ち）。
       * lvm レイアウトにのみ効く。
       */
      readonly useWholeDisk: boolean
      /** LUKS 全ディスク暗号化のパスフレーズ（平文。空なら暗号化しない）。lvm レイアウトのみ。 */
      readonly encryptionPassphrase: string
      /** swap を作らない場合 true（`swap: {size: 0}`） */
      readonly disableSwap: boolean
      /** パーティションテーブル形式。既定 (s390x 以外) は gpt。古い BIOS 機では msdos。 */
      readonly partitionTable: 'default' | 'gpt' | 'msdos'
    }
  /** 上級者向け: curtin の storage config をそのまま渡す */
  | { readonly mode: 'raw'; readonly yaml: string }

// ---------------------------------------------------------------------------
// インストール後の処理
// ---------------------------------------------------------------------------

/** USB に同梱し、インストール先へコピーするファイル。 */
export interface ProvisionFile {
  /** CIDATA 上のファイル名（8.3 に収まらない名前は VFAT LFN で書く） */
  readonly name: string
  /** インストール先の絶対パス（例 `/etc/motd`） */
  readonly targetPath: string
  /** 8 進数のパーミッション文字列（例 `0644`） */
  readonly mode: string
  readonly owner: string
  /** UTF-8 テキスト。バイナリはサポートしない。 */
  readonly content: string
}

export type PostInstallPresetId =
  | 'sudo-nopasswd'
  | 'ssh-harden'
  | 'unattended-upgrades'
  | 'qemu-guest-agent'
  | 'docker-ce'
  | 'chrony-ntp'
  | 'ufw-allow-ssh'
  | 'disable-cloud-init-net'
  | 'ja-locale'

// ---------------------------------------------------------------------------
// プロファイル本体
// ---------------------------------------------------------------------------

export interface AutoinstallProfile {
  /**
   * プロファイル JSON の形式バージョン（autoinstall の version とは別物）。
   * 1: 初版 / 2: 追加ユーザー・展開・サービス・GPU を追加
   */
  readonly profileVersion: 2
  readonly meta: {
    readonly name: string
    /** ISO 8601。生成時に埋める。 */
    readonly createdAt: string
    readonly toolVersion: string
  }
  readonly series: UbuntuSeries
  readonly basics: {
    /** 例 `en_US.UTF-8` / `ja_JP.UTF-8` */
    readonly locale: string
    readonly keyboard: { readonly layout: string; readonly variant: string; readonly toggle: string | null }
    /** IANA タイムゾーン、または `geoip` */
    readonly timezone: string
    readonly hostname: string
  }
  readonly user: {
    readonly realname: string
    readonly username: string
    /** crypt(3) 形式のハッシュ（`$6$...`）。平文は絶対に保存しない。 */
    readonly passwordHash: string
    /** sudo をパスワード無しにする（late-commands で sudoers.d に書く） */
    readonly sudoNoPassword: boolean
  }
  readonly ssh: {
    readonly installServer: boolean
    readonly authorizedKeys: readonly string[]
    readonly allowPasswordAuth: boolean
  }
  readonly network: NetworkConfig
  readonly storage: StorageConfig
  readonly software: {
    /** `source.id`。24.04+ のみ。既定は `ubuntu-server`。 */
    readonly sourceId: 'ubuntu-server' | 'ubuntu-server-minimal'
    readonly packages: readonly string[]
    readonly snaps: readonly { readonly name: string; readonly channel?: string; readonly classic?: boolean }[]
    readonly updates: 'security' | 'all'
    readonly installDrivers: boolean
    /** null = subiquity の既定に任せる（25.10+） */
    readonly kernelCrashDumps: boolean | null
    readonly ubuntuProToken: string
    /** NVIDIA ドライバ / CUDA。初回起動時に cloud-init が導入する。 */
    readonly gpu: GpuConfig
  }
  readonly apt: {
    readonly mode: 'default' | 'country-mirror' | 'custom'
    /** `country-mirror` のとき使う 2 文字国コード（表示用。実際は country-mirror が自動選択） */
    readonly countryCode: string
    /** `custom` のときのミラー URI */
    readonly primaryUri: string
    /** APT プロキシ（空なら設定しない） */
    readonly proxy: string
    readonly disableComponents: readonly string[]
  }
  readonly postInstall: {
    readonly presets: readonly PostInstallPresetId[]
    /** 追加の late-commands（ライブ環境で実行。`curtin in-target --` は生成側で付ける） */
    readonly lateCommands: readonly string[]
    /** 初回起動時に cloud-init が実行するコマンド（`user-data.runcmd`） */
    readonly firstBootCommands: readonly string[]
    readonly files: readonly ProvisionFile[]
    /** identity とは別に作るユーザー */
    readonly additionalUsers: readonly AdditionalUser[]
    /** USB 同梱または URL 取得のアプリ/ファイルの展開 */
    readonly deployments: readonly Deployment[]
    /** 登録する systemd サービス */
    readonly services: readonly SystemdService[]
    /** インストール直後に apt full-upgrade を走らせる */
    readonly aptFullUpgrade: boolean
  }
  readonly behavior: {
    /** 対話させたいセクション（`["*"]` で全部対話）。空なら完全無人。 */
    readonly interactiveSections: readonly string[]
    readonly shutdown: 'reboot' | 'poweroff'
    /** インストーラ本体を snap から更新する（ネットワーク必須） */
    readonly refreshInstaller: boolean
    /** 進捗をコンソールに出す（`reporting.builtin` を hidden にしない） */
    readonly reportToConsole: boolean
  }
  readonly advanced: {
    /** 生成結果に深いマージで上書きする YAML。空文字なら無視。 */
    readonly rawOverlayYaml: string
    /** grub のカーネル行に追加する引数（`autoinstall` は常に自動付与） */
    readonly extraKernelArgs: string
  }
}
