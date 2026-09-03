import { parseDocument } from 'yaml'
import type { AutoinstallProfile } from './model.js'
import { SERIES_FEATURES } from './model.js'
import { buildAutoinstallObject, collectPackages } from './generate.js'
import { isValidSha512CryptHash, looksLikeCryptHash } from '../crypt/validate.js'
import { getPreset } from './presets.js'

// プロファイルの検証。JSON Schema による構文チェックだけでは「サーバーに触れなくなる設定」を防げないので、
// 意味論的な検査（ロックアウト、ネットワーク不要環境でのパッケージ指定など）を重視している。

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  readonly severity: IssueSeverity
  /** GUI がどのステップにジャンプすればよいかを示す */
  readonly field: string
  readonly messageJa: string
  readonly messageEn: string
}

export interface ValidationResult {
  readonly ok: boolean
  readonly issues: readonly ValidationIssue[]
}

// RFC 1123 のホスト名ラベル（先頭末尾は英数字、途中はハイフン可、最大 63 文字）
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
// useradd(8) が受け付ける形式。Debian/Ubuntu の NAME_REGEX 相当。
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/
// Ubuntu のインストーラが拒否する予約ユーザー名
const RESERVED_USERNAMES = new Set([
  'root',
  'daemon',
  'bin',
  'sys',
  'sync',
  'games',
  'man',
  'lp',
  'mail',
  'news',
  'uucp',
  'proxy',
  'www-data',
  'backup',
  'list',
  'irc',
  'nobody',
  'systemd-network',
  'systemd-resolve',
  'messagebus',
  'sshd',
  'admin',
])
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const SSH_KEY_RE = /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/=]+(\s+\S+)?$/

function isValidIPv4(value: string): boolean {
  if (!IPV4_RE.test(value)) return false
  return value.split('.').every((o) => Number(o) <= 255)
}

function isValidCidr(value: string): boolean {
  if (!CIDR_RE.test(value)) return false
  const host = value.split('/')[0]!
  return isValidIPv4(host)
}

