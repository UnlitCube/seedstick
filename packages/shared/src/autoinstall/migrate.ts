import { createDefaultProfile } from './defaults.js'
import type { AutoinstallProfile, UbuntuSeries } from './model.js'
import type {
  ActiveDirectoryConfig,
  KernelChoice,
  PrimaryUserGroups,
  ReportingTarget,
} from './advanced.js'
import { UBUNTU_SERIES } from './model.js'

// 保存済みプロファイルの読み込み。
// 古い形式や、手で編集されて壊れた JSON でもアプリが落ちないよう、
// 「既定値に、認識できたフィールドだけを重ねる」方針で読む。

/** オブジェクトか（配列と null を除く） */
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * 列挙値。知らない値なら既定へ戻し、戻したことを伝える。
 *
 * 素通しにすると、手で編集された JSON や将来のバージョンで保存された
 * プロファイルの値がそのまま autoinstall YAML に出る。
 * subiquity 側で弾かれるので、気づくのは**実機でインストールを始めてから**になる。
 * migrate も validate も何も言わないまま USB が焼き上がる。
 */
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T
  }
  if (value !== undefined) {
    noteDropped(
      `${label} の値 (${String(value)}) を認識できなかったため既定 (${fallback}) に戻しました。`,
    )
  }
  return fallback
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * 既定値の同じ形をひな型に、保存値で上書きする（深いマージ）。
 *
 * **既定値の型と一致しない値は採らない。** 手で編集された JSON でも
 * 「型は AutoinstallProfile なのに中身が null」という状態を作らないことが要件で、
 * これが崩れると validateProfile / buildAutoinstallObject が例外で抜け、
 * GUI は理由の分からない空の確認画面になる。
 *
 * `typeof null === 'object'` なので、素朴に `typeof current === typeof value` と
 * 書くと null と配列がネストしたオブジェクトを置き換えてしまう。必ず isObject で見る。
 *
 * 判別可能ユニオン（`storage.match` など）はこの関数では扱えない
 * （既定バリアントに無いキーが落ちる）。呼び出し側が専用の読み取り関数を使う。
 */
function mergeSection<T extends Record<string, unknown>>(base: T, raw: unknown): T {
  if (!isObject(raw)) return base
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base)) {
    const value = raw[key]
    if (value === undefined) continue
    const current = out[key]
    if (Array.isArray(current)) {
      // **要素の型まで見る。** レコードの配列（files / services など）は
      // 呼び出し側が mergeList でひな型に重ねるが、**レコードの中の配列**
      // （services[].environment、additionalUsers[].sshAuthorizedKeys、
      //   behavior.interactiveSections …）はここを通る。
      // 素通しにすると `environment: [42]` が型だけ合った状態で通り、
      // validateProfile も buildAutoinstallObject も `e.trim is not a function` で
      // 落ちる。GUI は理由の分からない空の確認画面になる（落とし穴 23）。
      //
      // この分岐を通る配列は、このリポジトリではすべて `readonly string[]`
      // （オブジェクトの配列は呼び出し側が必ず上書きする）。文字列だけを採る。
      // これでプロトタイプ汚染も同時に塞がる（オブジェクトが一切通らないため）。
      if (Array.isArray(value)) out[key] = strList(value)
    } else if (isObject(current)) {
      // ネストしたオブジェクト。null や配列や文字列で置き換えさせない。
      if (isObject(value)) out[key] = mergeSection(current as Record<string, unknown>, value)
    } else if (current === null) {
      // `string | null` や `boolean | null` のキー。素の値と null だけ通す。
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        out[key] = value
      }
    } else if (typeof current === typeof value && !isObject(value) && !Array.isArray(value)) {
      out[key] = value
    }
  }
  return out as T
}

/**
 * レコードの配列を、要素ごとにひな型へ重ねて読む。
 *
 * 素通しにすると `files: [null]` のような配列が型だけ合った状態で通り、
 * 下流の `.targetPath` で落ちる（React のレンダリングごと落ちる）。
 */
