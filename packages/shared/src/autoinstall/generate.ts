import { Scalar, isMap, type Document, type Node } from 'yaml'
import { createAutoinstallDocument, parseAutoinstallYaml } from './yaml.js'
import { createTranslator, localized, type Locale, type LocalizedText, type MsgKey } from '../i18n/index.js'
import type {
  AutoinstallProfile,
  InterfaceSelector,
  NetworkConfig,
  SeriesFeatures,
  StorageConfig,
} from './model.js'
import { SERIES_FEATURES } from './model.js'
import { findPreset, shellQuote } from './presets.js'
import {
  ERROR_LOG_COMMANDS,
  buildReporting,
  errorLogToSeedCommands,
} from './advanced.js'
import { buildRaidPlan, diskMatchSpec, raidEspMirrorCommand } from './generate-raid.js'
import {
  SEED_MOUNT_PATH,
  buildProvisioningCommands,
  seedMountCommands,
  seedUmountCommands,
} from './generate-provisioning.js'
import {
  baseKernelArgs,
  buildHostMenuEntries,
  buildSubstitutionScript,
  interactiveSectionsFor,
  usesKernelArgs,
  type GrubMenuEntry,
  type RuntimeValuesConfig,
} from './runtime-values.js'
import { buildBondNetplan } from './generate-bond.js'

// プロファイル → autoinstall YAML の決定的な変換。
// GUI で作った設定と、実際にインストーラへ渡る YAML が 1 対 1 で対応することが商用ツールの信頼性の要。
// 生成物には日本語/英語の説明コメントを付ける（初心者が YAML を読んで意味を理解できるようにするため）。

/** コメントの言語は画面の言語と同じ集合（辞書から引く）。 */
export type CommentLocale = Locale

/**
 * 生成が止まった理由を **訳せる形で** 運ぶ例外。`SeedBuildError` と同じ形。
 *
 * `message`（日本語）は開発者向けの診断としてそのまま残す（ログとテストが読む）。
 * 画面に出すのは `text` の方で、受け取る側は **キーから引いた文** を使う。
 * `message` を英文に連結すると、English を選んでいる利用者に
 * 「Failed to generate YAML: 上書き YAML の構文エラー: …」という
 * 半分日本語の行が出る（実際にそうなっていた）。
 *
 * `field` は GUI がどのステップへ飛べばよいかを示す（`ValidationIssue.field` と同じ語彙）。
 */
export class GenerateError extends Error {
  readonly text: LocalizedText
  readonly field: string

  constructor(message: string, text: LocalizedText, field: string) {
    super(message)
    this.name = 'GenerateError'
    this.text = text
    this.field = field
  }
}

export interface GenerateOptions {
  /** コメントの言語。`none` はコメントなし。 */
  readonly comments: CommentLocale | 'none'
}

const DEFAULT_OPTIONS: GenerateOptions = { comments: 'ja' }

/**
 * 各セクションの説明コメント。**訳文は辞書（`yaml.comment.*`）に置く。**
 * 以前は `{ja, en}` の対をここに持っていたため、言語を足すたびに別の仕組みを
 * 直す必要があった（i18n の機構が 2 つ）。
 */
const C = {
  version: 'yaml.comment.version',
  interactive: 'yaml.comment.interactive',
  locale: 'yaml.comment.locale',
  keyboard: 'yaml.comment.keyboard',
  timezone: 'yaml.comment.timezone',
  refreshInstaller: 'yaml.comment.refreshInstaller',
  source: 'yaml.comment.source',
  network: 'yaml.comment.network',
  proxy: 'yaml.comment.proxy',
  apt: 'yaml.comment.apt',
  storage: 'yaml.comment.storage',
  identity: 'yaml.comment.identity',
  ssh: 'yaml.comment.ssh',
  packages: 'yaml.comment.packages',
  snaps: 'yaml.comment.snaps',
  updates: 'yaml.comment.updates',
  drivers: 'yaml.comment.drivers',
  kernelCrashDumps: 'yaml.comment.kernelCrashDumps',
  ubuntuPro: 'yaml.comment.ubuntuPro',
  lateCommands: 'yaml.comment.lateCommands',
  errorCommands: 'yaml.comment.errorCommands',
  userData: 'yaml.comment.userData',
  shutdown: 'yaml.comment.shutdown',
  reporting: 'yaml.comment.reporting',
  kernel: 'yaml.comment.kernel',
  debconf: 'yaml.comment.debconf',
  activeDirectory: 'yaml.comment.activeDirectory',
  codecs: 'yaml.comment.codecs',
  oem: 'yaml.comment.oem',
  earlyCommands: 'yaml.comment.earlyCommands',
} as const satisfies Record<string, MsgKey>

