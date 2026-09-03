import { Document, Scalar, parseDocument, isMap, type Node } from 'yaml'
import type {
  AutoinstallProfile,
  InterfaceSelector,
  NetworkConfig,
  StorageConfig,
} from './model.js'
import { SERIES_FEATURES } from './model.js'
import { getPreset, shellQuote } from './presets.js'

// プロファイル → autoinstall YAML の決定的な変換。
// GUI で作った設定と、実際にインストーラへ渡る YAML が 1 対 1 で対応することが商用ツールの信頼性の要。
// 生成物には日本語/英語の説明コメントを付ける（初心者が YAML を読んで意味を理解できるようにするため）。

export type CommentLocale = 'ja' | 'en'

export interface GenerateOptions {
  /** コメントの言語。`none` はコメントなし。 */
  readonly comments: CommentLocale | 'none'
  /**
   * CIDATA に置くファイルを /target にコピーする late-commands を生成するときの、
   * cloud-init が seed をマウントするパス。既定は `/cdrom` ではなく NoCloud の seed ディレクトリ。
   */
  readonly seedMountPath?: string
}

const DEFAULT_OPTIONS: GenerateOptions = { comments: 'ja' }

interface Comment {
  readonly ja: string
  readonly en: string
}

const C = {
  version: {
    ja: 'autoinstall 設定の形式バージョン。現在は 1 のみ。',
    en: 'Format version of this autoinstall config. Only 1 exists today.',
  },
  interactive: {
    ja: 'ここに書いたセクションはインストーラが画面で質問します（空なら完全自動）。',
    en: 'Sections listed here are asked interactively. Empty means fully unattended.',
  },
  locale: {
    ja: 'インストール後のシステムロケール。',
    en: 'System locale of the installed system.',
  },
  keyboard: {
    ja: 'キーボード配列。layout は必須、variant は配列の派生（無ければ空）。',
    en: 'Keyboard layout. layout is required; variant is the sub-layout (empty if none).',
  },
  timezone: {
    ja: 'タイムゾーン。geoip にすると IP アドレスから自動判定します。',
    en: 'Time zone. Use geoip to detect it from the IP address.',
  },
  refreshInstaller: {
    ja: 'インストーラ本体を snap store から最新版に更新するか。ネットワークが必要です。',
    en: 'Whether to update the installer itself from the snap store. Requires network.',
  },
  source: {
    ja: 'インストールする範囲。ubuntu-server=標準、ubuntu-server-minimal=最小構成。',
    en: 'What to install. ubuntu-server = standard, ubuntu-server-minimal = minimal.',
  },
  network: {
    ja: 'ネットワーク設定（netplan v2 形式）。インストール中と再起動後の両方に使われます。',
    en: 'Network config in netplan v2 format, used during install and after reboot.',
  },
  proxy: {
    ja: 'APT が使う HTTP プロキシ。',
    en: 'HTTP proxy used by APT.',
  },
  apt: {
    ja: 'パッケージの取得元。ミラーが遅い/届かないとインストールが長時間止まります。',
    en: 'Package mirror settings. A slow or unreachable mirror stalls the install.',
  },
  storage: {
    ja: 'ディスクの使い方。ここで指定したディスクの中身は完全に消去されます。',
    en: 'Disk layout. Everything on the selected disk is erased.',
  },
  identity: {
    ja: '最初に作る管理ユーザー。password は crypt(3) ハッシュ（平文は使えません）。',
    en: 'The first admin user. password must be a crypt(3) hash, never plain text.',
  },
  ssh: {
    ja: 'SSH の設定。install-server を true にすると openssh-server が入ります。',
    en: 'SSH settings. install-server: true installs openssh-server.',
  },
  packages: {
    ja: '追加でインストールする deb パッケージ。ネットワークが必要です。',
    en: 'Extra deb packages to install. Requires network.',
  },
  snaps: {
    ja: '追加でインストールする snap。ネットワークが必要です。',
    en: 'Extra snaps to install. Requires network.',
  },
  updates: {
    ja: 'インストール時に適用する更新。security=セキュリティのみ、all=全部。',
    en: 'Updates applied during install. security = security only, all = everything.',
  },
  drivers: {
    ja: 'サードパーティのドライバ（NVIDIA 等）を自動で入れるか。',
    en: 'Whether to install third-party drivers (e.g. NVIDIA) automatically.',
  },
  kernelCrashDumps: {
    ja: 'カーネルクラッシュダンプ (kdump) を有効にするか。',
    en: 'Whether to enable kernel crash dumps (kdump).',
  },
  ubuntuPro: {
    ja: 'Ubuntu Pro のトークン。付けると ESM などが有効になります。',
    en: 'Ubuntu Pro token. Enables ESM and related services.',
  },
  lateCommands: {
    ja: 'インストール完了後・再起動前に実行するコマンド。curtin in-target で新システム内で動きます。',
    en: 'Commands run after install, before reboot. curtin in-target runs them inside the new system.',
  },
  errorCommands: {
    ja: 'インストールが失敗したときに実行するコマンド（ログ収集などに使います）。',
    en: 'Commands run when the install fails, e.g. to collect logs.',
  },
  userData: {
    ja: 'インストール後の初回起動時に cloud-init が実行する設定。',
    en: 'cloud-init config applied on the first boot of the installed system.',
  },
  shutdown: {
    ja: 'インストール後の動作。reboot=再起動、poweroff=電源を切る。',
    en: 'What to do when done. reboot restarts, poweroff powers off.',
  },
  reporting: {
    ja: 'インストール進捗の出力先。',
    en: 'Where install progress is reported.',
  },
} satisfies Record<string, Comment>