function mergeList<T extends Record<string, unknown>>(
  template: T,
  raw: unknown,
  label?: string,
): T[] {
  if (!Array.isArray(raw)) return []
  const kept = raw.filter(isObject)
  if (label && kept.length !== raw.length) {
    noteDropped(`${label}の ${raw.length - kept.length} 件は形式が正しくないため読み飛ばしました。`)
  }
  return kept.map((el) => mergeSection(template, el))
}

/**
 * 配列からオブジェクト要素だけを取り出す（mergeList と同じ順序・同じ長さ）。
 *
 * 要素ごとに「ひな型へ重ねた結果」と「元の要素」の両方が要るときに使う。
 * mergeList の戻り値を添字で元配列に引き当てると、落とされた要素の分だけずれる。
 */
function rawList(raw: unknown, label?: string): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return []
  const kept = raw.filter(isObject)
  if (label && kept.length !== raw.length) {
    noteDropped(`${label}の ${raw.length - kept.length} 件は形式が正しくないため読み飛ばしました。`)
  }
  return kept
}

/** id が無い要素に決定的な id を振る（React の key と削除操作に要る）。 */
function withIds<T extends { id: string }>(items: T[]): T[] {
  return items.map((item, i) => (item.id ? item : { ...item, id: `restored-${i + 1}` }))
}

/**
 * 読み込み中に「捨てた」「既定に戻した」ことを記録する。
 *
 * 過去 3 巡の事故はどれも「黙って既定に戻す」ことが原因だった。
 * 値が消えたこと自体は防げなくても、消えたと伝われば利用者は気づける。
 * migrateProfile が 1 回の呼び出しごとに配列を差し替えて使う。
 */
let dropNotes: string[] = []

function noteDropped(what: string): void {
  if (!dropNotes.includes(what)) dropNotes.push(what)
}

/** 配列要素のひな型。欠けたキーはここから埋める。 */
const FILE_TEMPLATE = { name: '', targetPath: '', mode: '0644', owner: 'root', content: '' }
const SNAP_TEMPLATE = { name: '', channel: '', classic: false }
const USER_TEMPLATE = {
  id: '',
  username: '',
  realname: '',
  passwordHash: '',
  sudo: 'none',
  groups: [] as string[],
  shell: '/bin/bash',
  sshAuthorizedKeys: [] as string[],
  createHome: true,
  systemAccount: false,
}
const DEPLOYMENT_TEMPLATE = {
  id: '',
  kind: 'file',
  name: '',
  targetPath: '',
  owner: 'root',
  group: 'root',
  mode: '0644',
  archiveFormat: 'tar.gz',
  postCommand: '',
  chownRecursive: false,
}
const SERVICE_TEMPLATE = {
  id: '',
  name: '',
  description: '',
  execStart: '',
  execStartPre: '',
  workingDirectory: '',
  user: 'root',
  group: 'root',
  environment: [] as string[],
  environmentFile: '',
  serviceType: 'simple',
  restart: 'on-failure',
  restartSec: 5,
  after: [] as string[],
  wantedBy: 'multi-user.target',
  enabled: true,
}
const APT_SOURCE_TEMPLATE = { id: '', name: '', source: '', key: '' }
const HOST_PRESET_TEMPLATE = {
  id: '',
  label: '',
  hostname: '',
  ipv4: '',
  gateway: '',
  nameservers: '',
  disk: '',
}

/**
 * アプリ展開の取得元。判別可能ユニオンなので mergeSection では読めない
 * （既定バリアントに無い `path` / `url` / `sha256` が落ちる）。
 */
function readDeploymentSource(raw: unknown): Record<string, unknown> {
  if (isObject(raw)) {
    const kind = raw['kind']
    if (kind === 'host-file' && typeof raw['path'] === 'string') {
      return {
        kind: 'host-file',
        path: raw['path'],
        sizeBytes: typeof raw['sizeBytes'] === 'number' ? raw['sizeBytes'] : 0,
      }
    }
    if (kind === 'url' && typeof raw['url'] === 'string') {
      return {
        kind: 'url',
        url: raw['url'],
        sha256: typeof raw['sha256'] === 'string' ? raw['sha256'] : '',
      }
    }
    if (kind === 'inline') {
      return { kind: 'inline', content: typeof raw['content'] === 'string' ? raw['content'] : '' }
    }
  }
  return { kind: 'inline', content: '' }
}

