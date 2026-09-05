import type { PostInstallPresetId, UbuntuSeries } from './model.js'

// GUI に並べる選択肢と、インストール後処理のプリセット。
// 「初心者が意味を理解して選べる」ことを最優先に、説明文（日本語・英語）を必ず持たせる。

export interface Choice {
  readonly value: string
  readonly labelJa: string
  readonly labelEn: string
}

/** autoinstall の `locale` キーに入れる値の候補（UI 表示言語の LOCALES とは別物）。 */
export const LOCALE_CHOICES: readonly Choice[] = [
  { value: 'en_US.UTF-8', labelJa: '英語 (アメリカ)', labelEn: 'English (US)' },
  { value: 'ja_JP.UTF-8', labelJa: '日本語', labelEn: 'Japanese' },
  { value: 'en_GB.UTF-8', labelJa: '英語 (イギリス)', labelEn: 'English (UK)' },
  { value: 'de_DE.UTF-8', labelJa: 'ドイツ語', labelEn: 'German' },
  { value: 'fr_FR.UTF-8', labelJa: 'フランス語', labelEn: 'French' },
  { value: 'es_ES.UTF-8', labelJa: 'スペイン語', labelEn: 'Spanish' },
  { value: 'pt_BR.UTF-8', labelJa: 'ポルトガル語 (ブラジル)', labelEn: 'Portuguese (Brazil)' },
  { value: 'zh_CN.UTF-8', labelJa: '中国語 (簡体)', labelEn: 'Chinese (Simplified)' },
  { value: 'ko_KR.UTF-8', labelJa: '韓国語', labelEn: 'Korean' },
  { value: 'C.UTF-8', labelJa: 'ロケールなし (C.UTF-8)', labelEn: 'No locale (C.UTF-8)' },
]

export interface KeyboardChoice extends Choice {
  readonly layout: string
  readonly variant: string
}

/** keyboard.layout / variant の候補。日本語配列は variant を空にする。 */
export const KEYBOARDS: readonly KeyboardChoice[] = [
  { value: 'us:', layout: 'us', variant: '', labelJa: '英語 (US)', labelEn: 'English (US)' },
  { value: 'jp:', layout: 'jp', variant: '', labelJa: '日本語 (JIS)', labelEn: 'Japanese (JIS)' },
  { value: 'us:dvorak', layout: 'us', variant: 'dvorak', labelJa: '英語 (Dvorak)', labelEn: 'English (Dvorak)' },
  { value: 'gb:', layout: 'gb', variant: '', labelJa: '英語 (UK)', labelEn: 'English (UK)' },
  { value: 'de:', layout: 'de', variant: '', labelJa: 'ドイツ語', labelEn: 'German' },
  { value: 'fr:', layout: 'fr', variant: '', labelJa: 'フランス語', labelEn: 'French' },
  { value: 'es:', layout: 'es', variant: '', labelJa: 'スペイン語', labelEn: 'Spanish' },
  { value: 'kr:kr104', layout: 'kr', variant: 'kr104', labelJa: '韓国語 (104키)', labelEn: 'Korean (104-key)' },
  { value: 'cn:', layout: 'cn', variant: '', labelJa: '中国語', labelEn: 'Chinese' },
]

/** timezone の候補。`geoip` は IP から自動判定。 */
export const TIMEZONES: readonly Choice[] = [
  { value: 'Asia/Tokyo', labelJa: '東京 (JST)', labelEn: 'Tokyo (JST)' },
  { value: 'UTC', labelJa: 'UTC (協定世界時)', labelEn: 'UTC' },
  { value: 'geoip', labelJa: 'IP アドレスから自動判定', labelEn: 'Detect from IP address' },
  { value: 'America/Los_Angeles', labelJa: 'ロサンゼルス', labelEn: 'Los Angeles' },
  { value: 'America/New_York', labelJa: 'ニューヨーク', labelEn: 'New York' },
  { value: 'Europe/London', labelJa: 'ロンドン', labelEn: 'London' },
  { value: 'Europe/Berlin', labelJa: 'ベルリン', labelEn: 'Berlin' },
  { value: 'Asia/Singapore', labelJa: 'シンガポール', labelEn: 'Singapore' },
  { value: 'Asia/Seoul', labelJa: 'ソウル', labelEn: 'Seoul' },
  { value: 'Australia/Sydney', labelJa: 'シドニー', labelEn: 'Sydney' },
]

// ---------------------------------------------------------------------------
// インストール後処理プリセット
// ---------------------------------------------------------------------------

export interface PostInstallPreset {
  readonly id: PostInstallPresetId
  readonly titleJa: string
  readonly titleEn: string
  readonly descriptionJa: string
  readonly descriptionEn: string
  /** 危険度。`caution` は GUI で警告色にする。 */
  readonly risk: 'safe' | 'caution'
  /** インストール完了後・初回起動前に curtin の in-target で実行するコマンド */
  readonly lateCommands: (ctx: PresetContext) => string[]
  /** 追加でインストールするパッケージ */
  readonly packages?: readonly string[]
  /** このプリセットがネットワーク接続を必要とするか */
  readonly needsNetwork: boolean
  /** 対応シリーズを限定する場合 */
  readonly series?: readonly UbuntuSeries[]
}

