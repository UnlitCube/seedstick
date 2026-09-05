import { parseDocument } from 'yaml'
import type { AutoinstallProfile } from './model.js'
import { SERIES_FEATURES } from './model.js'
import { GenerateError, buildAutoinstallObject, collectPackages, parseOverlay } from './generate.js'
import { formatLocalized, localized } from '../i18n/index.js'
import type { LocalizedText, MsgKey, MsgParams } from '../i18n/index.js'
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
  /**
   * 画面に出す総括。**辞書のキー + 差し込み値**で運び、訳すのは renderer だけ。
   *
   * 以前はここが `messageJa` / `messageEn` という「両方の言語の文字列」だった。
   * 辞書を通らないので `i18n.test.ts` のキー検査・差し込み名の検査が効かず、
   * 英訳漏れや日本語の混入を機械が見つけられなかった。さらに差し込み値を
   * 言語ごとに文字列連結していたため、**同じ間違いを 2 回書ける**形だった。
   */
  readonly text: LocalizedText
  /**
   * 開発者向けの生の診断（訳さない）。**総括は必ず `text` に入れる**。
   *
   * ここに入るのは「訳せる情報を持たない例外」の `Error.message` だけ。
   * 総括を訳し、生の詳細は別の行に出す 2 本立ては `WriteStatus.detail` と同じ方針。
   * 訳文に連結すると英語の画面に日本語が混ざる（実際にそうなっていた）。
   */
  readonly detail?: string
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

/**
 * 上書き YAML が書き換えるトップレベルのキー。壊れた YAML でも例外にしない。
 *
 * 判定は生成側 (`parseOverlay`) と**同じ実装**を通す。写しを持つと
 * 「検証は通るのに生成だけ落ちる」食い違いが戻る。
 */
function overlayTopLevelKeys(yamlText: string): string[] {
  try {
    return Object.keys(parseOverlay(yamlText) ?? {})
  } catch {
    return []
  }
}

/**
 * 生成の例外を指摘 1 件にする。**日本語の診断を英文に連結しない**。
 *
 * `GenerateError` は訳せる文言 (`text`) を持つので、そのまま運ぶ。
 * 持たない例外（手で編集された JSON からの TypeError など）は総括だけをキーにし、
 * 生の `Error.message` は訳さない `detail` として別に運ぶ。
 */
export function generateErrorIssue(err: unknown): ValidationIssue {
  if (err instanceof GenerateError) {
    return { severity: 'error', field: err.field, text: err.text }
  }
  return {
    severity: 'error',
    // 生成のどこで落ちたかは分からないので、特定の設定項目のせいにしない。
    field: 'generate',
    text: localized('generate.failed'),
    detail: err instanceof Error ? err.message : String(err),
  }
}

/**
 * 同じ場所・同じ文言の指摘を二重に出さない（検証と生成で同じ例外を 2 度見るため）。
 *
 * 比べるのは**訳した文字列**。`key` だけで比べると、差し込み値が違う 2 件
 * （別々の上書き YAML のエラー）が片方消える。`params` を `JSON.stringify` で
 * 比べるとキーの並び順に依存する。訳して比べれば以前の `messageJa` の比較と同じ。
 */
export function addUniqueIssue(issues: ValidationIssue[], issue: ValidationIssue): void {
  const ja = formatLocalized('ja', issue.text)
  if (issues.some((i) => i.field === issue.field && formatLocalized('ja', i.text) === ja)) return
  issues.push(issue)
}