/** インストール先ディスクの選び方。判別子ごとに固有のキーを持つ。 */
function readDiskMatch(raw: unknown, fallback: unknown): unknown {
  if (!isObject(raw)) return fallback
  const kind = raw['kind']
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  if (kind === 'serial') return { kind, serial: text(raw['serial']) }
  if (kind === 'path') return { kind, path: text(raw['path']) }
  if (kind === 'model') return { kind, model: text(raw['model']) }
  if (kind === 'largest' || kind === 'smallest' || kind === 'ssd' || kind === 'any') return { kind }
  return fallback
}

/** ネットワークカードの選び方。 */
function readInterfaceSelector(raw: unknown, fallback: unknown): unknown {
  if (!isObject(raw)) return fallback
  const kind = raw['kind']
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  if (kind === 'name') return { kind, name: text(raw['name']) }
  if (kind === 'mac') return { kind, macaddress: text(raw['macaddress']) }
  if (kind === 'any') return { kind }
  return fallback
}

export interface MigrationResult {
  readonly profile: AutoinstallProfile
  /** 読み込み時に落とした/補った項目の説明（UI で知らせる） */
  readonly notes: readonly string[]
}

/**
 * 保存済み JSON をプロファイルに変換する。
 *
 * - v1（初版）には追加ユーザー・展開・サービス・GPU が無いので既定値で埋める。
 * - 未知のキーは捨てる（将来のバージョンで保存したファイルを開いた場合）。
 * - 型が合わないフィールドは既定値に戻す。
 */