function commentText(c: Comment, locale: CommentLocale | 'none'): string | undefined {
  if (locale === 'none') return undefined
  return ` ${locale === 'ja' ? c.ja : c.en}`
}

// ---------------------------------------------------------------------------
// 各セクションの構築
// ---------------------------------------------------------------------------

/** 必ず二重引用符で出力される文字列ノードを作る。 */
function quoted(value: string): Scalar<string> {
  const node = new Scalar(value)
  node.type = Scalar.QUOTE_DOUBLE
  return node
}

function interfaceKeyAndMatch(sel: InterfaceSelector): {
  key: string
  match: Record<string, string> | undefined
} {
  switch (sel.kind) {
    case 'name':
      // netplan では NIC 名をそのままキーにするのが最も確実（match 不要）
      return { key: sel.name, match: undefined }
    case 'mac':
      return { key: 'nic-by-mac', match: { macaddress: sel.macaddress } }
    case 'any':
    default:
      // en* は systemd の予測可能なインターフェース名（enp0s3, eno1, ens18 …）に一致する
      return { key: 'any-ethernet', match: { name: 'en*' } }
  }
}

function buildNetwork(net: NetworkConfig): unknown | undefined {
  // インストーラの既定に任せる場合はキー自体を出力しない。
  // 既定は「eth*/en* に一致する全 NIC で DHCPv4、アドレスを取れなかった NIC は無効化」。
  if (net.mode === 'installer-default') return undefined
  if (net.mode === 'raw') {
    const doc = parseDocument(net.yaml)
    return doc.toJS() ?? {}
  }
  const { key, match } = interfaceKeyAndMatch(net.target)
  const iface: Record<string, unknown> = {}
  if (match) iface['match'] = match
  if (net.mode === 'dhcp') {
    iface['dhcp4'] = true
  } else {
    iface['dhcp4'] = false
    iface['addresses'] = [net.address]
    if (net.gateway) {
      // routes 形式が netplan の推奨。gateway4 は非推奨で警告が出る。
      iface['routes'] = [{ to: 'default', via: net.gateway }]
    }
    const ns: Record<string, unknown> = {}
    if (net.nameservers.length > 0) ns['addresses'] = [...net.nameservers]
    if (net.searchDomains.length > 0) ns['search'] = [...net.searchDomains]
    if (Object.keys(ns).length > 0) iface['nameservers'] = ns
  }
  // optional: true は「このNICが未接続でも起動を待たない」。未接続NICでの2分待ちを防ぐ。
  if (net.optional) iface['optional'] = true
  return { version: 2, ethernets: { [key]: iface } }
}