export interface PresetContext {
  readonly username: string
  readonly hostname: string
}

/** シェルの単一引用符で安全に囲む。`late-commands` は文字列だと sh -c で実行される。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export const POST_INSTALL_PRESETS: readonly PostInstallPreset[] = [
  {
    id: 'sudo-nopasswd',
    titleJa: 'sudo をパスワード無しにする',
    titleEn: 'Passwordless sudo',
    descriptionJa:
      '作成したユーザーが sudo をパスワード入力なしで使えるようにします。自動化には便利ですが、そのユーザーのログインを奪われると即座に root 権限を取られます。',
    descriptionEn:
      'Lets the created user run sudo without a password. Convenient for automation, but anyone who gets that login gets root immediately.',
    risk: 'caution',
    needsNetwork: false,
    lateCommands: (ctx) => [
      `echo ${shellQuote(`${ctx.username} ALL=(ALL) NOPASSWD:ALL`)} > /target/etc/sudoers.d/90-autoinstall-${ctx.username}`,
      `chmod 0440 /target/etc/sudoers.d/90-autoinstall-${ctx.username}`,
    ],
  },
  {
    id: 'ssh-harden',
    titleJa: 'SSH のパスワード認証を無効にする',
    titleEn: 'Disable SSH password authentication',
    descriptionJa:
      '公開鍵認証のみ許可し、root の SSH ログインも禁止します。事前に SSH 公開鍵を登録していないとログインできなくなるので注意してください。',
    descriptionEn:
      'Allows public-key authentication only and forbids root SSH login. You will be locked out unless an SSH key is registered.',
    risk: 'caution',
    needsNetwork: false,
    lateCommands: () => [
      'mkdir -p /target/etc/ssh/sshd_config.d',
      `printf '%s\\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' > /target/etc/ssh/sshd_config.d/90-autoinstall-harden.conf`,
    ],
  },
  {
    id: 'unattended-upgrades',
    titleJa: 'セキュリティ更新を自動適用する',
    titleEn: 'Automatic security updates',
    descriptionJa:
      'unattended-upgrades を有効にして、セキュリティ更新を自動で適用します。再起動が必要な更新でも自動再起動はしません。',
    descriptionEn:
      'Enables unattended-upgrades so security updates install automatically. It does not reboot on its own.',
    risk: 'safe',
    needsNetwork: true,
    packages: ['unattended-upgrades'],
    lateCommands: () => [
      'curtin in-target -- systemctl enable unattended-upgrades.service',
    ],
  },
  {
    id: 'qemu-guest-agent',
    titleJa: '仮想マシン用ゲストエージェントを入れる',
    titleEn: 'Install QEMU guest agent',
    descriptionJa:
      'KVM / Proxmox / QEMU の仮想マシンにインストールする場合に選びます。ホスト側からシャットダウンや IP 取得ができるようになります。',
    descriptionEn:
      'For KVM / Proxmox / QEMU guests. Lets the host shut the VM down cleanly and read its IP address.',
    risk: 'safe',
    needsNetwork: true,
    packages: ['qemu-guest-agent'],
    lateCommands: () => ['curtin in-target -- systemctl enable qemu-guest-agent.service'],
  },
  {
    id: 'docker-ce',
    titleJa: 'Docker を入れる (Ubuntu 標準リポジトリ版)',
    titleEn: 'Install Docker (Ubuntu repository build)',
    descriptionJa:
      'docker.io と docker-compose-v2 をインストールし、作成したユーザーを docker グループに入れます。docker グループは実質 root 権限と同等です。',
    descriptionEn:
      'Installs docker.io and docker-compose-v2 and adds the created user to the docker group. The docker group is effectively root.',
    risk: 'caution',
    needsNetwork: true,
    packages: ['docker.io', 'docker-compose-v2'],
    lateCommands: (ctx) => [
      `curtin in-target -- usermod -aG docker ${ctx.username}`,
      'curtin in-target -- systemctl enable docker.service',
    ],
  },
  {
    id: 'chrony-ntp',
    titleJa: '時刻同期 (chrony) を入れる',
    titleEn: 'Install time sync (chrony)',
    descriptionJa: 'chrony をインストールして時刻を自動同期します。ログの時刻ずれや証明書エラーを防ぎます。',
    descriptionEn: 'Installs chrony for accurate clock sync, avoiding log skew and certificate errors.',
    risk: 'safe',
    needsNetwork: true,
    packages: ['chrony'],
    lateCommands: () => ['curtin in-target -- systemctl enable chrony.service'],
  },
  {
    id: 'ufw-allow-ssh',
    titleJa: 'ファイアウォールを有効にして SSH だけ許可する',
    titleEn: 'Enable firewall, allow SSH only',
    descriptionJa:
      'ufw を有効にし、22/tcp のみ許可します。他のポートで待ち受けるサービスを後から入れる場合は自分で開放が必要です。',
    descriptionEn: 'Enables ufw and allows only 22/tcp. Other services will need their ports opened manually.',
    risk: 'caution',
    needsNetwork: false,
    packages: ['ufw'],
    lateCommands: () => [
      'curtin in-target -- ufw allow OpenSSH',
      'curtin in-target -- ufw --force enable',
    ],
  },
  {
    id: 'disable-cloud-init-net',
    titleJa: 'インストール後は cloud-init にネットワークを触らせない',
    titleEn: 'Stop cloud-init from managing the network',
    descriptionJa:
      '固定 IP を設定した物理サーバー向け。再起動のたびに cloud-init がネットワーク設定を書き戻すのを防ぎます。',
    descriptionEn:
      'For physical servers with a static IP. Prevents cloud-init from rewriting the network config on each boot.',
    risk: 'safe',
    needsNetwork: false,
    lateCommands: () => [
      'mkdir -p /target/etc/cloud/cloud.cfg.d',
      `printf '%s\\n' 'network: {config: disabled}' > /target/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`,
    ],
  },
  {
    id: 'ja-locale',
    titleJa: '日本語ロケールと日本語マニュアルを入れる',
    titleEn: 'Install Japanese locale and manpages',
    descriptionJa: 'language-pack-ja と manpages-ja をインストールします。サーバーの表示は英語のままです。',
    descriptionEn: 'Installs language-pack-ja and manpages-ja. The server UI language itself stays English.',
    risk: 'safe',
    needsNetwork: true,
    packages: ['language-pack-ja', 'manpages-ja'],
    lateCommands: () => [],
  },
]

/**
 * 知らない ID なら undefined を返す。
 *
 * プロファイルは手で編集できるし、新しい版で作ったものを古い版で開くこともある。
 * 生成や検証の途中で例外にすると、ユーザーには理由の分からない空の確認画面と
 * 反応しない書き込みボタンだけが残るので、生成側はこちらを使って読み飛ばす。
 */