export function migrateProfile(raw: unknown): MigrationResult {
  const notes: string[] = []
  dropNotes = []
  if (!isObject(raw)) {
    return { profile: createDefaultProfile(), notes: ['ファイルの中身がプロファイルではありませんでした。'] }
  }

  const savedVersion = typeof raw['profileVersion'] === 'number' ? raw['profileVersion'] : 1
  const series = UBUNTU_SERIES.includes(raw['series'] as UbuntuSeries)
    ? (raw['series'] as UbuntuSeries)
    : undefined
  if (raw['series'] !== undefined && series === undefined) {
    notes.push(`対応していない Ubuntu バージョン (${String(raw['series'])}) だったため既定に戻しました。`)
  }

  const base = createDefaultProfile(series ?? '24.04')
  const meta = isObject(raw['meta']) ? raw['meta'] : {}
  const merged: {
    -readonly [K in keyof AutoinstallProfile]: AutoinstallProfile[K]
  } = {
    ...base,
    profileVersion: 4,
    meta: {
      name: str(meta['name'], base.meta.name),
      createdAt: str(meta['createdAt'], base.meta.createdAt),
      toolVersion: str(meta['toolVersion'], base.meta.toolVersion),
    },
    series: series ?? base.series,
    basics: mergeSection(base.basics, raw['basics']),
    user: {
      ...mergeSection(base.user, raw['user']),
      groups: readGroups(isObject(raw['user']) ? raw['user']['groups'] : undefined, base.user.groups),
    },
    ssh: mergeSection(base.ssh, raw['ssh']),
    // union 型なので mergeSection ではなく mode を見て採否を決める
    network: readNetwork(base.network, raw['network']),
    storage: readStorage(base.storage, raw['storage']),
    software: {
      ...mergeSection(base.software, raw['software']),
      // 既定が {mode:'default'} なので mergeSection では中身が落ちる
      kernel: readKernel(
        isObject(raw['software']) ? raw['software']['kernel'] : undefined,
        base.software.kernel,
      ),
      updates: oneOf(
        isObject(raw['software']) ? raw['software']['updates'] : undefined,
        ['security', 'all'] as const,
        base.software.updates,
        '更新の範囲 (software.updates)',
      ),
      // snaps もレコードの配列。素通しにすると `[null]` が型だけ合った状態で通り、
      // SoftwareStep の描画と buildAutoinstallObject の両方が TypeError で落ちる
      // （renderer に Error Boundary は無いので画面が白くなる）。
      snaps: mergeList(
        SNAP_TEMPLATE,
        isObject(raw['software']) ? raw['software']['snaps'] : undefined,
        'Snap',
      ) as AutoinstallProfile['software']['snaps'],
    },
    apt: {
      ...mergeSection(base.apt, raw['apt']),
      fallback: oneOf(
        isObject(raw['apt']) ? raw['apt']['fallback'] : undefined,
        ['abort', 'continue-anyway', 'offline-install'] as const,
        base.apt.fallback,
        'ミラーが使えないときの動作 (apt.fallback)',
      ),
      sources: withIds(
        mergeList(APT_SOURCE_TEMPLATE, isObject(raw['apt']) ? raw['apt']['sources'] : undefined),
      ) as AutoinstallProfile['apt']['sources'],
    },
    postInstall: readPostInstall(base.postInstall, raw['postInstall']),
    // ActiveDirectoryConfig は readonly なので mergeSection のシグネチャに合わない。
    activeDirectory: mergeSection(
      base.activeDirectory as unknown as Record<string, unknown>,
      raw['activeDirectory'],
    ) as unknown as ActiveDirectoryConfig,
    // RuntimeValuesConfig は readonly なので mergeSection のシグネチャに合わない。
    // 値の形は同じなのでキャストして通す。
    runtimeValues: {
      ...(mergeSection(
        base.runtimeValues as unknown as Record<string, unknown>,
        raw['runtimeValues'],
      ) as unknown as AutoinstallProfile['runtimeValues']),
      presets: withIds(
        mergeList(
          HOST_PRESET_TEMPLATE,
          isObject(raw['runtimeValues']) ? raw['runtimeValues']['presets'] : undefined,
        ),
      ) as AutoinstallProfile['runtimeValues']['presets'],
    },
    behavior: {
      ...mergeSection(base.behavior, raw['behavior']),
      shutdown: oneOf(
        isObject(raw['behavior']) ? raw['behavior']['shutdown'] : undefined,
        ['reboot', 'poweroff'] as const,
        base.behavior.shutdown,
        'インストール後の動作 (behavior.shutdown)',
      ),
      reporting: readReporting(
        isObject(raw['behavior']) ? raw['behavior']['reporting'] : undefined,
        base.behavior.reporting,
      ),
    },
    advanced: mergeSection(base.advanced, raw['advanced']),
  }

  if (savedVersion < 2) {
    notes.push(
      '古い形式のプロファイルを読み込みました。追加ユーザー・アプリ展開・サービス・GPU は未設定です。',
    )
  } else if (savedVersion < 3) {
    notes.push('古い形式のプロファイルを読み込みました。「実行時に決める値」は未設定です。')
  } else if (savedVersion < 4) {
    notes.push(
      '古い形式のプロファイルを読み込みました。カーネル選択・追加リポジトリ・失敗時のログ収集などは未設定です。',
    )
  }
  if (savedVersion > 4) {
    notes.push(
      '新しいバージョンのツールで保存されたプロファイルです。認識できない設定は無視しました。',
    )
  }

  // v3 以前は `storage.disableSwap: boolean` だった。`swap` に読み替える。
  const rawStorage = isObject(raw['storage']) ? raw['storage'] : {}
  if (rawStorage['disableSwap'] === true && merged.storage.mode !== 'raw') {
    merged.storage = { ...merged.storage, swap: { mode: 'none', size: '' } }
  }

  // SSH 鍵など、配列の中身が文字列であることまでは保証する
  const cleanedSsh = { ...merged.ssh, authorizedKeys: strList(merged.ssh.authorizedKeys) }
  // 読み飛ばした要素・既定に戻した設定を最後にまとめて伝える
  notes.push(...dropNotes)
  dropNotes = []
  return { profile: { ...merged, ssh: cleanedSsh }, notes }
}

/**
 * ネストした判別可能ユニオンを読む。
 *
 * `mergeSection` は「既定値にあるキー」しかコピーしないので、既定が
 * `{mode:'default'}` のようなフィールドを持たないバリアントだと、
 * 保存した `{mode:'flavor', flavor:'hwe'}` から判別子だけが残り
 * `flavor` が消える。消えた状態で生成に進むと例外になるので個別に読む。
 */