function buildStorage(storage: StorageConfig): unknown {
  if (storage.mode === 'raw') {
    const doc = parseDocument(storage.yaml)
    return doc.toJS() ?? {}
  }
  const layout: Record<string, unknown> = { name: storage.mode }
  switch (storage.match.kind) {
    case 'largest':
      layout['match'] = { size: 'largest' }
      break
    case 'smallest':
      layout['match'] = { size: 'smallest' }
      break
    case 'ssd':
      layout['match'] = { ssd: true }
      break
    case 'path':
      layout['match'] = { path: storage.match.path }
      break
    case 'serial':
      layout['match'] = { serial: storage.match.serial }
      break
    case 'model':
      layout['match'] = { model: storage.match.model }
      break
    case 'any':
      // 空の match は「任意の 1 台」を意味する（autoinstall リファレンスに明記）
      layout['match'] = {}
      break
  }
  if (storage.partitionTable !== 'default') layout['ptable'] = storage.partitionTable
  // sizing-policy と password は lvm レイアウト専用
  if (storage.mode === 'lvm') {
    if (storage.useWholeDisk) layout['sizing-policy'] = 'all'
    if (storage.encryptionPassphrase) layout['password'] = storage.encryptionPassphrase
  }
  const out: Record<string, unknown> = { layout }
  if (storage.disableSwap) out['swap'] = { size: 0 }
  return out
}

function buildApt(profile: AutoinstallProfile): Record<string, unknown> | undefined {
  const apt: Record<string, unknown> = {}
  if (profile.apt.mode === 'country-mirror') {
    apt['mirror-selection'] = { primary: ['country-mirror'] }
  } else if (profile.apt.mode === 'custom' && profile.apt.primaryUri) {
    apt['mirror-selection'] = { primary: [{ uri: profile.apt.primaryUri }] }
  }
  if (profile.apt.disableComponents.length > 0) {
    apt['disable_components'] = [...profile.apt.disableComponents]
  }
  return Object.keys(apt).length > 0 ? apt : undefined
}

/** CIDATA 上のファイルを新システムへコピーする late-command を作る。 */
function fileCopyCommands(profile: AutoinstallProfile, seedPath: string): string[] {
  const cmds: string[] = []
  for (const f of profile.postInstall.files) {
    const src = `${seedPath}/${f.name}`
    const dest = `/target${f.targetPath}`
    cmds.push(`mkdir -p ${shellQuote(dirnamePosix(dest))}`)
    cmds.push(`cp ${shellQuote(src)} ${shellQuote(dest)}`)
    cmds.push(`chmod ${f.mode} ${shellQuote(dest)}`)
    if (f.owner && f.owner !== 'root') {
      // chown は新システム側の /etc/passwd を見る必要があるので in-target で実行する
      cmds.push(`curtin in-target -- chown ${f.owner} ${shellQuote(f.targetPath)}`)
    }
  }
  return cmds
}

