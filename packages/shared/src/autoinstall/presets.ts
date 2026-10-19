import type { MsgKey } from '../i18n/index.js'
import type { PostInstallPresetId, UbuntuSeries } from './model.js'

// GUI に並べる選択肢と、インストール後処理のプリセット。
// 「初心者が意味を理解して選べる」ことを最優先に、説明文（日本語・英語）を必ず持たせる。
//
// **表示名は辞書のキーで持つ。** 以前はここに `labelJa` / `labelEn` を直接書いていたが、
// i18n の機構が 2 つあると、新しい文言を足すときに片方だけが更新される
// （`ja.ts` に足しても、この配列は誰も見に来ない）。訳文は `ja.ts` / `en.ts` にあり、
// ここが持つのは**どのキーを引くか**だけ。`value` は autoinstall に出る設定そのものなので
// 表示名の運び方を変えても触らない。

export interface Choice {
  readonly value: string
  /** 画面に出す名前。`ja.ts` / `en.ts` の実在するキーであること（テストが全要素を検査する）。 */
  readonly label: MsgKey
}

/** autoinstall の `locale` キーに入れる値の候補（UI 表示言語の LOCALES とは別物）。 */
export const LOCALE_CHOICES: readonly Choice[] = [
  { value: 'en_US.UTF-8', label: 'basics.localeEnUs' },
  { value: 'ja_JP.UTF-8', label: 'basics.localeJaJp' },
  { value: 'en_GB.UTF-8', label: 'basics.localeEnGb' },
  { value: 'de_DE.UTF-8', label: 'basics.localeDeDe' },
  { value: 'fr_FR.UTF-8', label: 'basics.localeFrFr' },
  { value: 'es_ES.UTF-8', label: 'basics.localeEsEs' },
  { value: 'pt_BR.UTF-8', label: 'basics.localePtBr' },
  { value: 'zh_CN.UTF-8', label: 'basics.localeZhCn' },
  { value: 'ko_KR.UTF-8', label: 'basics.localeKoKr' },
  { value: 'C.UTF-8', label: 'basics.localeC' },
]

export interface KeyboardChoice extends Choice {
  readonly layout: string
  readonly variant: string
}

/** keyboard.layout / variant の候補。日本語配列は variant を空にする。 */
export const KEYBOARDS: readonly KeyboardChoice[] = [
  { value: 'us:', layout: 'us', variant: '', label: 'basics.keyboardUs' },
  { value: 'jp:', layout: 'jp', variant: '', label: 'basics.keyboardJp' },
  { value: 'us:dvorak', layout: 'us', variant: 'dvorak', label: 'basics.keyboardUsDvorak' },
  { value: 'gb:', layout: 'gb', variant: '', label: 'basics.keyboardGb' },
  { value: 'de:', layout: 'de', variant: '', label: 'basics.keyboardDe' },
  { value: 'fr:', layout: 'fr', variant: '', label: 'basics.keyboardFr' },
  { value: 'es:', layout: 'es', variant: '', label: 'basics.keyboardEs' },
  { value: 'kr:kr104', layout: 'kr', variant: 'kr104', label: 'basics.keyboardKr104' },
  { value: 'cn:', layout: 'cn', variant: '', label: 'basics.keyboardCn' },
]

/** timezone の候補。`geoip` は IP から自動判定。 */
export const TIMEZONES: readonly Choice[] = [
  { value: 'Asia/Tokyo', label: 'basics.timezoneTokyo' },
  { value: 'UTC', label: 'basics.timezoneUtc' },
  { value: 'geoip', label: 'basics.timezoneGeoip' },
  { value: 'America/Los_Angeles', label: 'basics.timezoneLosAngeles' },
  { value: 'America/New_York', label: 'basics.timezoneNewYork' },
  { value: 'Europe/London', label: 'basics.timezoneLondon' },
  { value: 'Europe/Berlin', label: 'basics.timezoneBerlin' },
  { value: 'Asia/Singapore', label: 'basics.timezoneSingapore' },
  { value: 'Asia/Seoul', label: 'basics.timezoneSeoul' },
  { value: 'Australia/Sydney', label: 'basics.timezoneSydney' },
]

// ---------------------------------------------------------------------------
// インストール後処理プリセット
// ---------------------------------------------------------------------------