function readKernel(raw: unknown, fallback: KernelChoice): KernelChoice {
  if (!isObject(raw)) return fallback
  const mode = raw['mode']
  if (mode === 'flavor' && typeof raw['flavor'] === 'string' && raw['flavor']) {
    return { mode: 'flavor', flavor: raw['flavor'] }
  }
  if (mode === 'package' && typeof raw['package'] === 'string' && raw['package']) {
    return { mode: 'package', package: raw['package'] }
  }
  if (mode === 'default') return { mode: 'default' }
  return fallback
}

function readGroups(raw: unknown, fallback: PrimaryUserGroups): PrimaryUserGroups {
  if (!isObject(raw)) return fallback
  const mode = raw['mode']
  if (mode === 'append' || mode === 'override') {
    return { mode, groups: strList(raw['groups']) }
  }
  if (mode === 'default') return { mode: 'default' }
  return fallback
}

function readReporting(raw: unknown, fallback: ReportingTarget): ReportingTarget {
  if (!isObject(raw)) return fallback
  const kind = raw['kind']
  if (kind === 'rsyslog') return { kind, destination: str(raw['destination'], '') }
  if (kind === 'webhook') return { kind, endpoint: str(raw['endpoint'], '') }
  if (kind === 'console' || kind === 'none') return { kind }
  return fallback
}


/** インストール後の設定。レコードの配列は要素ごとにひな型へ重ねる。 */
function readPostInstall(
  base: AutoinstallProfile['postInstall'],
  raw: unknown,
): AutoinstallProfile['postInstall'] {
  const merged = mergeSection(base as unknown as Record<string, unknown>, raw)
  const src = isObject(raw) ? raw : {}
  return {
    ...(merged as unknown as AutoinstallProfile['postInstall']),
    presets: strList(src['presets']) as AutoinstallProfile['postInstall']['presets'],
    lateCommands: strList(src['lateCommands']),
    firstBootCommands: strList(src['firstBootCommands']),
    errorCommands: strList(src['errorCommands']),
    files: mergeList(FILE_TEMPLATE, src['files'], '追加ファイル') as AutoinstallProfile['postInstall']['files'],
    additionalUsers: withIds(
      mergeList(USER_TEMPLATE, src['additionalUsers'], '追加ユーザー'),
    ) as unknown as AutoinstallProfile['postInstall']['additionalUsers'],
    // source は判別可能ユニオンなので mergeSection ではなく型別に読む。
    // **添字で引き当ててはいけない。** mergeList は `filter(isObject)` で要素を落として
    // 詰め直すので、非オブジェクトが 1 つ混ざるだけで添字が 1 つずつずれ、
    // 展開 B が展開 A の URL と SHA-256 を受け取っていた（実際に再現した）。
    // 元要素と source を同じオブジェクトから取る。
    deployments: withIds(
      rawList(src['deployments'], 'アプリ展開').map((el) => ({
        ...mergeSection(DEPLOYMENT_TEMPLATE, el),
        source: readDeploymentSource(el['source']),
      })),
    ) as unknown as AutoinstallProfile['postInstall']['deployments'],
    services: withIds(
      mergeList(SERVICE_TEMPLATE, src['services'], 'サービス'),
    ) as unknown as AutoinstallProfile['postInstall']['services'],
  }
}

