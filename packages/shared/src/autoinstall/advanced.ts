// autoinstall の残りのキーのうち、Server 用途で意味があるものの型。
// すべて公式リファレンス (autoinstall-reference.rst) と subiquity の
// autoinstall-schema.json に対応している。

// ---------------------------------------------------------------------------
// kernel
// ---------------------------------------------------------------------------

/**
 * インストール先に入れるカーネル。
 * `package` と `flavor` は排他（スキーマの oneOf）。
 * Server の既定は `generic`。HWE を使いたいときに `flavor: hwe` を指定する。
 */
export type KernelChoice =
  /** `kernel` キーを出さない（ISO の既定） */
  | { readonly mode: 'default' }
  /** `kernel: {flavor: ...}` */
  | { readonly mode: 'flavor'; readonly flavor: string }
  /** `kernel: {package: ...}` */
  | { readonly mode: 'package'; readonly package: string }

export const KERNEL_FLAVORS = [
  { value: 'generic', labelJa: '標準 (generic)', labelEn: 'Standard (generic)' },
  { value: 'hwe', labelJa: 'HWE（新しいハードウェア向け）', labelEn: 'HWE (newer hardware)' },
  { value: 'generic-hwe', labelJa: 'generic-hwe', labelEn: 'generic-hwe' },
  { value: 'lowlatency', labelJa: '低レイテンシ (lowlatency)', labelEn: 'Low latency' },
] as const

// ---------------------------------------------------------------------------
// apt
// ---------------------------------------------------------------------------

/**
 * 追加の APT リポジトリ。curtin の `apt.sources` 形式で出力する。
 * `ppa:user/name` の短縮形は curtin が解釈してくれる。
 */
export interface AptSource {
  readonly id: string
  /** `sources` のキーになる名前。`.list` で終わるとそのファイル名になる。 */
  readonly name: string
  /** `ppa:user/name` または `deb [signed-by=...] https://... $RELEASE main` */
  readonly source: string
  /** ASCII armored の GPG 公開鍵。PPA の場合は不要。 */
  readonly key: string
}

/** 主ミラーがどれも使えなかったときの挙動。 */
export type AptFallback = 'abort' | 'continue-anyway' | 'offline-install'

export const APT_FALLBACK_CHOICES = [
  {
    value: 'abort',
    labelJa: 'インストールを中止する（既定）',
    labelEn: 'Abort the install (default)',
  },
  {
    value: 'offline-install',
    labelJa: 'ネットワーク無しで続行する',
    labelEn: 'Continue offline',
  },
  {
    value: 'continue-anyway',
    labelJa: '壊れたミラー設定のまま続行する',
    labelEn: 'Continue with the broken mirror',
  },
] as const

/** `ppa:` 形式か。 */
export function isPpaSource(source: string): boolean {
  return /^ppa:[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source.trim())
}

/** `deb` 行として最低限もっともらしいか。 */
export function isDebLineSource(source: string): boolean {
  return /^deb(-src)?\s+/.test(source.trim())
}

// ---------------------------------------------------------------------------
// swap / リセットパーティション
// ---------------------------------------------------------------------------

export type SwapMode = 'installer-default' | 'none' | 'size'

export interface SwapConfig {
  readonly mode: SwapMode
  /** `size` のときの大きさ（例 `4G`）。curtin のサイズ表記。 */
  readonly size: string
}

/** curtin のサイズ表記（`4G`, `512M`, `1073741824`）として妥当か。 */
export function isValidSizeSpec(value: string): boolean {
  return /^\d+(\.\d+)?[KMGT]?B?$/i.test(value.trim())
}

/**
 * リセットパーティション。インストーラの中身を丸ごと入れた FAT32 領域を作り、
 * メディア無しで再インストールできるようにする（OEM 向け）。
 */
export interface ResetPartitionConfig {
  readonly enabled: boolean
  /** 空なら自動（使用量の約 1.1 倍）。`12G` のように指定もできる。 */
  readonly size: string
}

// ---------------------------------------------------------------------------
// identity.groups
// ---------------------------------------------------------------------------

/**
 * 管理者ユーザーのグループ。
 * `append` は subiquity の既定グループ（sudo, admin など）に足す。
 * `override` は既定を無視して指定したものだけにする（sudo を外すと管理者でなくなる）。
 */
export type PrimaryUserGroups =
  | { readonly mode: 'default' }
  | { readonly mode: 'append'; readonly groups: readonly string[] }
  | { readonly mode: 'override'; readonly groups: readonly string[] }

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

/**
 * インストール進捗の送信先。
 * 対話セクションが 1 つでもあると subiquity はこのキーを無視する（リファレンスに明記）。
 */
export type ReportingTarget =
  /** `builtin: {type: print}` — tty1 とシリアルコンソールに出す */
  | { readonly kind: 'console' }
  /** `builtin: {type: none}` — 何も出さない */
  | { readonly kind: 'none' }
  | { readonly kind: 'rsyslog'; readonly destination: string }
  | { readonly kind: 'webhook'; readonly endpoint: string }

export function buildReporting(target: ReportingTarget): Record<string, unknown> {
  switch (target.kind) {
    case 'console':
      return { builtin: { type: 'print' } }
    case 'none':
      return { builtin: { type: 'none' } }
    case 'rsyslog':
      return { builtin: { type: 'print' }, central: { type: 'rsyslog', destination: target.destination } }
    case 'webhook':
      return { builtin: { type: 'print' }, hook: { type: 'webhook', endpoint: target.endpoint } }
  }
}

// ---------------------------------------------------------------------------
// Active Directory
// ---------------------------------------------------------------------------

/**
 * AD ドメイン参加。パスワードは autoinstall では渡せず、インストール中に聞かれる
 * （リファレンス: "The account password is requested during run time."）。
 * つまりこれを有効にすると完全無人ではなくなる。
 */
export interface ActiveDirectoryConfig {
  readonly enabled: boolean
  readonly adminName: string
  readonly domainName: string
}

// ---------------------------------------------------------------------------
// error-commands のプリセット
// ---------------------------------------------------------------------------

/**
 * インストール失敗時にログを集めるコマンド。
 * リファレンスの例そのまま + CIDATA へ書き戻す版。
 * ログは /var/log/installer に残るが、再起動すると消えるので USB に持ち出せると助かる。
 */
export const ERROR_LOG_COMMANDS: readonly string[] = [
  'tar -czf /var/log/installer-logs.tar.gz /var/log/installer/ || true',
  'journalctl -b > /var/log/installer-journal.log || true',
]

/** 失敗時のログを CIDATA パーティションに書き戻すコマンド（USB を挿し直せば読める）。 */
export function errorLogToSeedCommands(seedMountPath: string): string[] {
  return [
    `mkdir -p ${seedMountPath}`,
    // 読み書き可能でマウントし直す（読めなくてもインストール失敗の扱いは変えない）
    `mount -L CIDATA ${seedMountPath} || mount -L cidata ${seedMountPath} || true`,
    `cp /var/log/installer-logs.tar.gz ${seedMountPath}/installer-logs.tar.gz || true`,
    `cp /var/log/installer-journal.log ${seedMountPath}/installer-journal.log || true`,
    `sync || true`,
    `umount ${seedMountPath} || true`,
  ]
}