export function validateProfile(profile: AutoinstallProfile): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (severity: IssueSeverity, field: string, key: MsgKey, params?: MsgParams): void => {
    issues.push({ severity, field, text: localized(key, params) })
  }
  const features = SERIES_FEATURES[profile.series]
  // 知らないプリセット ID があると getPreset が投げる。検証が例外で抜けると
  // 確認画面が理由なく空になるので、ここで分けて以降は known だけを使う。
  const presets = knownPresetIds(profile)
  for (const id of presets.unknown) {
    add('error', 'postInstall.presets', 'validate.unknownPreset', { id })
  }
  // インストール時に手入力になるセクション（設定と「実行時に決める値」の合成）
  const interactive = [
    ...new Set([...profile.behavior.interactiveSections, ...interactiveSectionsFor(profile.runtimeValues)]),
  ]

  // --- 基本 ---
  if (!profile.basics.hostname) {
    add('error', 'basics.hostname', 'validate.hostnameEmpty')
  } else if (!HOSTNAME_RE.test(profile.basics.hostname)) {
    add('error', 'basics.hostname', 'validate.hostnameInvalid')
  }
  if (!profile.basics.locale) {
    add('error', 'basics.locale', 'validate.localeEmpty')
  }
  if (!profile.basics.keyboard.layout) {
    add('error', 'basics.keyboard', 'validate.keyboardEmpty')
  }

  // --- ユーザー ---
  if (!profile.user.username) {
    add('error', 'user.username', 'validate.usernameEmpty')
  } else if (!USERNAME_RE.test(profile.user.username)) {
    add('error', 'user.username', 'validate.usernameInvalid')
  } else if (RESERVED_USERNAMES.has(profile.user.username)) {
    add('error', 'user.username', 'validate.usernameReserved', { username: profile.user.username })
  }
  if (profile.user.username === profile.basics.hostname) {
    add('warning', 'user.username', 'validate.usernameSameAsHostname')
  }
  if (!profile.user.passwordHash) {
    add('error', 'user.passwordHash', 'validate.passwordMissing')
  } else if (!looksLikeCryptHash(profile.user.passwordHash)) {
    add('error', 'user.passwordHash', 'validate.passwordPlainText')
  } else if (!isValidSha512CryptHash(profile.user.passwordHash)) {
    add('warning', 'user.passwordHash', 'validate.passwordHashNotSha512')
  }

  // --- SSH ---
  for (const [i, key] of profile.ssh.authorizedKeys.entries()) {
    if (!SSH_KEY_RE.test(key.trim())) {
      add('error', `ssh.authorizedKeys[${i}]`, 'validate.sshKeyMalformed', { n: i + 1 })
    }
  }
  if (!profile.ssh.installServer && profile.ssh.authorizedKeys.length > 0) {
    add('warning', 'ssh.installServer', 'validate.sshKeysWithoutServer')
  }
  const hardened = profile.postInstall.presets.includes('ssh-harden')
  if (hardened && profile.ssh.authorizedKeys.length === 0) {
    add('error', 'ssh.authorizedKeys', 'validate.sshHardenWithoutKeys')
  }
  if (!profile.ssh.allowPasswordAuth && profile.ssh.authorizedKeys.length === 0 && profile.ssh.installServer) {
    add('error', 'ssh.allowPasswordAuth', 'validate.sshNoPasswordNoKey')
  }

  // --- ネットワーク ---
  if (profile.network.mode === 'static') {
    if (!isValidCidr(profile.network.address)) {
      add('error', 'network.address', 'validate.networkAddressInvalid')
    }
    if (profile.network.gateway && !isValidIPv4(profile.network.gateway)) {
      add('error', 'network.gateway', 'validate.networkGatewayInvalid')
    }
    if (!profile.network.gateway) {
      add('warning', 'network.gateway', 'validate.networkGatewayMissing')
    }
    for (const [i, ns] of profile.network.nameservers.entries()) {
      if (!isValidIPv4(ns)) {
        add('error', `network.nameservers[${i}]`, 'validate.networkNameserverInvalid', { n: i + 1 })
      }
    }
    if (profile.network.nameservers.length === 0) {
      add('warning', 'network.nameservers', 'validate.networkNameserversMissing')
    }
  } else if (profile.network.mode === 'raw') {
    const doc = parseDocument(profile.network.yaml)
    if (doc.errors.length > 0) {
      add('error', 'network.yaml', 'validate.networkYamlSyntax', { detail: doc.errors[0]!.message })
    }
  }

  // --- ストレージ ---
  if (profile.storage.mode === 'raw') {
    const doc = parseDocument(profile.storage.yaml)
    if (doc.errors.length > 0) {
      add('error', 'storage.yaml', 'validate.storageYamlSyntax', { detail: doc.errors[0]!.message })
    }
  } else {
    if (profile.storage.mode === 'zfs' && profile.storage.encryptionPassphrase) {
      add('warning', 'storage.encryptionPassphrase', 'validate.zfsEncryptionUnverified')
    }
    if (profile.storage.encryptionPassphrase && profile.storage.encryptionPassphrase.length < 8) {
      add('error', 'storage.encryptionPassphrase', 'validate.encryptionPassphraseTooShort')
    }
    if (profile.storage.encryptionPassphrase) {
      add('warning', 'storage.encryptionPassphrase', 'validate.encryptionPassphrasePlainInYaml')
      if (profile.storage.mode !== 'lvm') {
        // layout.password は lvm レイアウトにしか無い。他では黙って無視される。
        add(
          'error',
          'storage.encryptionPassphrase',
          'validate.encryptionRequiresLvm',
          { mode: profile.storage.mode },
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
      add('error', 'storage.match', 'validate.diskMatchEmpty')
    }

    // 実行時にディスクを決める設定なら、ここの match は使われないので助言しない。
    //
    // `kind: 'any'` は `match: {}` を出力する。subiquity から見ると
    // 「どのディスクでもよい」なので、複数ディスク機では**どれを消すか分からない**。
    // 最も危険な指定なのに、より安全な largest / smallest にだけ注意書きがあり、
    // ここだけ無言だった（落とし穴 22 と同じ形の事故になる）。
    if (profile.runtimeValues.disk === 'fixed' && profile.storage.match.kind === 'any') {
      add('warning', 'storage.match', 'validate.diskMatchAny')
    }
    if (
      profile.runtimeValues.disk === 'fixed' &&
      (profile.storage.match.kind === 'largest' || profile.storage.match.kind === 'smallest')
    ) {
      add('info', 'storage.match', 'validate.diskMatchSizeBased')
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
        'validate.archiveFormatUnsupported',
        { name: d.name, format: String(d.archiveFormat) },
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
        add('warning', 'postInstall.files', 'validate.fileOwnerNotCreated', { name: f.name, owner })
      }
    }
    for (const d of profile.postInstall.deployments) {
      if (!known(d.owner ?? '')) {
        add(
          'warning',
          'postInstall.deployments',
          'validate.deploymentOwnerNotCreated',
          { name: d.name, owner: d.owner },
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
        'validate.resetPartitionUnsupported',
        { series: profile.series },
      )
    }
  }

  // --- 追加リポジトリの名前 ---
  // curtin の apt.sources はキーがそのままファイル名になりうる
  // （`.list` で終わる場合）。重複すると片方が黙って消え、
  // `__proto__` のようなキーはオブジェクトごと壊す。
  {
    const seen = new Set<string>()
    for (const [i, src] of profile.apt.sources.entries()) {
      const name = src.name.trim()
      if (!name) continue // 空なら生成側が autoinstall-N.list を振る
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
        add('error', `apt.sources[${i}].name`, 'validate.aptSourceNameInvalid', { name })
        continue
      }
      if (seen.has(name)) {
        add('error', `apt.sources[${i}].name`, 'validate.aptSourceNameDuplicated', { name })
      }
      seen.add(name)
    }
  }

  // --- ミラーが使えないときの動作 ---
  // 22.04 のスキーマは apt.fallback を宣言していないので出力しない。
  // 既定と違う値を選んでいるなら、効かないことを伝える。
  if (!SERIES_FEATURES[profile.series].aptFallback && profile.apt.fallback !== 'abort') {
    add('warning', 'apt.fallback', 'validate.aptFallbackUnsupported', { series: profile.series })
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
        add('error', 'software.gpu.toolkit', 'validate.cudaToolkitNameInvalid', { toolkit })
      }
    }
  }

  // --- 追加ファイル / 展開の所有者 ---
  // chown にそのまま渡るので、ユーザー名として妥当な形だけを許す。
  const OWNER_RE = /^[a-z_][a-z0-9_-]{0,31}(:[a-z_][a-z0-9_-]{0,31})?$/
  for (const f of profile.postInstall.files) {
    if (f.owner && !OWNER_RE.test(f.owner)) {
      add('error', 'postInstall.files', 'validate.fileOwnerInvalid', { name: f.name, owner: f.owner })
    }
  }
  for (const d of profile.postInstall.deployments) {
    // 項目名は**入れ子の `LocalizedText`** で差し込む。以前は日本語の文に生の
    // 「所有者」を、英文に `label === '所有者' ? 'owner' : 'group'` を埋めていた。
    // 差し込み名の集合が ja と en で揃わないので、辞書の検査が通らない形だった。
    for (const [fieldKey, value] of [
      ['validate.fieldOwner', d.owner],
      ['validate.fieldGroup', d.group],
    ] as const satisfies readonly (readonly [MsgKey, string])[]) {
      if (value && !/^[a-z_][a-z0-9_-]{0,31}$/.test(value)) {
        add('error', 'postInstall.deployments', 'validate.deploymentOwnerFieldInvalid', {
          name: d.name,
          field: localized(fieldKey),
          value,
        })
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
        add('error', 'network.target', 'validate.interfaceNameEmpty')
      } else if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) {
        add('error', 'network.target', 'validate.interfaceNameInvalid', { name })
      }
    }
    if (target.kind === 'mac') {
      const mac = typeof target.macaddress === 'string' ? target.macaddress.trim() : ''
      if (!MAC_RE.test(mac)) {
        add('error', 'network.target', 'validate.macAddressInvalid')
      }
    }
  }

  // --- APT ミラー ---
  // custom を選んだのに URI が空だと、mirror-selection ごと出力から消える。
  // 「速いミラーを指定したのに既定のまま」という気づきにくい遅さになる。
  if (profile.apt.mode === 'custom' && !profile.apt.primaryUri.trim()) {
    add('error', 'apt.primaryUri', 'validate.aptMirrorUriEmpty')
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
        'validate.overlayOverridesDangerousKeys',
        { keys: dangerous.join(' / ') },
      )
    }
  }

  // --- ソフトウェア / ネットワーク依存 ---
  const packages = collectPackages(profile)
  const needsNetworkPresets = presets.known.filter((id) => getPreset(id).needsNetwork)
  if ((packages.length > 0 || profile.software.snaps.length > 0 || needsNetworkPresets.length > 0) && profile.network.mode === 'static' && !profile.network.gateway) {
    add('error', 'software.packages', 'validate.packagesWithoutGateway')
  }
  if (profile.software.ubuntuProToken && !/^C[1-9A-HJ-NP-Za-km-z]{23,29}$/.test(profile.software.ubuntuProToken)) {
    add('error', 'software.ubuntuProToken', 'validate.ubuntuProTokenInvalid')
  }
  if (!features.source && profile.software.sourceId === 'ubuntu-server-minimal') {
    add('warning', 'software.sourceId', 'validate.sourceKeyUnsupported', { series: profile.series })
  }
  if (!features.kernelCrashDumps && profile.software.kernelCrashDumps !== null) {
    add(
      'warning',
      'software.kernelCrashDumps',
      'validate.kernelCrashDumpsUnsupported',
      { series: profile.series },
    )
  }

  // --- インストール後処理 ---
  for (const [i, f] of profile.postInstall.files.entries()) {
    if (!f.targetPath.startsWith('/')) {
      add('error', `postInstall.files[${i}].targetPath`, 'validate.fileTargetPathNotAbsolute', { n: i + 1 })
    }
    if (!/^0?[0-7]{3}$/.test(f.mode)) {
      add('error', `postInstall.files[${i}].mode`, 'validate.fileModeInvalid', { n: i + 1 })
    }
    if (!f.name || /[\\/:*?"<>|]/.test(f.name)) {
      add('error', `postInstall.files[${i}].name`, 'validate.fileNameInvalid', { n: i + 1 })
    }
  }
  if (profile.postInstall.presets.includes('sudo-nopasswd')) {
    add('info', 'postInstall.presets', 'validate.sudoNopasswdWarning')
  }

  // --- 追加ユーザー ---
  const allUsernames = new Set<string>([profile.user.username])
  for (const [i, u] of profile.postInstall.additionalUsers.entries()) {
    const where = `postInstall.additionalUsers[${i}]`
    if (!u.username) {
      add('error', `${where}.username`, 'validate.additionalUserNameEmpty', { n: i + 1 })
    } else if (!USERNAME_RE.test(u.username)) {
      add('error', `${where}.username`, 'validate.additionalUserNameInvalid', { username: u.username })
    } else if (RESERVED_USERNAMES.has(u.username)) {
      add('error', `${where}.username`, 'validate.additionalUserNameReserved', { username: u.username })
    } else if (allUsernames.has(u.username)) {
      add('error', `${where}.username`, 'validate.additionalUserNameDuplicated', { username: u.username })
    }
    allUsernames.add(u.username)

    if (u.passwordHash && !looksLikeCryptHash(u.passwordHash)) {
      add(
        'error',
        `${where}.passwordHash`,
        'validate.additionalUserPasswordPlainText',
        { username: u.username },
      )
    }
    if (!u.passwordHash && u.sshAuthorizedKeys.length === 0 && !u.systemAccount) {
      add('warning', `${where}.passwordHash`, 'validate.additionalUserNoLogin', { username: u.username })
    }
    for (const [k, key] of u.sshAuthorizedKeys.entries()) {
      if (!SSH_KEY_RE.test(key.trim())) {
        add(
          'error',
          `${where}.sshAuthorizedKeys[${k}]`,
          'validate.additionalUserSshKeyMalformed',
          { username: u.username, n: k + 1 },
        )
      }
    }
    if (u.sudo === 'nopasswd') {
      add('info', `${where}.sudo`, 'validate.additionalUserSudoNopasswd', { username: u.username })
    }
  }

  // --- アプリの展開 ---
  for (const [i, d] of profile.postInstall.deployments.entries()) {
    const where = `postInstall.deployments[${i}]`
    if (!d.targetPath.startsWith('/')) {
      add('error', `${where}.targetPath`, 'validate.deploymentTargetPathNotAbsolute', { n: i + 1 })
    }
    if (!d.name || /[\\/:*?"<>|]/.test(d.name)) {
      add('error', `${where}.name`, 'validate.deploymentNameInvalid', { n: i + 1 })
    }
    if (d.kind === 'file' && !/^0?[0-7]{3}$/.test(d.mode)) {
      add('error', `${where}.mode`, 'validate.deploymentModeInvalid', { n: i + 1 })
    }
    if (d.source.kind === 'url') {
      if (!/^https?:\/\//.test(d.source.url)) {
        add('error', `${where}.source.url`, 'validate.deploymentUrlInvalid', { n: i + 1 })
      }
      if (!d.source.sha256) {
        add('warning', `${where}.source.sha256`, 'validate.deploymentSha256Missing', { n: i + 1 })
      } else if (!/^[0-9a-f]{64}$/i.test(d.source.sha256)) {
        add('error', `${where}.source.sha256`, 'validate.deploymentSha256Invalid', { n: i + 1 })
      }
    }
    if (d.source.kind === 'host-file' && !d.source.path) {
      add('error', `${where}.source.path`, 'validate.deploymentSourceFileMissing', { n: i + 1 })
    }
  }

  // --- systemd サービス ---
  const serviceNames = new Set<string>()
  for (const [i, svc] of profile.postInstall.services.entries()) {
    const where = `postInstall.services[${i}]`
    if (!isValidServiceName(svc.name)) {
      add('error', `${where}.name`, 'validate.serviceNameInvalid', { n: i + 1 })
    } else if (serviceNames.has(svc.name)) {
      add('error', `${where}.name`, 'validate.serviceNameDuplicated', { name: svc.name })
    }
    serviceNames.add(svc.name)
    if (!svc.execStart.trim()) {
      add('error', `${where}.execStart`, 'validate.serviceExecStartEmpty', { name: svc.name })
    } else if (!svc.execStart.trim().startsWith('/')) {
      add('warning', `${where}.execStart`, 'validate.serviceExecStartNotAbsolute', { name: svc.name })
    }
    if (svc.user && svc.user !== 'root' && svc.user !== 'nobody' && !allUsernames.has(svc.user)) {
      add('warning', `${where}.user`, 'validate.serviceUserNotCreated', { name: svc.name, user: svc.user })
    }
    if (svc.group && svc.group !== 'root' && !allUsernames.has(svc.group)) {
      add('info', `${where}.group`, 'validate.serviceGroupNotCreated', { name: svc.name, group: svc.group })
    }
    for (const [k, e] of svc.environment.entries()) {
      if (e.trim() && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(e.trim())) {
        add('error', `${where}.environment[${k}]`, 'validate.serviceEnvironmentInvalid', { name: svc.name })
      }
    }
  }

  // --- GPU / CUDA ---
  if (profile.software.gpu.enabled) {
    if (CUDA_REPO_DISTRO[profile.series] === null) {
      add('error', 'software.gpu', 'validate.cudaRepoMissingForSeries', { series: profile.series })
    }
    if (cudaPackages(profile.software.gpu).length === 0) {
      add('warning', 'software.gpu', 'validate.gpuNothingSelected')
    }
    if (profile.software.gpu.containerToolkit && !profile.postInstall.presets.includes('docker-ce')) {
      add('warning', 'software.gpu.containerToolkit', 'validate.containerToolkitWithoutDocker')
    }
    add('info', 'software.gpu', 'validate.cudaDownloadsOnFirstBoot')
  }

  if (profile.behavior.interactiveAll && !features.interactiveAll) {
    add('warning', 'behavior.interactiveAll', 'validate.interactiveAllUnverified', { series: profile.series })
  }

  if (profile.behavior.reporting.kind === 'rsyslog') {
    // autoinstall リファレンス: "The rsyslog reporter does not yet exist."
    add('warning', 'behavior.reporting', 'validate.rsyslogNotImplemented')
  }

  // --- 実行時に決める値 ---
  const rv = profile.runtimeValues
  if (!usesKernelArgs(rv) && rv.presets.length > 0) {
    // どの項目も「固定値」なら起動メニューは作られず、`buildRuntimePresets()` は
    // 空を返す。作ったホストの一覧は**黙って捨てられる**。
    // UI からも表が消えるので、何も言わないと「設定したのに効かない」になる
    // （落とし穴 67）。消さずに残すのが正しい（また使うかもしれない）ので、
    // 効かないことだけを伝える。
    add('warning', 'runtimeValues.presets', 'validate.hostsWithoutKernelArgs', {
      n: rv.presets.length,
    })
  }
  if (usesKernelArgs(rv)) {
    if (!features.interactiveSections) {
      add('warning', 'runtimeValues', 'validate.interactiveSectionsUnsupported', { series: profile.series })
    }
    if (rv.presets.length === 0) {
      add('warning', 'runtimeValues.presets', 'validate.kernelArgsWithoutHosts')
    }
    const labels = new Set<string>()
    for (const [i, p] of rv.presets.entries()) {
      const where = `runtimeValues.presets[${i}]`
      if (!isSafePresetLabel(p.label)) {
        add('error', `${where}.label`, 'validate.hostLabelInvalid', { n: i + 1 })
      } else if (labels.has(p.label)) {
        add('error', `${where}.label`, 'validate.hostLabelDuplicated', { label: p.label })
      }
      labels.add(p.label)

      // 手で編集された JSON ではキーが無いことがある。文字列以外は空として扱う。
      const f = (v: unknown): string => (typeof v === 'string' ? v : '')
      // 3 つ目は**項目名の辞書キー**。文にそのまま埋めると、ja が「ホスト名」で
      // en が `hostname` という食い違った差し込みになり、辞書の検査が効かない。
      const fields: [string, string, MsgKey][] = []
      if (rv.hostname === 'kernel-arg') fields.push(['hostname', f(p.hostname), 'validate.hostFieldHostname'])
      if (rv.network === 'kernel-arg') {
        // ゲートウェイと DNS は空でもよい（外に出ない閉じたネットワークがある）。
        // IP アドレスだけは無いと netplan が成立しない。
        fields.push(['ipv4', f(p.ipv4), 'validate.hostFieldIpv4'])
        if (f(p.gateway)) fields.push(['gateway', f(p.gateway), 'validate.hostFieldGateway'])
        if (f(p.nameservers)) {
          fields.push([
            'nameservers',
            f(p.nameservers).replace(/\s+/g, ''),
            'validate.hostFieldNameservers',
          ])
        }
      }
      if (rv.disk === 'kernel-arg') fields.push(['disk', f(p.disk), 'validate.hostFieldDisk'])

      // 書式まで見る。ここを通った値は起動メニューのカーネル引数になり、
      // インストーラが netplan / curtin にそのまま渡す。
      if (rv.hostname === 'kernel-arg' && f(p.hostname) && !HOSTNAME_RE.test(f(p.hostname))) {
        add('error', `${where}.hostname`, 'validate.hostHostnameInvalid', { label: p.label })
      }
      if (rv.network === 'kernel-arg') {
        if (f(p.gateway) && !isValidIPv4(f(p.gateway))) {
          add('error', `${where}.gateway`, 'validate.hostGatewayInvalid', { label: p.label })
        }
        for (const ns of f(p.nameservers).split(',').map((x) => x.trim()).filter(Boolean)) {
          if (!isValidIPv4(ns)) {
            add('error', `${where}.nameservers`, 'validate.hostNameserverInvalid', { label: p.label, ns })
          }
        }
      }
      if (rv.disk === 'kernel-arg' && f(p.disk).startsWith('/dev/')) {
        // storage.layout.match.serial に入るので、デバイスパスを書いても一致しない
        add('error', `${where}.disk`, 'validate.hostDiskNotSerial', { label: p.label })
      }

      for (const [key, value, fieldKey] of fields) {
        if (!value) {
          add('error', `${where}.${key}`, 'validate.hostFieldEmpty', {
            label: p.label,
            field: localized(fieldKey),
          })
        } else if (!isSafeRuntimeValue(value)) {
          add('error', `${where}.${key}`, 'validate.hostFieldInvalidChars', {
            label: p.label,
            field: localized(fieldKey),
          })
        }
      }
      if (rv.network === 'kernel-arg' && f(p.ipv4) && !isValidCidr(f(p.ipv4))) {
        add('error', `${where}.ipv4`, 'validate.hostIpv4Invalid', { label: p.label })
      }
    }
    add('info', 'runtimeValues', 'validate.grubMenuHostSelection')
  }
  if (rv.disk === 'kernel-arg' && profile.storage.mode === 'raw') {
    add('error', 'runtimeValues.disk', 'validate.diskKernelArgWithRawStorage')
  }
  if (rv.network === 'kernel-arg' && profile.network.mode === 'raw') {
    add('error', 'runtimeValues.network', 'validate.networkKernelArgWithRawNetplan')
  }
  // 引数が渡されなかったときの既定値が空だと、netplan に空のアドレスが残って
  // インストールが失敗する。GRUB の既定エントリで起動されると必ずこの経路に入る。
  if (rv.network === 'kernel-arg' && profile.network.mode !== 'static' && profile.network.mode !== 'raw') {
    add('error', 'runtimeValues.network', 'validate.networkKernelArgNeedsStatic')
  }
  // 既定値（引数が渡されなかったときに使う値）も検証する。
  // ここを素通りさせると、起動メニュー経由で作った USB が「引数なしで起動したときだけ壊れる」
  // という追いにくい形になる。
  if (rv.network === 'kernel-arg' && profile.network.mode === 'static') {
    // 閉じたネットワーク（外に出ない検証環境など）ではゲートウェイも DNS も要らない。
    // 必須にすると表現できなくなるので、注意として出すに留める。
    if (!profile.network.gateway) {
      add('warning', 'network.gateway', 'validate.defaultGatewayMissingForKernelArg')
    }
    if (profile.network.nameservers.length === 0) {
      add('warning', 'network.nameservers', 'validate.defaultNameserversMissingForKernelArg')
    }
  }
  if (
    rv.disk === 'kernel-arg' &&
    profile.storage.mode !== 'raw' &&
    profile.storage.match.kind !== 'serial'
  ) {
    add('error', 'runtimeValues.disk', 'validate.diskKernelArgNeedsSerialMatch')
  }
  if (profile.behavior.interactiveAll && usesKernelArgs(rv)) {
    add('warning', 'behavior.interactiveAll', 'validate.interactiveAllOverridesKernelArgs')
  }

  // --- カーネル / APT / その他の追加キー ---
  if (profile.software.kernel.mode === 'flavor' && !profile.software.kernel.flavor.trim()) {
    add('error', 'software.kernel', 'validate.kernelFlavorEmpty')
  }
  if (profile.software.kernel.mode === 'package' && !profile.software.kernel.package.trim()) {
    add('error', 'software.kernel', 'validate.kernelPackageEmpty')
  }
  if (profile.software.kernel.mode !== 'default' && profile.software.oem === 'yes') {
    add('warning', 'software.oem', 'validate.oemConflictsWithKernel')
  }
  for (const [i, src] of profile.apt.sources.entries()) {
    const where = `apt.sources[${i}]`
    const value = src.source.trim()
    if (!value) {
      add('error', `${where}.source`, 'validate.aptSourceEmpty', { n: i + 1 })
    } else if (!isPpaSource(value) && !isDebLineSource(value)) {
      add('error', `${where}.source`, 'validate.aptSourceFormatInvalid', { n: i + 1 })
    }
    if (isDebLineSource(value) && !src.key.trim() && !/signed-by=/.test(value)) {
      add('warning', `${where}.key`, 'validate.aptSourceKeyMissing', { n: i + 1 })
    }
  }
  if (profile.apt.preserveSourcesList && profile.apt.mode !== 'default') {
    add('warning', 'apt.preserveSourcesList', 'validate.preserveSourcesListIgnoresMirror')
  }
  if (profile.storage.mode !== 'raw') {
    if (profile.storage.swap.mode === 'size' && !isValidSizeSpec(profile.storage.swap.size)) {
      add('error', 'storage.swap', 'validate.swapSizeInvalid')
    }
    if (
      profile.storage.resetPartition.enabled &&
      profile.storage.resetPartition.size.trim() &&
      !isValidSizeSpec(profile.storage.resetPartition.size)
    ) {
      add('error', 'storage.resetPartition', 'validate.resetPartitionSizeInvalid')
    }
  }
  if (profile.user.groups.mode !== 'default') {
    if (!features.identityGroups) {
      add('warning', 'user.groups', 'validate.identityGroupsUnsupported', { series: profile.series })
    } else if (profile.user.groups.mode === 'override' && !profile.user.groups.groups.includes('sudo')) {
      add('warning', 'user.groups', 'validate.groupOverrideWithoutSudo')
    }
  }
  if (profile.activeDirectory.enabled) {
    if (!features.codecsOemAd) {
      add('warning', 'activeDirectory', 'validate.activeDirectoryUnsupported', { series: profile.series })
    } else {
      if (!profile.activeDirectory.domainName.trim()) {
        add('error', 'activeDirectory.domainName', 'validate.adDomainNameEmpty')
      }
      if (!profile.activeDirectory.adminName.trim()) {
        // 空のまま出すとインストーラが画面で聞くだけになり、参加は成立しない
        add('error', 'activeDirectory.adminName', 'validate.adAdminNameEmpty')
      }
      add('warning', 'activeDirectory', 'validate.adPasswordPrompt')
    }
  }
  if (profile.behavior.reporting.kind === 'webhook' && !/^https?:\/\//.test(profile.behavior.reporting.endpoint)) {
    add('error', 'behavior.reporting', 'validate.webhookUrlInvalid')
  }
  if (profile.behavior.reporting.kind === 'rsyslog' && !profile.behavior.reporting.destination.trim()) {
    add('error', 'behavior.reporting', 'validate.rsyslogDestinationEmpty')
  }
  if (
    profile.behavior.reporting.kind !== 'console' &&
    (interactive.length > 0 || profile.behavior.interactiveAll)
  ) {
    add('info', 'behavior.reporting', 'validate.reportingIgnoredWhenInteractive')
  }

  // --- 上書き YAML ---
  // ここで先に見ておく。最後の buildAutoinstallObject でも同じ例外は出るが、
  // それより前で別の理由が投げると上書き YAML の指摘が隠れる（field も 'generate' に落ちる）。
  if (profile.advanced.rawOverlayYaml.trim()) {
    try {
      parseOverlay(profile.advanced.rawOverlayYaml)
    } catch (err) {
      addUniqueIssue(issues, generateErrorIssue(err))
    }
  }
  // grub.cfg の中で意味を持つ文字は全部弾く。; & | だけでは足りない
  // （" はクォートを閉じ、# は行コメント、$ と { } は変数展開になる）。
  if (/["#$'{}\\<>`\r\n]/.test(profile.advanced.extraKernelArgs)) {
    add('error', 'advanced.extraKernelArgs', 'validate.kernelArgsSpecialChars')
  }
  if (/[;&|]/.test(profile.advanced.extraKernelArgs)) {
    add('error', 'advanced.extraKernelArgs', 'validate.kernelArgsCommandChars')
  }

  // --- 完全無人になるか ---
  if (interactive.length > 0 || profile.behavior.interactiveAll) {
    add('info', 'behavior.interactiveSections', 'validate.interactiveSectionsPause')
  }

  // 生成そのものが失敗しないかを最後に確認する。
  // 例外のメッセージ（日本語の診断）を訳文に連結しない — `generateErrorIssue` を通す。
  try {
    buildAutoinstallObject(profile)
  } catch (err) {
    addUniqueIssue(issues, generateErrorIssue(err))
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}