function dirnamePosix(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

export function collectLateCommands(profile: AutoinstallProfile, seedPath: string): string[] {
  const ctx = { username: profile.user.username, hostname: profile.basics.hostname }
  const cmds: string[] = []
  for (const id of profile.postInstall.presets) cmds.push(...getPreset(id).lateCommands(ctx))
  cmds.push(...fileCopyCommands(profile, seedPath))
  cmds.push(...profile.postInstall.lateCommands)
  return cmds
}

/** プリセットが要求する追加パッケージを含めた、重複なしのパッケージ一覧。 */
export function collectPackages(profile: AutoinstallProfile): string[] {
  const set = new Set<string>(profile.software.packages)
  for (const id of profile.postInstall.presets) {
    for (const pkg of getPreset(id).packages ?? []) set.add(pkg)
  }
  return [...set].sort()
}

// ---------------------------------------------------------------------------
// autoinstall 本体の生成
// ---------------------------------------------------------------------------

/** autoinstall セクションの中身をプレーンなオブジェクトとして作る（マージ・検証用）。 */
export function buildAutoinstallObject(
  profile: AutoinstallProfile,
  options: GenerateOptions = DEFAULT_OPTIONS,
): Record<string, unknown> {
  const features = SERIES_FEATURES[profile.series]
  const seedPath = options.seedMountPath ?? '/cdrom'
  const out: Record<string, unknown> = { version: 1 }

  if (features.interactiveSections && profile.behavior.interactiveSections.length > 0) {
    out['interactive-sections'] = [...profile.behavior.interactiveSections]
  }
  out['locale'] = profile.basics.locale
  const keyboard: Record<string, unknown> = { layout: profile.basics.keyboard.layout }
  if (profile.basics.keyboard.variant) keyboard['variant'] = profile.basics.keyboard.variant
  if (profile.basics.keyboard.toggle) keyboard['toggle'] = profile.basics.keyboard.toggle
  out['keyboard'] = keyboard
  out['timezone'] = profile.basics.timezone
  out['refresh-installer'] = { update: profile.behavior.refreshInstaller }
  if (features.source) out['source'] = { id: profile.software.sourceId }
  const network = buildNetwork(profile.network)
  if (network !== undefined) out['network'] = network
  if (profile.apt.proxy) out['proxy'] = profile.apt.proxy
  const apt = buildApt(profile)
  if (apt) out['apt'] = apt
  out['storage'] = buildStorage(profile.storage)
  out['identity'] = {
    hostname: profile.basics.hostname,
    realname: profile.user.realname,
    username: profile.user.username,
    // autoinstall リファレンスが「特殊文字を正しく扱うためハッシュはクォートせよ」と
    // 明記しているので、YAML 的に不要でも必ず二重引用符で囲む。
    password: quoted(profile.user.passwordHash),
  }
  out['ssh'] = {
    'install-server': profile.ssh.installServer,
    'allow-pw': profile.ssh.allowPasswordAuth,
    ...(profile.ssh.authorizedKeys.length > 0
      ? { 'authorized-keys': [...profile.ssh.authorizedKeys] }
      : {}),
  }
  const packages = collectPackages(profile)
  if (packages.length > 0) out['packages'] = packages
  if (profile.software.snaps.length > 0) {
    out['snaps'] = profile.software.snaps.map((s) => ({
      name: s.name,
      ...(s.channel ? { channel: s.channel } : {}),
      ...(s.classic ? { classic: true } : {}),
    }))
  }
  out['updates'] = profile.software.updates
  if (profile.software.installDrivers) out['drivers'] = { install: true }
  if (features.kernelCrashDumps && profile.software.kernelCrashDumps !== null) {
    out['kernel-crash-dumps'] = { enabled: profile.software.kernelCrashDumps }
  }
  if (profile.software.ubuntuProToken) {
    const key = features.ubuntuPro ? 'ubuntu-pro' : 'ubuntu-advantage'
    out[key] = { token: profile.software.ubuntuProToken }
  }
  const late = collectLateCommands(profile, seedPath)
  if (late.length > 0) out['late-commands'] = late
  const userData = buildUserData(profile)
  if (userData) out['user-data'] = userData
  if (profile.behavior.reportToConsole) {
    out['reporting'] = { builtin: { type: 'print' } }
  }
  out['shutdown'] = profile.behavior.shutdown

  const overlay = parseOverlay(profile.advanced.rawOverlayYaml)
  return overlay ? deepMerge(out, overlay) : out
}

function buildUserData(profile: AutoinstallProfile): Record<string, unknown> | undefined {
  const ud: Record<string, unknown> = {}
  if (profile.postInstall.firstBootCommands.length > 0) {
    ud['runcmd'] = [...profile.postInstall.firstBootCommands]
  }
  return Object.keys(ud).length > 0 ? ud : undefined
}

function parseOverlay(yaml: string): Record<string, unknown> | undefined {
  const trimmed = yaml.trim()
  if (!trimmed) return undefined
  const doc = parseDocument(trimmed)
  if (doc.errors.length > 0) {
    throw new Error(`上書き YAML の構文エラー: ${doc.errors[0]!.message}`)
  }
  const js: unknown = doc.toJS()
  if (js === null || typeof js !== 'object' || Array.isArray(js)) {
    throw new Error('上書き YAML はキーと値のマッピングである必要があります')
  }
  return js as Record<string, unknown>
}

/** 上書き YAML を深いマージで適用する。配列は「置き換え」（追記ではない）。 */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(overlay)) {
    const cur = out[k]
    if (
      cur !== null &&
      typeof cur === 'object' &&
      !Array.isArray(cur) &&
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

const SECTION_COMMENTS: Record<string, Comment> = {
  version: C.version,
  'interactive-sections': C.interactive,
  locale: C.locale,
  keyboard: C.keyboard,
  timezone: C.timezone,
  'refresh-installer': C.refreshInstaller,
  source: C.source,
  network: C.network,
  proxy: C.proxy,
  apt: C.apt,
  storage: C.storage,
  identity: C.identity,
  ssh: C.ssh,
  packages: C.packages,
  snaps: C.snaps,
  updates: C.updates,
  drivers: C.drivers,
  'kernel-crash-dumps': C.kernelCrashDumps,
  'ubuntu-pro': C.ubuntuPro,
  'ubuntu-advantage': C.ubuntuPro,
  'late-commands': C.lateCommands,
  'error-commands': C.errorCommands,
  'user-data': C.userData,
  reporting: C.reporting,
  shutdown: C.shutdown,
}

function attachComments(doc: Document, locale: CommentLocale | 'none'): void {
  if (locale === 'none') return
  const root = doc.get('autoinstall', true) as Node | undefined
  const target = root && isMap(root) ? root : doc.contents
  if (!target || !isMap(target)) return
  for (const item of target.items) {
    const keyNode = item.key as { value?: unknown; commentBefore?: string | null } | null
    const key = String(keyNode?.value ?? '')
    const c = SECTION_COMMENTS[key]
    if (!c || !keyNode || typeof keyNode !== 'object') continue
    // コメントは「キーの前」に置く。値ノードに付けると
    //   version:
    //     # コメント
    //     1
    // のようにキーと値の間に挟まり、読みにくくなる。
    keyNode.commentBefore = commentText(c, locale) ?? null
  }
}

const YAML_STRINGIFY_OPTIONS = {
  lineWidth: 0,
  indent: 2,
  singleQuote: false,
  // crypt ハッシュ ($6$...) や late-commands は必ずクォートされるべきなので、
  // yaml のデフォルト（必要なときだけクォート）に任せつつ行折り返しは無効化する。
} as const

/**
 * cloud-init の NoCloud に置く `user-data` の内容を作る。
 * 先頭の `#cloud-config` は cloud-init が必須とするマジックヘッダ（無いと設定が無視される）。
 */
export function generateUserData(
  profile: AutoinstallProfile,
  options: GenerateOptions = DEFAULT_OPTIONS,
): string {
  const autoinstall = buildAutoinstallObject(profile, options)
  const doc = new Document({ autoinstall })
  attachComments(doc, options.comments)
  const header =
    options.comments === 'none'
      ? '#cloud-config\n'
      : options.comments === 'ja'
        ? [
            '#cloud-config',
            '# Ubuntu Server 自動インストール設定 (autoinstall)',
            `# 生成: ${profile.meta.toolVersion} / プロファイル: ${profile.meta.name}`,
            `# 対象: Ubuntu Server ${profile.series}`,
            '#',
            '# 先頭の #cloud-config 行は cloud-init が必須とする目印です。消さないでください。',
            '',
          ].join('\n')
        : [
            '#cloud-config',
            '# Ubuntu Server unattended installation config (autoinstall)',
            `# Generated by ${profile.meta.toolVersion} / profile: ${profile.meta.name}`,
            `# Target: Ubuntu Server ${profile.series}`,
            '#',
            '# The leading #cloud-config line is required by cloud-init. Do not remove it.',
            '',
          ].join('\n')
  return header + doc.toString(YAML_STRINGIFY_OPTIONS)
}

/**
 * `autoinstall.yaml`（cloud-config でラップしない単体形式）を作る。
 * subiquity にメディア直下の autoinstall.yaml として読ませる用途と、人間が読む用の控え。
 */
export function generateAutoinstallYaml(
  profile: AutoinstallProfile,
  options: GenerateOptions = DEFAULT_OPTIONS,
): string {
  const autoinstall = buildAutoinstallObject(profile, options)
  const doc = new Document(autoinstall)
  attachComments(doc, options.comments)
  return doc.toString(YAML_STRINGIFY_OPTIONS)
}

/**
 * NoCloud の `meta-data`。instance-id が変わると cloud-init は「新しいインスタンス」として
 * 初回起動処理をやり直す。ファイル自体が存在しないと NoCloud データソースが seed を無効と判断する。
 */
export function generateMetaData(instanceId: string): string {
  return `instance-id: ${instanceId}\n`
}