export function findPreset(id: string): PostInstallPreset | undefined {
  return POST_INSTALL_PRESETS.find((p) => p.id === id)
}

export function getPreset(id: PostInstallPresetId): PostInstallPreset {
  const found = POST_INSTALL_PRESETS.find((p) => p.id === id)
  if (!found) throw new Error(`未知のプリセット: ${id}`)
  return found
}

// ---------------------------------------------------------------------------
// APT ミラー
// ---------------------------------------------------------------------------

export const APT_MIRROR_PRESETS: readonly Choice[] = [
  { value: 'http://jp.archive.ubuntu.com/ubuntu', labelJa: '日本 (jp.archive.ubuntu.com)', labelEn: 'Japan' },
  { value: 'http://archive.ubuntu.com/ubuntu', labelJa: '既定 (archive.ubuntu.com)', labelEn: 'Default' },
  { value: 'http://ftp.jaist.ac.jp/pub/Linux/ubuntu', labelJa: '日本 JAIST', labelEn: 'Japan (JAIST)' },
  { value: 'http://ftp.riken.jp/Linux/ubuntu', labelJa: '日本 理研', labelEn: 'Japan (RIKEN)' },
  { value: 'http://us.archive.ubuntu.com/ubuntu', labelJa: 'アメリカ', labelEn: 'United States' },
  { value: 'http://de.archive.ubuntu.com/ubuntu', labelJa: 'ドイツ', labelEn: 'Germany' },
]

/** よく入れるパッケージ（チェックボックスで選ばせる）。 */
export const COMMON_PACKAGES: readonly (Choice & { readonly needsNetwork: boolean })[] = [
  { value: 'openssh-server', labelJa: 'SSH サーバー', labelEn: 'SSH server', needsNetwork: false },
  { value: 'vim', labelJa: 'vim エディタ', labelEn: 'vim editor', needsNetwork: true },
  { value: 'curl', labelJa: 'curl', labelEn: 'curl', needsNetwork: true },
  { value: 'git', labelJa: 'git', labelEn: 'git', needsNetwork: true },
  { value: 'htop', labelJa: 'htop (プロセス監視)', labelEn: 'htop', needsNetwork: true },
  { value: 'tmux', labelJa: 'tmux', labelEn: 'tmux', needsNetwork: true },
  { value: 'net-tools', labelJa: 'net-tools (ifconfig 等)', labelEn: 'net-tools', needsNetwork: true },
  { value: 'build-essential', labelJa: 'build-essential (コンパイラ一式)', labelEn: 'build-essential', needsNetwork: true },
  { value: 'nfs-common', labelJa: 'NFS クライアント', labelEn: 'NFS client', needsNetwork: true },
  { value: 'lm-sensors', labelJa: 'lm-sensors (温度監視)', labelEn: 'lm-sensors', needsNetwork: true },
]