export interface PostInstallPreset {
  readonly id: PostInstallPresetId
  /** 見出し。`ja.ts` / `en.ts` の実在するキーであること。 */
  readonly title: MsgKey
  /** 説明文。同上。 */
  readonly description: MsgKey
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
    title: 'postinstall.presetSudoNopasswdTitle',
    description: 'postinstall.presetSudoNopasswdDesc',
    risk: 'caution',
    needsNetwork: false,
    lateCommands: (ctx) => [
      `echo ${shellQuote(`${ctx.username} ALL=(ALL) NOPASSWD:ALL`)} > /target/etc/sudoers.d/90-autoinstall-${ctx.username}`,
      `chmod 0440 /target/etc/sudoers.d/90-autoinstall-${ctx.username}`,
    ],
  },
  {
    id: 'ssh-harden',
    title: 'postinstall.presetSshHardenTitle',
    description: 'postinstall.presetSshHardenDesc',
    risk: 'caution',
    needsNetwork: false,
    lateCommands: () => [
      'mkdir -p /target/etc/ssh/sshd_config.d',
      `printf '%s\\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' > /target/etc/ssh/sshd_config.d/90-autoinstall-harden.conf`,
    ],
  },
  {
    id: 'unattended-upgrades',
    title: 'postinstall.presetUnattendedUpgradesTitle',
    description: 'postinstall.presetUnattendedUpgradesDesc',
    risk: 'safe',
    needsNetwork: true,
    packages: ['unattended-upgrades'],
    lateCommands: () => [
      'curtin in-target -- systemctl enable unattended-upgrades.service',
    ],
  },
  {
    id: 'qemu-guest-agent',
    title: 'postinstall.presetQemuGuestAgentTitle',
    description: 'postinstall.presetQemuGuestAgentDesc',
    risk: 'safe',
    needsNetwork: true,
    packages: ['qemu-guest-agent'],
    lateCommands: () => ['curtin in-target -- systemctl enable qemu-guest-agent.service'],
  },
  {
    id: 'docker-ce',
    title: 'postinstall.presetDockerCeTitle',
    description: 'postinstall.presetDockerCeDesc',
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
    title: 'postinstall.presetChronyNtpTitle',
    description: 'postinstall.presetChronyNtpDesc',
    risk: 'safe',
    needsNetwork: true,
    packages: ['chrony'],
    lateCommands: () => ['curtin in-target -- systemctl enable chrony.service'],
  },
  {
    id: 'ufw-allow-ssh',
    title: 'postinstall.presetUfwAllowSshTitle',
    description: 'postinstall.presetUfwAllowSshDesc',
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
    title: 'postinstall.presetDisableCloudInitNetTitle',
    description: 'postinstall.presetDisableCloudInitNetDesc',
    risk: 'safe',
    needsNetwork: false,
    lateCommands: () => [
      'mkdir -p /target/etc/cloud/cloud.cfg.d',
      `printf '%s\\n' 'network: {config: disabled}' > /target/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`,
    ],
  },
  {
    id: 'ja-locale',
    title: 'postinstall.presetJaLocaleTitle',
    description: 'postinstall.presetJaLocaleDesc',
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
  if (!found) throw new Error(`unknown preset: ${id}`)
  return found
}

// ---------------------------------------------------------------------------
// APT ミラー
// ---------------------------------------------------------------------------

export const APT_MIRROR_PRESETS: readonly Choice[] = [
  { value: 'http://jp.archive.ubuntu.com/ubuntu', label: 'software.aptMirrorPresetJp' },
  { value: 'http://archive.ubuntu.com/ubuntu', label: 'software.aptMirrorPresetDefault' },
  { value: 'http://ftp.jaist.ac.jp/pub/Linux/ubuntu', label: 'software.aptMirrorPresetJaist' },
  { value: 'http://ftp.riken.jp/Linux/ubuntu', label: 'software.aptMirrorPresetRiken' },
  { value: 'http://us.archive.ubuntu.com/ubuntu', label: 'software.aptMirrorPresetUs' },
  { value: 'http://de.archive.ubuntu.com/ubuntu', label: 'software.aptMirrorPresetDe' },
]

/** よく入れるパッケージ（チェックボックスで選ばせる）。 */
export const COMMON_PACKAGES: readonly (Choice & { readonly needsNetwork: boolean })[] = [
  { value: 'openssh-server', label: 'software.packageOpensshServer', needsNetwork: false },
  { value: 'vim', label: 'software.packageVim', needsNetwork: true },
  { value: 'curl', label: 'software.packageCurl', needsNetwork: true },
  { value: 'git', label: 'software.packageGit', needsNetwork: true },
  { value: 'htop', label: 'software.packageHtop', needsNetwork: true },
  { value: 'tmux', label: 'software.packageTmux', needsNetwork: true },
  { value: 'net-tools', label: 'software.packageNetTools', needsNetwork: true },
  { value: 'build-essential', label: 'software.packageBuildEssential', needsNetwork: true },
  { value: 'nfs-common', label: 'software.packageNfsCommon', needsNetwork: true },
  { value: 'lm-sensors', label: 'software.packageLmSensors', needsNetwork: true },
]