/** プロファイル全体を検証する。 */
export function validateProfile(profile: AutoinstallProfile): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (
    severity: IssueSeverity,
    field: string,
    messageJa: string,
    messageEn: string,
  ): void => {
    issues.push({ severity, field, messageJa, messageEn })
  }
  const features = SERIES_FEATURES[profile.series]

  // --- 基本 ---
  if (!profile.basics.hostname) {
    add('error', 'basics.hostname', 'ホスト名を入力してください。', 'Enter a hostname.')
  } else if (!HOSTNAME_RE.test(profile.basics.hostname)) {
    add(
      'error',
      'basics.hostname',
      'ホスト名は英数字とハイフンのみ、先頭と末尾は英数字、63 文字以内です。',
      'Hostname may contain only letters, digits and hyphens, must start and end alphanumeric, max 63 chars.',
    )
  }
  if (!profile.basics.locale) {
    add('error', 'basics.locale', 'ロケールを選んでください。', 'Choose a locale.')
  }
  if (!profile.basics.keyboard.layout) {
    add('error', 'basics.keyboard', 'キーボード配列を選んでください。', 'Choose a keyboard layout.')
  }

  // --- ユーザー ---
  if (!profile.user.username) {
    add('error', 'user.username', 'ユーザー名を入力してください。', 'Enter a username.')
  } else if (!USERNAME_RE.test(profile.user.username)) {
    add(
      'error',
      'user.username',
      'ユーザー名は小文字英字かアンダースコアで始まり、小文字英数字・ハイフン・アンダースコアのみ、32 文字以内です。',
      'Username must start with a lowercase letter or underscore and contain only lowercase letters, digits, hyphens and underscores (max 32).',
    )
  } else if (RESERVED_USERNAMES.has(profile.user.username)) {
    add(
      'error',
      'user.username',
      `"${profile.user.username}" はシステムが予約している名前です。別の名前にしてください。`,
      `"${profile.user.username}" is reserved by the system. Choose another name.`,
    )
  }
  if (profile.user.username === profile.basics.hostname) {
    add(
      'warning',
      'user.username',
      'ユーザー名とホスト名が同じです。インストーラが拒否する場合があります。',
      'Username and hostname are identical; the installer may reject this.',
    )
  }
  if (!profile.user.passwordHash) {
    add(
      'error',
      'user.passwordHash',
      'パスワードを設定してください（ハッシュ化して保存されます）。',
      'Set a password. It is stored hashed.',
    )
  } else if (!looksLikeCryptHash(profile.user.passwordHash)) {
    add(
      'error',
      'user.passwordHash',
      'パスワードが平文のままです。crypt(3) ハッシュ（$6$ で始まる文字列）が必要です。',
      'The password is plain text. A crypt(3) hash starting with $6$ is required.',
    )
  } else if (!isValidSha512CryptHash(profile.user.passwordHash)) {
    add(
      'warning',
      'user.passwordHash',
      'パスワードハッシュが SHA-512 crypt の標準形式ではありません。ログインできるか確認してください。',
      'The password hash is not standard SHA-512 crypt. Verify that login works.',
    )
  }

  // --- SSH ---
  for (const [i, key] of profile.ssh.authorizedKeys.entries()) {
    if (!SSH_KEY_RE.test(key.trim())) {
      add(
        'error',
        `ssh.authorizedKeys[${i}]`,
        `${i + 1} 番目の SSH 公開鍵の形式が正しくありません（"ssh-ed25519 AAAA..." のような 1 行）。`,
        `SSH public key #${i + 1} is malformed. Expected one line like "ssh-ed25519 AAAA...".`,
      )
    }
  }
  if (!profile.ssh.installServer && profile.ssh.authorizedKeys.length > 0) {
    add(
      'warning',
      'ssh.installServer',
      'SSH 公開鍵を登録していますが SSH サーバーをインストールしない設定です。リモートログインできません。',
      'SSH keys are configured but the SSH server will not be installed, so remote login is impossible.',
    )
  }
  const hardened = profile.postInstall.presets.includes('ssh-harden')
  if (hardened && profile.ssh.authorizedKeys.length === 0) {
    add(
      'error',
      'ssh.authorizedKeys',
      'SSH のパスワード認証を無効にする設定ですが、公開鍵が 1 つも登録されていません。SSH でログインできなくなります。',
      'SSH password authentication is disabled but no public key is registered. You would be locked out of SSH.',
    )
  }
  if (!profile.ssh.allowPasswordAuth && profile.ssh.authorizedKeys.length === 0 && profile.ssh.installServer) {
    add(
      'error',
      'ssh.allowPasswordAuth',
      'SSH のパスワードログインを許可せず、公開鍵も登録されていません。SSH でログインできなくなります。',
      'SSH password login is disabled and no public key is registered. You would be locked out of SSH.',
    )
  }

  // --- ネットワーク ---
  if (profile.network.mode === 'static') {
    if (!isValidCidr(profile.network.address)) {
      add(
        'error',
        'network.address',
        'IP アドレスは "192.168.1.10/24" のように、サブネットマスクの長さを付けて入力してください。',
        'Enter the IP address with a prefix length, e.g. "192.168.1.10/24".',
      )
    }
    if (profile.network.gateway && !isValidIPv4(profile.network.gateway)) {
      add('error', 'network.gateway', 'ゲートウェイの IP アドレスが不正です。', 'The gateway address is invalid.')
    }
    if (!profile.network.gateway) {
      add(
        'warning',
        'network.gateway',
        'デフォルトゲートウェイが未設定です。外部ネットワークに接続できません。',
        'No default gateway is set; the machine cannot reach other networks.',
      )
    }
    for (const [i, ns] of profile.network.nameservers.entries()) {
      if (!isValidIPv4(ns)) {
        add('error', `network.nameservers[${i}]`, `DNS サーバー #${i + 1} の IP アドレスが不正です。`, `DNS server #${i + 1} is not a valid IP address.`)
      }
    }
    if (profile.network.nameservers.length === 0) {
      add(
        'warning',
        'network.nameservers',
        'DNS サーバーが未設定です。名前解決ができず apt が失敗します。',
        'No DNS server is set; name resolution and apt will fail.',
      )
    }
  } else if (profile.network.mode === 'raw') {
    const doc = parseDocument(profile.network.yaml)
    if (doc.errors.length > 0) {
      add('error', 'network.yaml', `ネットワーク YAML の構文エラー: ${doc.errors[0]!.message}`, `Network YAML syntax error: ${doc.errors[0]!.message}`)
    }
  }

  // --- ストレージ ---
  if (profile.storage.mode === 'raw') {
    const doc = parseDocument(profile.storage.yaml)
    if (doc.errors.length > 0) {
      add('error', 'storage.yaml', `ストレージ YAML の構文エラー: ${doc.errors[0]!.message}`, `Storage YAML syntax error: ${doc.errors[0]!.message}`)
    }
  } else {
    if (profile.storage.mode === 'zfs' && profile.storage.encryptionPassphrase) {
      add(
        'warning',
        'storage.encryptionPassphrase',
        'ZFS レイアウトでの暗号化はインストーラのバージョンによって挙動が異なります。実機で確認してください。',
        'Encryption with the ZFS layout behaves differently across installer versions. Verify on real hardware.',
      )
    }
    if (profile.storage.encryptionPassphrase && profile.storage.encryptionPassphrase.length < 8) {
      add(
        'error',
        'storage.encryptionPassphrase',
        'ディスク暗号化のパスフレーズが短すぎます（8 文字以上）。',
        'The disk encryption passphrase is too short (minimum 8 characters).',
      )
    }
    if (profile.storage.encryptionPassphrase) {
      add(
        'warning',
        'storage.encryptionPassphrase',
        'ディスク暗号化のパスフレーズは autoinstall の YAML に平文で書かれます。USB の取り扱いに注意してください。',
        'The disk encryption passphrase is written in plain text into the autoinstall YAML. Handle the USB stick accordingly.',
      )
    }
    if (profile.storage.match.kind === 'largest' || profile.storage.match.kind === 'smallest') {
      add(
        'info',
        'storage.match',
        '複数のディスクがある機器では、シリアル番号やパスで指定する方が安全です。',
        'On machines with several disks, matching by serial number or path is safer.',
      )
    }
  }

  // --- ソフトウェア / ネットワーク依存 ---
  const packages = collectPackages(profile)
  const needsNetworkPresets = profile.postInstall.presets.filter((id) => getPreset(id).needsNetwork)
  if ((packages.length > 0 || profile.software.snaps.length > 0 || needsNetworkPresets.length > 0) && profile.network.mode === 'static' && !profile.network.gateway) {
    add(
      'error',
      'software.packages',
      '追加パッケージ/snap を指定していますが、ゲートウェイが無いためインターネットに到達できません。',
      'Extra packages or snaps are configured but there is no gateway, so the internet is unreachable.',
    )
  }
  if (profile.software.ubuntuProToken && !/^C[1-9A-HJ-NP-Za-km-z]{23,29}$/.test(profile.software.ubuntuProToken)) {
    add(
      'error',
      'software.ubuntuProToken',
      'Ubuntu Pro のトークン形式が正しくありません（C で始まる 24〜30 文字）。',
      'The Ubuntu Pro token is malformed (starts with C, 24-30 characters).',
    )
  }
  if (!features.source && profile.software.sourceId === 'ubuntu-server-minimal') {
    add(
      'warning',
      'software.sourceId',
      `Ubuntu ${profile.series} の autoinstall には source キーがありません。最小構成の指定は無視されます。`,
      `Ubuntu ${profile.series} autoinstall has no source key; the minimal selection will be ignored.`,
    )
  }
  if (!features.kernelCrashDumps && profile.software.kernelCrashDumps !== null) {
    add(
      'warning',
      'software.kernelCrashDumps',
      `kernel-crash-dumps は Ubuntu ${profile.series} では未対応です。無視されます。`,
      `kernel-crash-dumps is not supported on Ubuntu ${profile.series} and will be ignored.`,
    )
  }

  // --- インストール後処理 ---
  for (const [i, f] of profile.postInstall.files.entries()) {
    if (!f.targetPath.startsWith('/')) {
      add('error', `postInstall.files[${i}].targetPath`, `追加ファイル #${i + 1} の配置先は絶対パスにしてください。`, `File #${i + 1} needs an absolute target path.`)
    }
    if (!/^0?[0-7]{3}$/.test(f.mode)) {
      add('error', `postInstall.files[${i}].mode`, `追加ファイル #${i + 1} のパーミッションは 0644 のような 8 進数で指定してください。`, `File #${i + 1} permission must be octal such as 0644.`)
    }
    if (!f.name || /[\\/:*?"<>|]/.test(f.name)) {
      add('error', `postInstall.files[${i}].name`, `追加ファイル #${i + 1} のファイル名に使えない文字があります。`, `File #${i + 1} has an invalid file name.`)
    }
  }
  if (profile.postInstall.presets.includes('sudo-nopasswd')) {
    add(
      'info',
      'postInstall.presets',
      'パスワード無し sudo を有効にしています。そのユーザーを奪われると即座に root 権限を取られます。',
      'Passwordless sudo is enabled. Anyone who takes that account gets root immediately.',
    )
  }

  // --- 上書き YAML ---
  if (profile.advanced.rawOverlayYaml.trim()) {
    const doc = parseDocument(profile.advanced.rawOverlayYaml)
    if (doc.errors.length > 0) {
      add('error', 'advanced.rawOverlayYaml', `上書き YAML の構文エラー: ${doc.errors[0]!.message}`, `Overlay YAML syntax error: ${doc.errors[0]!.message}`)
    } else {
      const js: unknown = doc.toJS()
      if (js !== null && (typeof js !== 'object' || Array.isArray(js))) {
        add('error', 'advanced.rawOverlayYaml', '上書き YAML はキーと値のマッピングにしてください。', 'The overlay YAML must be a mapping.')
      }
    }
  }
  if (/[;&|]/.test(profile.advanced.extraKernelArgs)) {
    add(
      'error',
      'advanced.extraKernelArgs',
      'カーネル引数に ; & | は使えません（GRUB の設定行が壊れます）。',
      'Kernel arguments cannot contain ; & | because they break the GRUB config line.',
    )
  }

  // --- 完全無人になるか ---
  if (profile.behavior.interactiveSections.length > 0) {
    add(
      'info',
      'behavior.interactiveSections',
      '対話セクションが指定されているため、インストールは途中で入力待ちになります。',
      'Interactive sections are configured, so the install will pause for input.',
    )
  }

  // 生成そのものが失敗しないかを最後に確認する
  try {
    buildAutoinstallObject(profile)
  } catch (err) {
    add('error', 'generate', `YAML の生成に失敗しました: ${(err as Error).message}`, `Failed to generate YAML: ${(err as Error).message}`)
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}