/** ディスク設定。mode ごとに形が違い、match はさらにネストしたユニオン。 */
function readStorage(
  base: AutoinstallProfile['storage'],
  raw: unknown,
): AutoinstallProfile['storage'] {
  if (!isObject(raw)) return base
  const mode = raw['mode']
  if (mode === 'raw') {
    return { mode: 'raw', yaml: typeof raw['yaml'] === 'string' ? raw['yaml'] : '' }
  }
  if (mode !== 'lvm' && mode !== 'direct' && mode !== 'zfs') {
    // mode が読めないからといって match まで既定に戻してはいけない。
    // `{kind:'serial'}` が黙って `{kind:'largest'}` に落ちると、複数ディスク機で
    // 意図と違うディスクを消す（このツールで最も破壊的な失敗・落とし穴 22）。
    // mode は既定に戻すが、指定されていた match は読めた形のまま残す。
    if (mode !== undefined) {
      noteDropped(
        `ディスクの構成方法 (${String(mode)}) を認識できなかったため既定に戻しました。` +
          '対象ディスクの指定は残してあります。書き込む前に確認してください。',
      )
    }
    if (base.mode === 'raw') return base
    return { ...base, match: readDiskMatch(raw['match'], base.match) as typeof base.match }
  }
  const template = base.mode === 'raw' ? null : { ...base, mode }
  if (template === null) return base
  const merged = mergeSection(template as unknown as Record<string, unknown>, raw)
  return {
    ...(merged as unknown as Exclude<AutoinstallProfile['storage'], { mode: 'raw' }>),
    mode,
    partitionTable: oneOf(
      raw['partitionTable'],
      ['default', 'gpt', 'msdos'] as const,
      template.partitionTable,
      'パーティションテーブル (storage.partitionTable)',
    ),
    match: readDiskMatch(raw['match'], template.match) as Exclude<
      AutoinstallProfile['storage'],
      { mode: 'raw' }
    >['match'],
  }
}

/** ネットワーク設定。mode ごとに形が違い、target はさらにネストしたユニオン。 */
function readNetwork(
  base: AutoinstallProfile['network'],
  raw: unknown,
): AutoinstallProfile['network'] {
  if (!isObject(raw)) return base
  const mode = raw['mode']
  if (mode === 'installer-default') return { mode: 'installer-default' }
  if (mode === 'raw') {
    return { mode: 'raw', yaml: typeof raw['yaml'] === 'string' ? raw['yaml'] : '' }
  }
  const template = networkTemplate(typeof mode === 'string' ? mode : '')
  if (!template || (template.mode !== 'dhcp' && template.mode !== 'static')) return base
  const merged = mergeSection(template as unknown as Record<string, unknown>, raw)
  return {
    ...(merged as unknown as Extract<
      AutoinstallProfile['network'],
      { mode: 'dhcp' | 'static' }
    >),
    target: readInterfaceSelector(raw['target'], template.target) as Extract<
      AutoinstallProfile['network'],
      { mode: 'dhcp' }
    >['target'],
  }
}

/** そのモードの既定値。古いプロファイルに無いキーを埋めるのに使う。 */
function networkTemplate(mode: string): AutoinstallProfile['network'] | undefined {
  switch (mode) {
    case 'installer-default':
      return { mode: 'installer-default' }
    case 'dhcp':
      return { mode: 'dhcp', target: { kind: 'any' }, optional: true }
    case 'static':
      return {
        mode: 'static',
        target: { kind: 'any' },
        address: '',
        gateway: '',
        nameservers: [],
        searchDomains: [],
        optional: false,
      }
    case 'raw':
      return { mode: 'raw', yaml: '' }
    default:
      return undefined
  }
}


/** プロファイル一覧に出すための要約。 */
export interface ProfileSummary {
  readonly id: string
  readonly name: string
  readonly updatedAt: string
  readonly series: UbuntuSeries
  readonly hostname: string
  readonly username: string
  /** 何が設定されているかのバッジ用 */
  readonly highlights: {
    readonly additionalUsers: number
    readonly deployments: number
    readonly services: number
    readonly gpu: boolean
    readonly staticIp: boolean
  }
}

export function summarizeProfile(id: string, updatedAt: string, p: AutoinstallProfile): ProfileSummary {
  return {
    id,
    name: p.meta.name,
    updatedAt,
    series: p.series,
    hostname: p.basics.hostname,
    username: p.user.username,
    highlights: {
      additionalUsers: p.postInstall.additionalUsers.length,
      deployments: p.postInstall.deployments.length,
      services: p.postInstall.services.length,
      gpu: p.software.gpu.enabled,
      staticIp: p.network.mode === 'static',
    },
  }
}

/** ファイル名に使える形へ正規化する。 */
export function slugifyProfileName(name: string): string {
  const slug = name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'profile'
}