function commentText(key: MsgKey, locale: CommentLocale | 'none'): string | undefined {
  if (locale === 'none') return undefined
  return ` ${createTranslator(locale)(key)}`
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

function buildNetwork(net: NetworkConfig, runtime: RuntimeValuesConfig): unknown | undefined {
  // カーネル引数で IP を渡す場合も、YAML には固定 IP をそのまま書く。
  // early-commands が YAML を読み書きして値を差し替えるので、ここに入るのは
  // 「引数が渡されなかったときに使う既定値」。プレースホルダは使わない
  // （PyYAML が引用符を付け直すため、テキスト置換では正しく差し替えられない）。
  const byKernelArg = runtime.network === 'kernel-arg'

  // インストーラの既定に任せる場合はキー自体を出力しない。
  // 既定は「eth*/en* に一致する全 NIC で DHCPv4、アドレスを取れなかった NIC は無効化」。
  if (net.mode === 'installer-default' && !byKernelArg) return undefined
  if (net.mode === 'raw') {
    return rawYamlToJs(net.yaml, 'network.yaml', 'validate.networkYamlSyntax')
  }
  // bond は `ethernets` に加えて `bonds` を出すので、単一 NIC の組み立てには乗らない。
  // ここより下（既存の 3 モード）の出力は 1 バイトも変わらない。
  //
  // `byKernelArg` との併用は検証がエラーにしている
  // (`validate.networkKernelArgNeedsStatic`)。early-commands は
  // `network.ethernets` しか書き換えないので、bond に IP を差し替えることはできない。
  if (net.mode === 'bond') return buildBondNetplan(net)
  const target = net.mode === 'installer-default' ? { kind: 'any' as const } : net.target
  const { key, match } = interfaceKeyAndMatch(target)
  const iface: Record<string, unknown> = {}
  if (match) iface['match'] = match


  if (net.mode === 'dhcp') {
    iface['dhcp4'] = true
  } else if (net.mode === 'static') {
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
  if (net.mode !== 'installer-default' && net.optional) iface['optional'] = true
  return { version: 2, ethernets: { [key]: iface } }
}

/**
 * 生の YAML を JS の値にする。**素の例外を外へ出さない。**
 *
 * `toJS()` は構文が正しい YAML でも投げる: エイリアスを入れ子で増やした YAML は
 * `ReferenceError: Excessive alias count`（`yaml` パッケージの資源枯渇対策）になる。
 * そのまま外へ出すと画面には「予期しないエラーが発生しました」しか出ず、
 * **どの入力欄を直せばよいか分からない**（落とし穴 23 / 77）。
 * `GenerateError` に包んで、`field` で入力欄へ飛べるようにする。
 */
function rawYamlToJs(yaml: string, field: string, key: MsgKey): unknown {
  const doc = parseAutoinstallYaml(yaml)
  try {
    return doc.toJS() ?? {}
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new GenerateError(`cannot read the raw YAML (${field}): ${detail}`, localized(key, { detail }), field)
  }
}

function buildStorage(
  storage: StorageConfig,
  runtime: RuntimeValuesConfig,
  features: SeriesFeatures,
): unknown {
  if (storage.mode === 'raw') {
    return rawYamlToJs(storage.yaml, 'storage.yaml', 'validate.storageYamlSyntax')
  }
  if (storage.mode === 'raid') {
    // **`layout` と `config` は排他**（autoinstall リファレンス:
    // "If the layout feature is used to configure the disks, the config section is not used."）。
    // RAID は `config`（curtin のアクション列）でしか表現できないので layout は出さない。
    const out: Record<string, unknown> = {
      version: 1,
      config: buildRaidPlan(storage.raid).config,
    }
    // `swap` は `config` と併用できる（リファレンスの例がそう書いている）。
    applySwap(out, storage)
    return out
  }
  const layout: Record<string, unknown> = { name: storage.mode, match: diskMatchSpec(storage.match) }
  if (storage.partitionTable !== 'default') layout['ptable'] = storage.partitionTable
  // sizing-policy と password は lvm レイアウト専用
  if (storage.mode === 'lvm') {
    if (storage.useWholeDisk) layout['sizing-policy'] = 'all'
    if (storage.encryptionPassphrase) layout['password'] = storage.encryptionPassphrase
  }
  applyResetPartition(layout, storage, features)
  const out: Record<string, unknown> = { layout }
  applySwap(out, storage)
  return out
}

// `Extract<StorageConfig, {mode:'lvm'|'direct'|'zfs'}>` は **never** になる
// （構造化側のメンバーの `mode` は `'lvm'|'direct'|'zfs'|'raid'` なので、
//   `{mode:'lvm'|'direct'|'zfs'}` には代入できない）。`raw` を除く形で書く。
type StructuredStorage = Exclude<StorageConfig, { mode: 'raw' }>

/** `swap` は storage の直下（layout の中ではない）。 */
function applySwap(out: Record<string, unknown>, storage: StructuredStorage): void {
  if (storage.swap.mode === 'none') out['swap'] = { size: 0 }
  else if (storage.swap.mode === 'size' && storage.swap.size.trim()) {
    out['swap'] = { size: storage.swap.size.trim() }
  }
}

/** `reset-partition` は layout の中。true か、`12G` のようなサイズを取る。 */
function applyResetPartition(
  layout: Record<string, unknown>,
  storage: StructuredStorage,
  features: SeriesFeatures,
): void {
  // 22.04 の subiquity は reset-partition を知らない。storage はスキーマ上は
  // 素通りするので検証では気づけず、黙って無視される。出さないほうが誠実。
  if (!features.resetPartition || !storage.resetPartition.enabled) return
  const size = storage.resetPartition.size.trim()
  layout['reset-partition'] = size === '' ? true : size
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
  if (profile.apt.preserveSourcesList) apt['preserve_sources_list'] = true
  // **既定に頼らず必ず出す。**
  // 公式リファレンスは同じ文書の中で食い違っている（`fallback` の節は
  // 「default: offline-install」、既定の apt 設定の例は `fallback: abort`）。
  // スキーマにも既定値の記載は無い。どちらが本当でも意図どおりに効くよう明示する。
  // 「ミラーが使えないとき中止する」か「オフラインで続ける」かは、
  // 取り違えるとインストール結果そのものが変わる。
  //
  // ただし 22.04 のスキーマは apt.fallback を宣言していないので出さない
  // （そのリリースに無いキーを出しても黙って無視される）。検証で伝える。
  if (SERIES_FEATURES[profile.series].aptFallback) {
    apt['fallback'] = profile.apt.fallback
  }
  const sources = buildAptSources(profile)
  if (sources) apt['sources'] = sources
  return Object.keys(apt).length > 0 ? apt : undefined
}

/**
 * 追加リポジトリ。curtin の `apt.sources` 形式。
 * キーが `.list` で終わるとそのファイル名になり、そうでなければ curtin が名前を決める。
 */
function buildAptSources(profile: AutoinstallProfile): Record<string, unknown> | undefined {
  const entries = profile.apt.sources.filter((s) => s.source.trim())
  if (entries.length === 0) return undefined
  const out: Record<string, unknown> = {}
  for (const [i, src] of entries.entries()) {
    const key = src.name.trim() || `autoinstall-${i + 1}.list`
    const value: Record<string, unknown> = { source: src.source.trim() }
    if (src.key.trim()) value['key'] = `${src.key.trim()}\n`
    out[key] = value
  }
  return out
}

/** CIDATA 上のファイルを新システムへコピーする late-command を作る。 */
function fileCopyCommands(profile: AutoinstallProfile): string[] {
  const cmds: string[] = []
  for (const f of profile.postInstall.files) {
    // CIDATA は SEED_MOUNT_PATH に自分でマウントしたもの。
    // /cdrom は ISO9660 パーティションであって CIDATA ではないので使えない。
    const src = `${SEED_MOUNT_PATH}/${f.name}`
    const dest = `/target${f.targetPath}`
    cmds.push(`mkdir -p ${shellQuote(dirnamePosix(dest))}`)
    cmds.push(`cp ${shellQuote(src)} ${shellQuote(dest)}`)
    cmds.push(`chmod ${f.mode} ${shellQuote(dest)}`)
    if (f.owner && f.owner !== 'root') {
      // chown は新システム側の /etc/passwd を見る必要があるので in-target で実行する
      cmds.push(`curtin in-target -- chown ${shellQuote(f.owner)} ${shellQuote(f.targetPath)}`)
    }
  }
  return cmds
}

function dirnamePosix(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/**
 * error-commands を組み立てる。インストールが失敗したときにだけ実行される。
 * 既定でログを集め、CIDATA に書き戻す（再起動すると live 環境のログは消えるため）。
 */
export function collectErrorCommands(profile: AutoinstallProfile): string[] {
  const cmds: string[] = []
  if (profile.postInstall.collectLogsOnError) {
    cmds.push(...ERROR_LOG_COMMANDS, ...errorLogToSeedCommands(SEED_MOUNT_PATH))
  }
  cmds.push(...profile.postInstall.errorCommands)
  return cmds
}

/**
 * early-commands を組み立てる。
 * カーネル引数によるプレースホルダ置換が必要なときだけ 1 コマンドを出す。
 */
/**
 * GRUB の「その場で入力する」を選んだときに出す画面。
 *
 * kernel-arg にした項目（＝起動時に値を渡すつもりだった項目）の画面を出す。
 * ここを「interactive にした項目」から作ると、手入力を選んでも
 * ホスト名の画面が出ないまま既定値でインストールが進む。
 */
function onDemandSections(rv: RuntimeValuesConfig): string[] {
  const out = new Set<string>(interactiveSectionsFor(rv))
  if (rv.hostname === 'kernel-arg') out.add('identity')
  if (rv.network === 'kernel-arg') out.add('network')
  if (rv.disk === 'kernel-arg') out.add('storage')
  return [...out]
}

export function collectEarlyCommands(profile: AutoinstallProfile): string[] {
  const rv = profile.runtimeValues
  if (!usesKernelArgs(rv)) return []
  const net = profile.network
  // raw の netplan と kernel-arg は併用できない（検証でエラーにしている）ので、
  // ここに来る net は必ず target を持つ。
  // bond も同じく併用できない (`validate.networkKernelArgNeedsStatic` が
  // `mode !== 'static'` で必ずエラーにする)。置換スクリプトは
  // `network.ethernets` しか触らないので、bond のアドレスは差し替えられない。
  const target: InterfaceSelector =
    net.mode === 'installer-default' || net.mode === 'raw' ? { kind: 'any' } : net.target
  return [
    buildSubstitutionScript({
      hostname: profile.basics.hostname || 'ubuntu-server',
      interfaceKey: interfaceKeyAndMatch(target).key,
      // 「その場で入力する」を選んだときに出す画面。
      //
      // このメニュー項目は「起動メニューから選ぶ」にした値を手で入れるためのものなので、
      // kernel-arg の項目に対応する画面を出さなければ意味がない。
      // すでに interactive にしている項目の画面も残す（消してはいけない）。
      interactiveOnDemand: onDemandSections(rv),
      fields: {
        hostname: rv.hostname === 'kernel-arg',
        network: rv.network === 'kernel-arg',
        disk: rv.disk === 'kernel-arg',
      },
    }),
  ]
}

/**
 * late-commands を組み立てる。
 *
 * 順序に意味がある:
 *   1. プリセット（sudoers など、他が依存しうる土台）
 *   2. CIDATA をマウント → ファイル配置・アプリ展開 → アンマウント
 *   3. 追加ユーザー・サービス登録・apt full-upgrade
 *   4. ユーザーが自分で書いたコマンド（最後に手を入れられるように）
 */
export function collectLateCommands(profile: AutoinstallProfile): string[] {
  const ctx = { username: profile.user.username, hostname: profile.basics.hostname }
  const provisioning = buildProvisioningCommands(profile)
  const cmds: string[] = []

  // ブートローダの複製は最初に置く。curtin が GRUB を入れ終わったあと
  // （late-commands はインストール本体の後）で、他のどの後処理にも依存しない。
  if (needsRaidEspMirror(profile)) cmds.push(raidEspMirrorCommand())

  // 知らない ID は読み飛ばす（検証側でエラーとして知らせる）
  for (const id of profile.postInstall.presets) {
    const preset = findPreset(id)
    if (preset) cmds.push(...preset.lateCommands(ctx))
  }

  if (provisioning.needsSeedMount) cmds.push(...seedMountCommands())
  cmds.push(...fileCopyCommands(profile))
  cmds.push(...provisioning.late)
  if (provisioning.needsSeedMount) cmds.push(...seedUmountCommands())

  cmds.push(...profile.postInstall.lateCommands)
  return cmds
}

/**
 * 2 台目以降の boot ディスクに GRUB を入れる late-command が要るか。
 *
 * ESP が 1 つしか無いなら何もしない（複製先が無い）。
 * `mirrorBootloader` を切ってあるときも出さない。
 */
export function needsRaidEspMirror(profile: AutoinstallProfile): boolean {
  const storage = profile.storage
  if (storage.mode !== 'raid') return false
  if (!storage.raid.mirrorBootloader) return false
  return buildRaidPlan(storage.raid).espCount >= 2
}

/** 初回起動時に cloud-init が実行するコマンド。 */
export function collectFirstBootCommands(profile: AutoinstallProfile): string[] {
  const provisioning = buildProvisioningCommands(profile)
  // ユーザーが書いたコマンドを先に実行する。GPU は再起動を伴うので必ず最後。
  return [...profile.postInstall.firstBootCommands, ...provisioning.firstBoot]
}

/** プリセットやプロビジョニングが要求する追加パッケージを含めた、重複なしの一覧。 */
export function collectPackages(profile: AutoinstallProfile): string[] {
  const set = new Set<string>(profile.software.packages)
  for (const id of profile.postInstall.presets) {
    for (const pkg of findPreset(id)?.packages ?? []) set.add(pkg)
  }
  for (const pkg of buildProvisioningCommands(profile).packages) set.add(pkg)
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
  const out: Record<string, unknown> = { version: 1 }

  // 「インストーラで手入力する」項目のセクションを足す。
  // kernel-arg を使う場合は、値が渡されなかったときに対話へ切り替えられるよう
  // プレースホルダを 1 つ入れておく（early-commands が空にするか、セクション名に置換する）。
  const interactive = [
    ...new Set([...profile.behavior.interactiveSections, ...interactiveSectionsFor(profile.runtimeValues)]),
  ]
  if (features.interactiveSections) {
    if (profile.behavior.interactiveAll && features.interactiveAll) {
      // "*" は「通常どおり全部聞く」。設定値は各画面の既定値として使われる。
      out['interactive-sections'] = ['*']
    } else if (interactive.length > 0) {
      out['interactive-sections'] = interactive
    }
  }
  // カーネル引数で値を渡す場合、早期コマンドで /autoinstall.yaml を書き換える。
  // autoinstall リファレンス:「early-commands のあとに設定が再読み込みされる」。
  const early = collectEarlyCommands(profile)
  if (early.length > 0) out['early-commands'] = early

  out['locale'] = profile.basics.locale
  const keyboard: Record<string, unknown> = { layout: profile.basics.keyboard.layout }
  if (profile.basics.keyboard.variant) keyboard['variant'] = profile.basics.keyboard.variant
  if (profile.basics.keyboard.toggle) keyboard['toggle'] = profile.basics.keyboard.toggle
  out['keyboard'] = keyboard
  out['timezone'] = profile.basics.timezone
  const refresh: Record<string, unknown> = { update: profile.behavior.refreshInstaller }
  if (profile.behavior.refreshInstallerChannel.trim()) {
    refresh['channel'] = profile.behavior.refreshInstallerChannel.trim()
  }
  out['refresh-installer'] = refresh
  if (features.source) {
    const source: Record<string, unknown> = { id: profile.software.sourceId }
    if (profile.software.searchDrivers !== null) {
      source['search_drivers'] = profile.software.searchDrivers
    }
    out['source'] = source
  }
  if (profile.software.kernel.mode === 'flavor') {
    out['kernel'] = { flavor: profile.software.kernel.flavor }
  } else if (profile.software.kernel.mode === 'package') {
    out['kernel'] = { package: profile.software.kernel.package }
  }
  const network = buildNetwork(profile.network, profile.runtimeValues)
  if (network !== undefined) out['network'] = network
  if (profile.apt.proxy) out['proxy'] = profile.apt.proxy
  const apt = buildApt(profile)
  if (apt) out['apt'] = apt
  out['storage'] = buildStorage(profile.storage, profile.runtimeValues, features)
  out['identity'] = {
    // kernel-arg でもここには既定値を書く。early-commands が YAML を読み書きして
    // 差し替えるので、引数が渡されなければこの値のままインストールが完走する。
    hostname: profile.basics.hostname,
    realname: profile.user.realname,
    username: profile.user.username,
    // autoinstall リファレンスが「特殊文字を正しく扱うためハッシュはクォートせよ」と
    // 明記しているので、YAML 的に不要でも必ず二重引用符で囲む。
    password: quoted(profile.user.passwordHash),
    // identity は additionalProperties: false。groups は 26.04 で追加されたので、
    // 古い版に出すとスキーマ検証で落ちてインストールが中止される。
    ...(features.identityGroups && profile.user.groups.mode === 'append'
      ? { groups: { append: [...profile.user.groups.groups] } }
      : features.identityGroups && profile.user.groups.mode === 'override'
        ? { groups: { override: [...profile.user.groups.groups] } }
        : {}),
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
  const late = collectLateCommands(profile)
  if (late.length > 0) out['late-commands'] = late
  const userData = buildUserData(profile)
  if (userData) out['user-data'] = userData
  if (features.codecsOemAd) {
    if (profile.software.codecs) out['codecs'] = { install: true }
    if (profile.software.oem !== 'auto') {
      out['oem'] = { install: profile.software.oem === 'yes' }
    }
    if (profile.activeDirectory.enabled && profile.activeDirectory.domainName) {
      // 参加に使う管理者名が空だと画面で聞かれるだけで参加できないので、
      // 空のキーは出さない（検証側でもエラーにしている）。
      const ad: Record<string, unknown> = { 'domain-name': profile.activeDirectory.domainName }
      if (profile.activeDirectory.adminName.trim()) {
        ad['admin-name'] = profile.activeDirectory.adminName.trim()
      }
      out['active-directory'] = ad
    }
  }
  if (profile.postInstall.debconfSelections.trim()) {
    out['debconf-selections'] = `${profile.postInstall.debconfSelections.trimEnd()}\n`
  }
  const errorCommands = collectErrorCommands(profile)
  if (errorCommands.length > 0) out['error-commands'] = errorCommands

  // 対話セクションがあると subiquity は reporting を無視する（リファレンスに明記）。
  // 出しても害はないので、設定どおりに出す。
  if (profile.behavior.reportToConsole) {
    out['reporting'] = buildReporting(profile.behavior.reporting)
  } else {
    out['reporting'] = buildReporting({ kind: 'none' })
  }
  out['shutdown'] = profile.behavior.shutdown

  const overlay = parseOverlay(profile.advanced.rawOverlayYaml)
  return overlay ? deepMerge(out, overlay) : out
}

function buildUserData(profile: AutoinstallProfile): Record<string, unknown> | undefined {
  const ud: Record<string, unknown> = {}
  const runcmd = collectFirstBootCommands(profile)
  if (runcmd.length > 0) ud['runcmd'] = runcmd
  return Object.keys(ud).length > 0 ? ud : undefined
}

/**
 * 上書き YAML を読む。**検証と生成の唯一の実装**。
 *
 * 以前は `validate.ts` に同じ判定の写しがあり、`# コメントだけ` の上書き
 * （`toJS()` が null）で食い違っていた。検証は「問題なし」と言い、生成だけが
 * 例外で落ちるので、画面には「YAML の生成に失敗しました」だけが出て
 * どこを直せばよいか分からなかった。コメントだけ＝上書き無しとして扱う。
 */
export function parseOverlay(yaml: string): Record<string, unknown> | undefined {
  const trimmed = yaml.trim()
  if (!trimmed) return undefined
  const doc = parseAutoinstallYaml(trimmed)
  if (doc.errors.length > 0) {
    const detail = doc.errors[0]!.message
    throw new GenerateError(
      // `message` は開発者向けの診断として日本語のまま残す（ログとテストが読む）。
      // 画面に出すのは `text` の方。**連結して英文に混ぜない**。
      `syntax error in the override YAML: ${detail}`,
      // YAML パーサの原文はもともと英語なので、そのまま両方の言語に載せる。
      localized('generate.overlaySyntax', { detail }),
      'advanced.rawOverlayYaml',
    )
  }
  // **`toJS()` は構文が正しくても投げる。**
  // エイリアスを入れ子で増やした YAML は `ReferenceError: Excessive alias count`
  // になり、素で外へ出すと画面には「予期しないエラー」しか出ない（落とし穴 23）。
  // 生の network / storage と**同じ形**で `GenerateError` に包む。
  let js: unknown
  try {
    js = doc.toJS()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new GenerateError(
      `cannot read the override YAML: ${detail}`,
      localized('generate.overlaySyntax', { detail }),
      'advanced.rawOverlayYaml',
    )
  }
  // コメントだけ / `~` だけの上書きは「上書き無し」。エラーにしない。
  if (js === null || js === undefined) return undefined
  if (typeof js !== 'object' || Array.isArray(js)) {
    throw new GenerateError(
      'the override YAML must be a mapping of keys to values',
      localized('generate.overlayNotMapping'),
      'advanced.rawOverlayYaml',
    )
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

const SECTION_COMMENTS: Record<string, MsgKey> = {
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
  kernel: C.kernel,
  'debconf-selections': C.debconf,
  'active-directory': C.activeDirectory,
  codecs: C.codecs,
  oem: C.oem,
  'early-commands': C.earlyCommands,
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
 * user-data の先頭のコメント。**改行は 1 行ずつ `#` を付ける**
 * （訳文に改行が入っても、YAML のコメントの外に出ないように）。
 */
function userDataHeader(profile: AutoinstallProfile, locale: CommentLocale): string {
  const t = createTranslator(locale)
  const lines = [
    t('yaml.header.title'),
    t('yaml.header.generated', { tool: profile.meta.toolVersion, profile: profile.meta.name }),
    t('yaml.header.target', { series: profile.series }),
    '',
    t('yaml.header.magic'),
  ]
  const commented = lines.flatMap((l) => l.split('\n')).map((l) => (l === '' ? '#' : `# ${l}`))
  return ['#cloud-config', ...commented, ''].join('\n')
}

/**
 * cloud-init の NoCloud に置く `user-data` の内容を作る。
 * 先頭の `#cloud-config` は cloud-init が必須とするマジックヘッダ（無いと設定が無視される）。
 */
export function generateUserData(
  profile: AutoinstallProfile,
  options: GenerateOptions = DEFAULT_OPTIONS,
): string {
  const autoinstall = buildAutoinstallObject(profile, options)
  const doc = createAutoinstallDocument({ autoinstall })
  attachComments(doc, options.comments)
  const header = options.comments === 'none' ? '#cloud-config\n' : userDataHeader(profile, options.comments)
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
  const doc = createAutoinstallDocument(autoinstall)
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

// ---------------------------------------------------------------------------
// grub.cfg
// ---------------------------------------------------------------------------

export interface GrubPlan {
  /** すべての casper エントリに付ける引数 */
  readonly args: readonly string[]
  /** ホストごとに追加する menuentry */
  readonly entries: readonly GrubMenuEntry[]
}

/**
 * プロファイルから grub.cfg の改変内容を決める。
 * 実際のパッチ適用は @autoinstall/media の patchGrubCfg が行う。
 */
export function buildGrubPlan(profile: AutoinstallProfile): GrubPlan {
  const args = baseKernelArgs(profile.advanced.extraKernelArgs)
  return { args, entries: buildHostMenuEntries(profile.runtimeValues, []) }
}

/**
 * 生成される autoinstall が「電源を入れるだけで完了する」ものか。
 *
 * プロファイルの設定ではなく **出力される YAML** を見る。
 * `interactive-sections` はシリーズによって出す/出さないが分かれ、
 * 上書き YAML から入ることもあるので、設定だけを見ると表示と実際が食い違う。
 */
export function isUnattendedProfile(
  profile: AutoinstallProfile,
  options: GenerateOptions = DEFAULT_OPTIONS,
): boolean {
  const built = buildAutoinstallObject(profile, options)
  const sections = built['interactive-sections']
  // subiquity は `bool(...)` で見るので、配列でない真値も対話扱いになる。
  if (sections !== undefined && sections !== null) {
    if (!Array.isArray(sections)) return false
    if (sections.length > 0) return false
  }
  // AD 参加はインストール中にパスワードを聞かれる（リファレンスに明記）
  if (built['active-directory'] !== undefined) return false
  return true
}
