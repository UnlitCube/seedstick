import { parseDocument } from 'yaml'
import type { AutoinstallProfile } from './model.js'
import { SERIES_FEATURES } from './model.js'
import { buildAutoinstallObject, collectPackages } from './generate.js'
import { isValidSha512CryptHash, looksLikeCryptHash } from '../crypt/validate.js'
import { getPreset } from './presets.js'
import { ARCHIVE_REQUIREMENTS } from './provisioning.js'
import { CUDA_REPO_DISTRO, cudaPackages, isValidServiceName } from './provisioning.js'
import { isDebLineSource, isPpaSource, isValidSizeSpec } from './advanced.js'
import {
  interactiveSectionsFor,
  isSafePresetLabel,
  isSafeRuntimeValue,
  usesKernelArgs,
} from './runtime-values.js'

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
// netplan の match.macaddress に入る形
const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
// `\s` は改行も含むので、`(\s+\S+)?` のままだとコメント欄に改行を書けてしまう。
// 生成側はヒアドキュメントをやめて printf にしたので実害は無くなったが、
// 「1 行 1 鍵」は authorized_keys の形式そのものなので検証でも守る。
const SSH_KEY_RE =
  /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[ \t]+[A-Za-z0-9+/=]+([ \t]+[^\r\n]*)?$/

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
/**
 * 知らないプリセット ID を落とす。
 *
 * `getPreset` は未知の ID で例外を投げる。プロファイルは手で編集できるし、
 * 新しい版で作ったものを古い版で開くこともあるので、ここで弾かないと
 * 検証自体が例外で抜けて「理由の分からない空の確認画面」になる。
 */
function knownPresetIds(profile: AutoinstallProfile): {
  known: AutoinstallProfile['postInstall']['presets'][number][]
  unknown: string[]
} {
  const known: AutoinstallProfile['postInstall']['presets'][number][] = []
  const unknown: string[] = []
  for (const id of profile.postInstall.presets) {
    try {
      getPreset(id)
      known.push(id)
    } catch {
      unknown.push(String(id))
    }
  }
  return { known, unknown }
}

/** 上書き YAML が書き換えるトップレベルのキー。壊れた YAML でも例外にしない。 */
function overlayTopLevelKeys(yamlText: string): string[] {
  try {
    const doc = parseDocument(yamlText)
    if (doc.errors.length > 0) return []
    const js = doc.toJS() as unknown
    if (js === null || typeof js !== 'object' || Array.isArray(js)) return []
    return Object.keys(js as Record<string, unknown>)
  } catch {
    return []
  }
}

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
  // 知らないプリセット ID があると getPreset が投げる。検証が例外で抜けると
  // 確認画面が理由なく空になるので、ここで分けて以降は known だけを使う。
  const presets = knownPresetIds(profile)
  for (const id of presets.unknown) {
    add(
      'error',
      'postInstall.presets',
      `知らない設定 "${id}" が含まれています。新しい版で作られたプロファイルかもしれません。`,
      `Unknown preset "${id}". The profile may have been created by a newer version.`,
    )
  }
  // インストール時に手入力になるセクション（設定と「実行時に決める値」の合成）
  const interactive = [
    ...new Set([...profile.behavior.interactiveSections, ...interactiveSectionsFor(profile.runtimeValues)]),
  ]

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
      if (profile.storage.mode !== 'lvm') {
        // layout.password は lvm レイアウトにしか無い。他では黙って無視される。
        add(
          'error',
          'storage.encryptionPassphrase',
          `ディスク暗号化は LVM レイアウトでのみ使えます（${profile.storage.mode} では無視されます）。`,
          `Disk encryption only works with the LVM layout; it is ignored for ${profile.storage.mode}.`,
        )
      }
    }
    // 指定方法を選んだのに中身が空だと、一致するディスクが 1 台も無くなる。
    // 手で編集された JSON ではキー自体が無いことがあるので、必ず型を確かめる
    // （検証が例外で抜けると確認画面が理由なく空になり、書き込みボタンが沈黙する）。
    const m = profile.storage.match as { kind: string } & Record<string, unknown>
    const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
    const emptyMatch =
      (m.kind === 'serial' && !text(m['serial'])) ||
      (m.kind === 'path' && !text(m['path'])) ||
      (m.kind === 'model' && !text(m['model']))
    if (emptyMatch) {
      add(
        'error',
        'storage.match',
        'ディスクの指定方法を選んだので、その値も入れてください（空だと一致するディスクがありません）。',
        'A disk match kind was chosen but left empty, so no disk will match.',
      )
    }

    // 実行時にディスクを決める設定なら、ここの match は使われないので助言しない。
    //
    // `kind: 'any'` は `match: {}` を出力する。subiquity から見ると
    // 「どのディスクでもよい」なので、複数ディスク機では**どれを消すか分からない**。
    // 最も危険な指定なのに、より安全な largest / smallest にだけ注意書きがあり、
    // ここだけ無言だった（落とし穴 22 と同じ形の事故になる）。
    if (profile.runtimeValues.disk === 'fixed' && profile.storage.match.kind === 'any') {
      add(
        'warning',
        'storage.match',
        'インストール先を「どのディスクでもよい」にしています。'
          + '複数のディスクがある機器では、どれが消えるか分かりません。'
          + 'シリアル番号やパスで指定してください。',
        'The install target is set to "any disk". On a machine with several disks '
          + 'there is no way to tell which one will be erased. Match by serial number or path.',
      )
    }
    if (
      profile.runtimeValues.disk === 'fixed' &&
      (profile.storage.match.kind === 'largest' || profile.storage.match.kind === 'smallest')
    ) {
      add(
        'info',
        'storage.match',
        '複数のディスクがある機器では、シリアル番号やパスで指定する方が安全です。',
        'On machines with several disks, matching by serial number or path is safer.',
      )
    }
  }

  // --- アプリ展開のアーカイブ形式 ---
  // 手で編集された JSON には知らない形式が入りうる。生成側は読み飛ばすので、
  // 「設定したのに展開されない」ことをここで伝える。
  for (const d of profile.postInstall.deployments) {
    if (d.kind !== 'archive') continue
    if (!Object.hasOwn(ARCHIVE_REQUIREMENTS, d.archiveFormat)) {
      add(
        'error',
        'postInstall.deployments',
        `展開 "${d.name}" のアーカイブ形式 "${String(d.archiveFormat)}" は対応していません。`,
        `Deployment "${d.name}" uses an unsupported archive format "${String(d.archiveFormat)}".`,
      )
    }
  }

  // --- 追加ファイル / 展開の所有者が実在するか ---
  // `chown` は存在しないユーザーだと非ゼロで終わる。late-commands の失敗は
  // インストール全体の中断になるので、**全部書き終わった最後の段階で**倒れる。
  // サービスの実行ユーザーには同じ検証があるのに、こちらには無かった。
  {
    const created = new Set<string>([profile.user.username])
    for (const u of profile.postInstall.additionalUsers) if (u.username) created.add(u.username)
    const known = (name: string): boolean =>
      name === '' || name === 'root' || name === 'nobody' || created.has(name)

    for (const f of profile.postInstall.files) {
      const owner = (f.owner ?? '').split(':')[0] ?? ''
      if (!known(owner)) {
        add(
          'warning',
          'postInstall.files',
          `ファイル "${f.name}" の所有者 "${owner}" はこの設定では作成されません（既存のユーザーでなければ、インストールが最後の段階で失敗します）。`,
          `File "${f.name}" is owned by "${owner}", which this config does not create. Unless it already exists, the install fails at the very end.`,
        )
      }
    }
    for (const d of profile.postInstall.deployments) {
      if (!known(d.owner ?? '')) {
        add(
          'warning',
          'postInstall.deployments',
          `展開 "${d.name}" の所有者 "${d.owner}" はこの設定では作成されません（既存のユーザーでなければ、インストールが最後の段階で失敗します）。`,
          `Deployment "${d.name}" is owned by "${d.owner}", which this config does not create. Unless it already exists, the install fails at the very end.`,
        )
      }
    }
  }

  // --- リセットパーティション ---
  // 22.04 の subiquity には無い。storage セクションはスキーマ上中身を検証しないので
  // 出しても落ちず、単に作られない。UI からも消えるため、有効のまま残った設定に
  // 気づけない（「設定したのに効かない」の典型）。
  if (!SERIES_FEATURES[profile.series].resetPartition && profile.storage.mode !== 'raw') {
    if (profile.storage.resetPartition.enabled) {
      add(
        'warning',
        'storage.resetPartition',
        `Ubuntu ${profile.series} にはリセットパーティションがありません（設定は無視されます）。`,
        `Ubuntu ${profile.series} has no reset partition; the setting is ignored.`,
      )
    }
  }

  // --- ミラーが使えないときの動作 ---
  // 22.04 のスキーマは apt.fallback を宣言していないので出力しない。
  // 既定と違う値を選んでいるなら、効かないことを伝える。
  if (!SERIES_FEATURES[profile.series].aptFallback && profile.apt.fallback !== 'abort') {
    add(
      'warning',
      'apt.fallback',
      `Ubuntu ${profile.series} では「ミラーが使えないときの動作」を指定できません（無視されます）。`,
      `Ubuntu ${profile.series} does not support the apt mirror fallback setting; it is ignored.`,
    )
  }

  // --- GPU / CUDA のツールキット名 ---
  // `cuda-toolkit-13-3` のようなピン留めを自由入力で許しているので、
  // apt のパッケージ名として妥当な形だけを通す（生成側でもクォートしているが、
  // 「検証か生成のどちらか一方」に頼らない）。
  {
    const gpu = profile.software.gpu
    const toolkit = typeof gpu.toolkit === 'string' ? gpu.toolkit : ''
    if (gpu.enabled && toolkit && toolkit !== 'latest' && toolkit !== 'none') {
      if (!/^[a-z0-9][a-z0-9+._-]*$/.test(toolkit)) {
        add(
          'error',
          'software.gpu.toolkit',
          `CUDA ツールキット名 "${toolkit}" が apt のパッケージ名として不正です。`,
          `The CUDA toolkit name "${toolkit}" is not a valid apt package name.`,
        )
      }
    }
  }

  // --- 追加ファイル / 展開の所有者 ---
  // chown にそのまま渡るので、ユーザー名として妥当な形だけを許す。
  const OWNER_RE = /^[a-z_][a-z0-9_-]{0,31}(:[a-z_][a-z0-9_-]{0,31})?$/
  for (const f of profile.postInstall.files) {
    if (f.owner && !OWNER_RE.test(f.owner)) {
      add(
        'error',
        'postInstall.files',
        `ファイル "${f.name}" の所有者 "${f.owner}" が不正です（ユーザー名、または user:group で書いてください）。`,
        `File "${f.name}" has an invalid owner "${f.owner}"; use a user name or user:group.`,
      )
    }
  }
  for (const d of profile.postInstall.deployments) {
    for (const [label, value] of [
      ['所有者', d.owner],
      ['グループ', d.group],
    ] as const) {
      if (value && !/^[a-z_][a-z0-9_-]{0,31}$/.test(value)) {
        add(
          'error',
          'postInstall.deployments',
          `展開 "${d.name}" の${label} "${value}" が不正です。`,
          `Deployment "${d.name}" has an invalid ${label === '所有者' ? 'owner' : 'group'} "${value}".`,
        )
      }
    }
  }

  // --- ネットワークカードの指定 ---
  // netplan のキーや match にそのまま入るので、空や不正な形は実機で必ず失敗する。
  if (profile.network.mode !== 'raw' && profile.network.mode !== 'installer-default') {
    const target = profile.network.target
    if (target.kind === 'name') {
      const name = typeof target.name === 'string' ? target.name.trim() : ''
      if (!name) {
        add(
          'error',
          'network.target',
          'ネットワークカードの名前が空です（netplan のキーになるので必須です）。',
          'The interface name is empty; netplan needs it as the key.',
        )
      } else if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) {
        add(
          'error',
          'network.target',
          `ネットワークカードの名前 "${name}" が不正です（英字で始まり、英数字と . _ - のみ）。`,
          `The interface name "${name}" is invalid; use letters, digits and . _ - starting with a letter.`,
        )
      }
    }
    if (target.kind === 'mac') {
      const mac = typeof target.macaddress === 'string' ? target.macaddress.trim() : ''
      if (!MAC_RE.test(mac)) {
        add(
          'error',
          'network.target',
          'MAC アドレスは "aa:bb:cc:dd:ee:ff" の形式で入力してください。',
          'Enter the MAC address as "aa:bb:cc:dd:ee:ff".',
        )
      }
    }
  }

  // --- APT ミラー ---
  // custom を選んだのに URI が空だと、mirror-selection ごと出力から消える。
  // 「速いミラーを指定したのに既定のまま」という気づきにくい遅さになる。
  if (profile.apt.mode === 'custom' && !profile.apt.primaryUri.trim()) {
    add(
      'error',
      'apt.primaryUri',
      'ミラーの URL を入力してください（空だと既定のミラーが使われます）。',
      'Enter the mirror URL; leaving it empty silently falls back to the default mirror.',
    )
  }

  // --- 生 YAML による上書き ---
  // rawOverlayYaml は生成結果に深くマージされるので、ここで storage や identity を
  // 書き換えると GUI 側のディスク検証をすべて迂回できる。止めはしないが必ず知らせる。
  if (profile.advanced.rawOverlayYaml.trim()) {
    const overridden = overlayTopLevelKeys(profile.advanced.rawOverlayYaml)
    const dangerous = overridden.filter((k) => k === 'storage' || k === 'identity')
    if (dangerous.length > 0) {
      add(
        'warning',
        'advanced.rawOverlayYaml',
        `上書き YAML が ${dangerous.join(' / ')} を書き換えています。画面のディスク・ユーザー設定は無効になり、ここに書いた内容が使われます。`,
        `The overlay YAML overrides ${dangerous.join(' / ')}, so the disk and user settings from the UI no longer apply.`,
      )
    }
  }

  // --- ソフトウェア / ネットワーク依存 ---
  const packages = collectPackages(profile)
  const needsNetworkPresets = presets.known.filter((id) => getPreset(id).needsNetwork)
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

  // --- 追加ユーザー ---
  const allUsernames = new Set<string>([profile.user.username])
  for (const [i, u] of profile.postInstall.additionalUsers.entries()) {
    const where = `postInstall.additionalUsers[${i}]`
    if (!u.username) {
      add('error', `${where}.username`, `追加ユーザー #${i + 1} の名前が空です。`, `Additional user #${i + 1} has no username.`)
    } else if (!USERNAME_RE.test(u.username)) {
      add(
        'error',
        `${where}.username`,
        `追加ユーザー "${u.username}" の名前に使えない文字があります。`,
        `Additional user "${u.username}" has an invalid username.`,
      )
    } else if (RESERVED_USERNAMES.has(u.username)) {
      add(
        'error',
        `${where}.username`,
        `"${u.username}" はシステムが予約している名前です。`,
        `"${u.username}" is reserved by the system.`,
      )
    } else if (allUsernames.has(u.username)) {
      add(
        'error',
        `${where}.username`,
        `ユーザー名 "${u.username}" が重複しています。`,
        `Username "${u.username}" is duplicated.`,
      )
    }
    allUsernames.add(u.username)

    if (u.passwordHash && !looksLikeCryptHash(u.passwordHash)) {
      add(
        'error',
        `${where}.passwordHash`,
        `追加ユーザー "${u.username}" のパスワードが平文のままです。`,
        `The password for "${u.username}" is plain text.`,
      )
    }
    if (!u.passwordHash && u.sshAuthorizedKeys.length === 0 && !u.systemAccount) {
      add(
        'warning',
        `${where}.passwordHash`,
        `"${u.username}" はパスワードも SSH 鍵も無いためログインできません（アカウントはロックされます）。`,
        `"${u.username}" has neither a password nor an SSH key and cannot log in (the account will be locked).`,
      )
    }
    for (const [k, key] of u.sshAuthorizedKeys.entries()) {
      if (!SSH_KEY_RE.test(key.trim())) {
        add(
          'error',
          `${where}.sshAuthorizedKeys[${k}]`,
          `"${u.username}" の ${k + 1} 番目の SSH 公開鍵の形式が正しくありません。`,
          `SSH key #${k + 1} for "${u.username}" is malformed.`,
        )
      }
    }
    if (u.sudo === 'nopasswd') {
      add(
        'info',
        `${where}.sudo`,
        `"${u.username}" はパスワード無しで sudo を使えます。`,
        `"${u.username}" can use sudo without a password.`,
      )
    }
  }

  // --- アプリの展開 ---
  for (const [i, d] of profile.postInstall.deployments.entries()) {
    const where = `postInstall.deployments[${i}]`
    if (!d.targetPath.startsWith('/')) {
      add(
        'error',
        `${where}.targetPath`,
        `展開 #${i + 1} の配置先は絶対パスにしてください。`,
        `Deployment #${i + 1} needs an absolute target path.`,
      )
    }
    if (!d.name || /[\\/:*?"<>|]/.test(d.name)) {
      add(
        'error',
        `${where}.name`,
        `展開 #${i + 1} のファイル名に使えない文字があります。`,
        `Deployment #${i + 1} has an invalid file name.`,
      )
    }
    if (d.kind === 'file' && !/^0?[0-7]{3}$/.test(d.mode)) {
      add(
        'error',
        `${where}.mode`,
        `展開 #${i + 1} のパーミッションは 0644 のような 8 進数で指定してください。`,
        `Deployment #${i + 1} permission must be octal such as 0644.`,
      )
    }
    if (d.source.kind === 'url') {
      if (!/^https?:\/\//.test(d.source.url)) {
        add('error', `${where}.source.url`, `展開 #${i + 1} の URL が正しくありません。`, `Deployment #${i + 1} has an invalid URL.`)
      }
      if (!d.source.sha256) {
        add(
          'warning',
          `${where}.source.sha256`,
          `展開 #${i + 1} は URL から取得しますが SHA-256 が未設定です。改ざんを検出できません。`,
          `Deployment #${i + 1} downloads from a URL without a SHA-256 checksum, so tampering cannot be detected.`,
        )
      } else if (!/^[0-9a-f]{64}$/i.test(d.source.sha256)) {
        add(
          'error',
          `${where}.source.sha256`,
          `展開 #${i + 1} の SHA-256 は 64 桁の 16 進数です。`,
          `Deployment #${i + 1} SHA-256 must be 64 hex characters.`,
        )
      }
    }
    if (d.source.kind === 'host-file' && !d.source.path) {
      add(
        'error',
        `${where}.source.path`,
        `展開 #${i + 1} の元ファイルが選ばれていません。`,
        `Deployment #${i + 1} has no source file selected.`,
      )
    }
  }

  // --- systemd サービス ---
  const serviceNames = new Set<string>()
  for (const [i, svc] of profile.postInstall.services.entries()) {
    const where = `postInstall.services[${i}]`
    if (!isValidServiceName(svc.name)) {
      add(
        'error',
        `${where}.name`,
        `サービス #${i + 1} の名前が不正です（英数字と . _ - @ のみ、末尾に .service は付けません）。`,
        `Service #${i + 1} has an invalid name (letters, digits and . _ - @ only; do not append .service).`,
      )
    } else if (serviceNames.has(svc.name)) {
      add('error', `${where}.name`, `サービス名 "${svc.name}" が重複しています。`, `Service name "${svc.name}" is duplicated.`)
    }
    serviceNames.add(svc.name)
    if (!svc.execStart.trim()) {
      add('error', `${where}.execStart`, `サービス "${svc.name}" の実行コマンドが空です。`, `Service "${svc.name}" has no ExecStart command.`)
    } else if (!svc.execStart.trim().startsWith('/')) {
      add(
        'warning',
        `${where}.execStart`,
        `サービス "${svc.name}" の実行コマンドは絶対パスにしてください（systemd は PATH を解決しません）。`,
        `ExecStart for "${svc.name}" should be an absolute path; systemd does not resolve PATH.`,
      )
    }
    if (svc.user && svc.user !== 'root' && svc.user !== 'nobody' && !allUsernames.has(svc.user)) {
      add(
        'warning',
        `${where}.user`,
        `サービス "${svc.name}" が使うユーザー "${svc.user}" はこの設定では作成されません。`,
        `Service "${svc.name}" runs as "${svc.user}", which this config does not create.`,
      )
    }
    if (svc.group && svc.group !== 'root' && !allUsernames.has(svc.group)) {
      add(
        'info',
        `${where}.group`,
        `サービス "${svc.name}" のグループ "${svc.group}" はこの設定では作成されません（既存のグループなら問題ありません）。`,
        `Service "${svc.name}" uses the group "${svc.group}", which this config does not create. Fine if it already exists.`,
      )
    }
    for (const [k, e] of svc.environment.entries()) {
      if (e.trim() && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(e.trim())) {
        add(
          'error',
          `${where}.environment[${k}]`,
          `サービス "${svc.name}" の環境変数は KEY=VALUE の形式で書いてください。`,
          `Environment entries for "${svc.name}" must be KEY=VALUE.`,
        )
      }
    }
  }

  // --- GPU / CUDA ---
  if (profile.software.gpu.enabled) {
    if (CUDA_REPO_DISTRO[profile.series] === null) {
      add(
        'error',
        'software.gpu',
        `NVIDIA は Ubuntu ${profile.series} 向けの CUDA リポジトリを提供していません。LTS 版（22.04 / 24.04 / 26.04）を使ってください。`,
        `NVIDIA does not publish a CUDA repository for Ubuntu ${profile.series}. Use an LTS release (22.04 / 24.04 / 26.04).`,
      )
    }
    if (cudaPackages(profile.software.gpu).length === 0) {
      add(
        'warning',
        'software.gpu',
        'GPU 設定が有効ですが、ドライバもツールキットも選ばれていません。',
        'GPU setup is enabled but neither a driver nor a toolkit is selected.',
      )
    }
    if (profile.software.gpu.containerToolkit && !profile.postInstall.presets.includes('docker-ce')) {
      add(
        'warning',
        'software.gpu.containerToolkit',
        'コンテナから GPU を使う設定ですが、Docker がインストールされません。「インストール後」で Docker を有効にしてください。',
        'The container toolkit is enabled but Docker is not installed. Enable Docker under "After install".',
      )
    }
    add(
      'info',
      'software.gpu',
      'CUDA は初回起動時にインターネットから数 GB をダウンロードします。完了後に自動で再起動します。',
      'CUDA downloads several GB from the internet on first boot, then reboots automatically.',
    )
  }

  if (profile.behavior.interactiveAll && !features.interactiveAll) {
    add(
      'warning',
      'behavior.interactiveAll',
      `Ubuntu ${profile.series} では interactive-sections: ["*"] の展開が確認できていないため、この指定は出力しません。個別の項目を「インストーラの画面で入力する」に設定してください。`,
      `The ["*"] form is unverified on Ubuntu ${profile.series}, so it is omitted. Set individual items to "type it in the installer" instead.`,
    )
  }

  if (profile.behavior.reporting.kind === 'rsyslog') {
    // autoinstall リファレンス: "The rsyslog reporter does not yet exist."
    add(
      'warning',
      'behavior.reporting',
      'rsyslog への送信は subiquity にまだ実装がありません（公式リファレンスに明記）。進捗は届かない可能性があります。',
      'The rsyslog reporter is documented as not yet implemented in subiquity, so progress may never arrive.',
    )
  }

  // --- 実行時に決める値 ---
  const rv = profile.runtimeValues
  if (usesKernelArgs(rv)) {
    if (!features.interactiveSections) {
      add(
        'warning',
        'runtimeValues',
        `Ubuntu ${profile.series} には interactive-sections がありません。値が渡されなかったときに手入力へ切り替えることができず、既定値が使われます。`,
        `Ubuntu ${profile.series} has no interactive-sections, so a missing value falls back to the default instead of prompting.`,
      )
    }
    if (rv.presets.length === 0) {
      add(
        'warning',
        'runtimeValues.presets',
        'カーネル引数で値を渡す設定ですが、ホストが 1 つも登録されていません。起動時に GRUB で e キーを押して自分で入力することになります。',
        'Values are passed as kernel arguments but no hosts are registered, so you will have to type them in GRUB with the e key.',
      )
    }
    const labels = new Set<string>()
    for (const [i, p] of rv.presets.entries()) {
      const where = `runtimeValues.presets[${i}]`
      if (!isSafePresetLabel(p.label)) {
        add(
          'error',
          `${where}.label`,
          `ホスト #${i + 1} の表示名に使えない文字があります（" $ 改行は使えません、40 文字まで）。`,
          `Host #${i + 1} has an invalid label (no " $ or newlines; 40 characters max).`,
        )
      } else if (labels.has(p.label)) {
        add('error', `${where}.label`, `ホスト名 "${p.label}" が重複しています。`, `Host label "${p.label}" is duplicated.`)
      }
      labels.add(p.label)

      // 手で編集された JSON ではキーが無いことがある。文字列以外は空として扱う。
      const f = (v: unknown): string => (typeof v === 'string' ? v : '')
      const fields: [string, string, string][] = []
      if (rv.hostname === 'kernel-arg') fields.push(['hostname', f(p.hostname), 'ホスト名'])
      if (rv.network === 'kernel-arg') {
        // ゲートウェイと DNS は空でもよい（外に出ない閉じたネットワークがある）。
        // IP アドレスだけは無いと netplan が成立しない。
        fields.push(['ipv4', f(p.ipv4), 'IP アドレス'])
        if (f(p.gateway)) fields.push(['gateway', f(p.gateway), 'ゲートウェイ'])
        if (f(p.nameservers)) fields.push(['nameservers', f(p.nameservers).replace(/\s+/g, ''), 'DNS'])
      }
      if (rv.disk === 'kernel-arg') fields.push(['disk', f(p.disk), 'ディスク'])

      // 書式まで見る。ここを通った値は起動メニューのカーネル引数になり、
      // インストーラが netplan / curtin にそのまま渡す。
      if (rv.hostname === 'kernel-arg' && f(p.hostname) && !HOSTNAME_RE.test(f(p.hostname))) {
        add(
          'error',
          `${where}.hostname`,
          `ホスト "${p.label}" のホスト名は英数字とハイフンで書いてください。`,
          `Host "${p.label}" needs a hostname of letters, digits and hyphens.`,
        )
      }
      if (rv.network === 'kernel-arg') {
        if (f(p.gateway) && !isValidIPv4(f(p.gateway))) {
          add(
            'error',
            `${where}.gateway`,
            `ホスト "${p.label}" のゲートウェイは "192.168.1.1" のように書いてください。`,
            `Host "${p.label}" needs a gateway like "192.168.1.1".`,
          )
        }
        for (const ns of f(p.nameservers).split(',').map((x) => x.trim()).filter(Boolean)) {
          if (!isValidIPv4(ns)) {
            add(
              'error',
              `${where}.nameservers`,
              `ホスト "${p.label}" の DNS "${ns}" は IP アドレスの形式ではありません。`,
              `Host "${p.label}" has a nameserver "${ns}" that is not an IP address.`,
            )
          }
        }
      }
      if (rv.disk === 'kernel-arg' && f(p.disk).startsWith('/dev/')) {
        // storage.layout.match.serial に入るので、デバイスパスを書いても一致しない
        add(
          'error',
          `${where}.disk`,
          `ホスト "${p.label}" のディスクにはシリアル番号を書いてください（"/dev/sda" のようなパスは一致しません）。`,
          `Host "${p.label}" needs a disk serial number; a path like "/dev/sda" will not match.`,
        )
      }

      for (const [key, value, label] of fields) {
        if (!value) {
          add(
            'error',
            `${where}.${key}`,
            `ホスト "${p.label}" の${label}が空です。`,
            `Host "${p.label}" has no ${key}.`,
          )
        } else if (!isSafeRuntimeValue(value)) {
          add(
            'error',
            `${where}.${key}`,
            `ホスト "${p.label}" の${label}に使えない文字が含まれています（英数字と . _ : / , - のみ）。`,
            `Host "${p.label}" has invalid characters in ${key} (only letters, digits and . _ : / , - are allowed).`,
          )
        }
      }
      if (rv.network === 'kernel-arg' && f(p.ipv4) && !isValidCidr(f(p.ipv4))) {
        add(
          'error',
          `${where}.ipv4`,
          `ホスト "${p.label}" の IP アドレスは "192.168.1.10/24" のように書いてください。`,
          `Host "${p.label}" needs an address like "192.168.1.10/24".`,
        )
      }
    }
    add(
      'info',
      'runtimeValues',
      '起動時に GRUB のメニューからホストを選ぶと、その値が使われます。一覧に無いホストは e キーで引数を編集してください。',
      'Pick a host from the GRUB menu at boot to apply its values. For a host not listed, press e and edit the arguments.',
    )
  }
  if (rv.disk === 'kernel-arg' && profile.storage.mode === 'raw') {
    add(
      'error',
      'runtimeValues.disk',
      'ディスクをカーネル引数で渡す設定は、curtin の生 YAML と併用できません。',
      'Passing the disk as a kernel argument cannot be combined with a raw curtin config.',
    )
  }
  if (rv.network === 'kernel-arg' && profile.network.mode === 'raw') {
    add(
      'error',
      'runtimeValues.network',
      'IP をカーネル引数で渡す設定は、netplan の生 YAML と併用できません。',
      'Passing the IP as a kernel argument cannot be combined with raw netplan YAML.',
    )
  }
  // 引数が渡されなかったときの既定値が空だと、netplan に空のアドレスが残って
  // インストールが失敗する。GRUB の既定エントリで起動されると必ずこの経路に入る。
  if (rv.network === 'kernel-arg' && profile.network.mode !== 'static' && profile.network.mode !== 'raw') {
    add(
      'error',
      'runtimeValues.network',
      'IP を起動メニューで決める場合は、ネットワークの設定を「固定 IP」にして既定値も入れてください。引数なしで起動されたときに使われます。',
      'When the IP is chosen from the boot menu, set the network to a static address as well; it is used when no argument is passed.',
    )
  }
  // 既定値（引数が渡されなかったときに使う値）も検証する。
  // ここを素通りさせると、起動メニュー経由で作った USB が「引数なしで起動したときだけ壊れる」
  // という追いにくい形になる。
  if (rv.network === 'kernel-arg' && profile.network.mode === 'static') {
    // 閉じたネットワーク（外に出ない検証環境など）ではゲートウェイも DNS も要らない。
    // 必須にすると表現できなくなるので、注意として出すに留める。
    if (!profile.network.gateway) {
      add(
        'warning',
        'network.gateway',
        'ゲートウェイが空です。引数なしで起動した機械は外部と通信できません（閉じたネットワークなら問題ありません）。',
        'No gateway is set, so a machine booted without arguments cannot reach outside. Fine on a closed network.',
      )
    }
    if (profile.network.nameservers.length === 0) {
      add(
        'warning',
        'network.nameservers',
        'DNS が空です。引数なしで起動した機械は名前解決ができません（閉じたネットワークなら問題ありません）。',
        'No nameservers are set, so a machine booted without arguments cannot resolve names. Fine on a closed network.',
      )
    }
  }
  if (
    rv.disk === 'kernel-arg' &&
    profile.storage.mode !== 'raw' &&
    profile.storage.match.kind !== 'serial'
  ) {
    add(
      'error',
      'runtimeValues.disk',
      'ディスクを起動メニューで決める場合は、ディスクの指定方法を「シリアル番号」にして既定値も入れてください。引数なしで起動されたときに使われます。',
      'When the disk is chosen from the boot menu, also match by serial number so there is a default for boots without an argument.',
    )
  }
  if (profile.behavior.interactiveAll && usesKernelArgs(rv)) {
    add(
      'warning',
      'behavior.interactiveAll',
      'すべての画面を出す設定なので、カーネル引数で渡した値は「既定値」として表示されるだけになります。',
      'Because every screen is shown, kernel-argument values only appear as defaults.',
    )
  }

  // --- カーネル / APT / その他の追加キー ---
  if (profile.software.kernel.mode === 'flavor' && !profile.software.kernel.flavor.trim()) {
    add('error', 'software.kernel', 'カーネルの flavor を入力してください。', 'Enter a kernel flavor.')
  }
  if (profile.software.kernel.mode === 'package' && !profile.software.kernel.package.trim()) {
    add('error', 'software.kernel', 'カーネルのパッケージ名を入力してください。', 'Enter a kernel package name.')
  }
  if (profile.software.kernel.mode !== 'default' && profile.software.oem === 'yes') {
    add(
      'warning',
      'software.oem',
      'OEM メタパッケージはカーネルを入れ替えることがあり、カーネル指定と競合してインストールが失敗する場合があります。',
      'OEM meta-packages can pull in their own kernel and conflict with an explicit kernel choice.',
    )
  }
  for (const [i, src] of profile.apt.sources.entries()) {
    const where = `apt.sources[${i}]`
    const value = src.source.trim()
    if (!value) {
      add('error', `${where}.source`, `追加リポジトリ #${i + 1} が空です。`, `APT source #${i + 1} is empty.`)
    } else if (!isPpaSource(value) && !isDebLineSource(value)) {
      add(
        'error',
        `${where}.source`,
        `追加リポジトリ #${i + 1} は "ppa:user/name" か "deb https://... " の形式で書いてください。`,
        `APT source #${i + 1} must be "ppa:user/name" or a "deb https://..." line.`,
      )
    }
    if (isDebLineSource(value) && !src.key.trim() && !/signed-by=/.test(value)) {
      add(
        'warning',
        `${where}.key`,
        `追加リポジトリ #${i + 1} に GPG 公開鍵が設定されていません。署名検証ができず apt が失敗する可能性があります。`,
        `APT source #${i + 1} has no GPG key, so apt may refuse it.`,
      )
    }
  }
  if (profile.apt.preserveSourcesList && profile.apt.mode !== 'default') {
    add(
      'warning',
      'apt.preserveSourcesList',
      'sources.list を書き換えない設定なので、指定したミラーは反映されません。',
      'The mirror will not be applied because sources.list is preserved.',
    )
  }
  if (profile.storage.mode !== 'raw') {
    if (profile.storage.swap.mode === 'size' && !isValidSizeSpec(profile.storage.swap.size)) {
      add(
        'error',
        'storage.swap',
        'swap のサイズは 4G のように書いてください。',
        'Swap size must be written like 4G.',
      )
    }
    if (
      profile.storage.resetPartition.enabled &&
      profile.storage.resetPartition.size.trim() &&
      !isValidSizeSpec(profile.storage.resetPartition.size)
    ) {
      add(
        'error',
        'storage.resetPartition',
        'リセットパーティションのサイズは 12G のように書いてください。',
        'Reset partition size must be written like 12G.',
      )
    }
  }
  if (profile.user.groups.mode !== 'default') {
    if (!features.identityGroups) {
      add(
        'warning',
        'user.groups',
        `identity.groups は Ubuntu 26.04 で追加された項目です。${profile.series} では無視されます。`,
        `identity.groups was added in Ubuntu 26.04 and is ignored on ${profile.series}.`,
      )
    } else if (profile.user.groups.mode === 'override' && !profile.user.groups.groups.includes('sudo')) {
      add(
        'warning',
        'user.groups',
        'グループを上書きする設定で sudo が含まれていません。管理者ユーザーが sudo を使えなくなります。',
        'The group override does not include sudo, so the admin user will lose sudo access.',
      )
    }
  }
  if (profile.activeDirectory.enabled) {
    if (!features.codecsOemAd) {
      add(
        'warning',
        'activeDirectory',
        `active-directory は Ubuntu ${profile.series} では使えません。無視されます。`,
        `active-directory is not available on Ubuntu ${profile.series} and will be ignored.`,
      )
    } else {
      if (!profile.activeDirectory.domainName.trim()) {
        add('error', 'activeDirectory.domainName', 'ドメイン名を入力してください。', 'Enter a domain name.')
      }
      if (!profile.activeDirectory.adminName.trim()) {
        // 空のまま出すとインストーラが画面で聞くだけになり、参加は成立しない
        add(
          'error',
          'activeDirectory.adminName',
          'ドメイン参加に使う管理者名を入力してください。',
          'Enter the administrator account used to join the domain.',
        )
      }
      add(
        'warning',
        'activeDirectory',
        'AD 参加のパスワードは設定ファイルに書けず、インストール中に入力を求められます。完全無人にはなりません。',
        'The AD password cannot be put in the config; the installer asks for it, so the install is not fully unattended.',
      )
    }
  }
  if (profile.behavior.reporting.kind === 'webhook' && !/^https?:\/\//.test(profile.behavior.reporting.endpoint)) {
    add('error', 'behavior.reporting', 'Webhook の URL が正しくありません。', 'The webhook URL is invalid.')
  }
  if (profile.behavior.reporting.kind === 'rsyslog' && !profile.behavior.reporting.destination.trim()) {
    add(
      'error',
      'behavior.reporting',
      'rsyslog の送信先を入力してください（例: @192.168.0.1）。',
      'Enter an rsyslog destination, e.g. @192.168.0.1.',
    )
  }
  if (
    profile.behavior.reporting.kind !== 'console' &&
    (interactive.length > 0 || profile.behavior.interactiveAll)
  ) {
    add(
      'info',
      'behavior.reporting',
      '対話セクションがある場合、インストーラは reporting の設定を無視します。',
      'When any section is interactive, the installer ignores the reporting configuration.',
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
  // grub.cfg の中で意味を持つ文字は全部弾く。; & | だけでは足りない
  // （" はクォートを閉じ、# は行コメント、$ と { } は変数展開になる）。
  if (/["#$'{}\\<>`\r\n]/.test(profile.advanced.extraKernelArgs)) {
    add(
      'error',
      'advanced.extraKernelArgs',
      'カーネル引数に grub.cfg で特別な意味を持つ文字 (" # $ \' { } \\ < > `) は使えません。',
      'Kernel arguments cannot contain characters that are special in grub.cfg (" # $ \' { } \\ < > `).',
    )
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
  if (interactive.length > 0 || profile.behavior.interactiveAll) {
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
