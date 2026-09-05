import {
  findPreset,
  localized,
  type AutoinstallProfile,
  type LocalizedText,
  type MsgKey,
} from '@autoinstall/shared'
import type { StepId } from '../store.js'

// サイドバーに出す「いまの設定」の 1 行要約。
//
// 折りたたんだものが何に設定されているか分からないのは、折りたたまない場合より悪い。
// だからステップごとに「いま何になっているか」を 1 行で出す。
//
// **設計上の約束が 3 つある。**
//
// 1. 訳す前の `LocalizedText` を返す。訳すのは描画するときだけ
//    （表示中に言語を切り替えたときに、この行だけ古い言語で残らないようにする）。
//    組み合わせは差し込みの入れ子で作る（`nav.summaryJoin2` 等）。
//    語順が言語で違うので、訳した文字列を連結してはいけない。
//
// 2. **「既定のまま」を専用のキーで区別する。**
//    既定のときだけ `nav.summaryDefault` で包み、中身は入れ子で差し込む
//    （「既定のまま（最大のディスク・LVM・暗号化なし）」）。
//    「既定かどうか」は**要約を作るのと同じ計算から**決める。
//    別々に判定すると、片方だけが設定の追加に追いつかず、
//    「既定のままと書いてあるのに既定ではない」が生まれる
//    （`generate-provisioning.ts` の `deploymentOwnership()` と同じ考え方）。
//
// 3. **知らない値を「既定のまま」に落とさない**（落とし穴 49 / 50）。
//    手で編集されたプロファイルは実際に届く。読めなかったところは
//    `nav.summaryUnknown` で「読み取れない」と出す。黙って既定に見せると、
//    利用者は「設定したのに反映されていない」ことに気づけない。

/** `typeof null === 'object'`（落とし穴 30）。配列も弾く。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function isFilled(value: unknown): boolean {
  return textOf(value).trim().length > 0
}

/**
 * 読めなかった値を、そのまま画面に出せる短い文字列にする。
 *
 * 文字列はそのまま（利用者が書いた値そのものを見せるのがいちばん分かりやすい）だが、
 * **長さを切る**。手で編集された JSON には何 KB の文字列でも入るので、
 * 切らないとサイドバーの 1 行がページ全体を押し広げる。
 * 差し込みは再帰しない（`interpolate` の仕様）ので、値に `{n}` と書かれていても
 * 別の差し込み値を引き出すことはできない。
 */
function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value.length === 0 ? "''" : value.slice(0, 40)
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const unknown = (value: unknown): LocalizedText =>
  localized('nav.summaryUnknown', { value: describeUnknown(value) })

// ---------------------------------------------------------------------------
// 「知らない値」の受け皿（落とし穴 49 / 50）
// ---------------------------------------------------------------------------

/**
 * 設定 1 つを「既知の形」に読む。**読めなければ既定に落とさず、`issues` に足す。**
 *
 * `mode` や `kind` のような判別子には `default:` があったのに、
 * `installDrivers === true` や `sourceId === 'ubuntu-server-minimal'` のような
 * 「片方の値だけを見る」判定は、**知らない値・型の違う値を黙って既定にしていた**。
 * `oem: 'NOPE'` も `gpu: 'yes'` も画面には「既定のまま（追加なし）」と出る。
 * 手で編集されたプロファイルは実際に届くので（落とし穴 23）、
 * 読めなかったことは必ず見えるようにする。
 *
 * **`undefined`（キーが無い）は既定として読む。** 生成側もキーが無ければ既定を出すので、
 * これは嘘にならない。嘘になるのは「値はあるのに読めない」ときだけ。
 */
interface Reader {
  /** 真偽値のはずの場所。真偽値でなければ「読み取れない」。 */
  flag(key: string, fallback: boolean): boolean
  /** 決まった値のどれかのはずの場所。どれでもなければ「読み取れない」。 */
  choice<T extends string>(key: string, allowed: readonly T[], fallback: T): T
  /** `boolean | null`（null = インストーラに任せる）のはずの場所。 */
  tristate(key: string): boolean | null
  /** 文字列のはずの場所に値が入っているか。文字列でも数でもなければ「読み取れない」。 */
  filled(key: string): boolean
  /** 配列のはずの場所の中身。配列でなければ「読み取れない」＋ 空として扱う。 */
  items(key: string): readonly unknown[]
  /** 配列のはずの場所の件数。 */
  list(key: string): number
  /** 入れ子のオブジェクト。オブジェクトでなければ「読み取れない」＋ `undefined`。 */
  nested(key: string): Reader | undefined
}

function reader(issues: LocalizedText[], raw: Record<string, unknown>): Reader {
  const fail = (value: unknown): void => {
    issues.push(unknown(value))
  }
  const self: Reader = {
    flag(key, fallback) {
      const v = raw[key]
      if (v === undefined) return fallback
      if (typeof v === 'boolean') return v
      fail(v)
      return fallback
    },
    choice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
      const v = raw[key]
      if (v === undefined) return fallback
      if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
      fail(v)
      return fallback
    },
    tristate(key) {
      const v = raw[key]
      if (v === undefined || v === null) return null
      if (typeof v === 'boolean') return v
      fail(v)
      return null
    },
    filled(key) {
      const v = raw[key]
      if (v === undefined) return false
      if (typeof v === 'string' || typeof v === 'number') return isFilled(v)
      fail(v)
      return false
    },
    items(key) {
      const v = raw[key]
      if (v === undefined) return []
      if (Array.isArray(v)) return v
      fail(v)
      return []
    },
    list(key) {
      return self.items(key).length
    },
    nested(key) {
      const v = raw[key]
      if (v === undefined) return undefined
      if (isObject(v)) return reader(issues, v)
      fail(v)
      return undefined
    },
  }
  return self
}

/**
 * 断片を 1 行につなぐ。
 *
 * 差し込みの入れ子は `MAX_NEST_DEPTH` で打ち切られるので、**再帰で畳まない**
 * （`join2(a, join2(b, join2(c, d)))` は深さが要素数に比例し、打ち切りに当たる）。
 * 4 枠までは専用のキー、それを超えたら 3 件 +「ほか N 件」にして深さ 1 に収める。
 */
function join(parts: readonly LocalizedText[]): LocalizedText | null {
  const [a, b, c, d] = parts
  if (a === undefined) return null
  if (b === undefined) return a
  if (c === undefined) return localized('nav.summaryJoin2', { a, b })
  if (d === undefined) return localized('nav.summaryJoin3', { a, b, c })
  if (parts.length === 4) return localized('nav.summaryJoin4', { a, b, c, d })
  return localized('nav.summaryJoin4', {
    a,
    b,
    c,
    d: localized('nav.summaryMore', { n: parts.length - 3 }),
  })
}

/** 既定なら `nav.summaryDefault` で包む。断片が 1 つも無いときは `fallback` を使う。 */
function present(
  parts: readonly LocalizedText[],
  changed: boolean,
  fallback: MsgKey,
): LocalizedText {
  const detail = join(parts) ?? localized(fallback)
  return changed ? detail : localized('nav.summaryDefault', { detail })
}

// ---------------------------------------------------------------------------
// 既知の値の表
// ---------------------------------------------------------------------------

type StorageDetail = Extract<AutoinstallProfile['storage'], { readonly match: unknown }>
type Software = AutoinstallProfile['software']
type Apt = AutoinstallProfile['apt']

/**
 * 列挙の値を**すべて**並べる。**足りないとコンパイルが通らない。**
 *
 * ここを手で書いた配列にすると、モデルに値が増えたときに気づけず、
 * 正しく設定された値が「読み取れない設定」として出る（今度は逆向きの嘘になる）。
 */
const allOf =
  <T extends string>() =>
  <L extends readonly T[]>(list: L & ([T] extends [L[number]] ? unknown : never)): readonly T[] =>
    list

const SWAP_MODES = allOf<StorageDetail['swap']['mode']>()([
  'installer-default',
  'none',
  'size',
] as const)
const PARTITION_TABLES = allOf<StorageDetail['partitionTable']>()([
  'default',
  'gpt',
  'msdos',
] as const)
const SOURCE_IDS = allOf<Software['sourceId']>()(['ubuntu-server', 'ubuntu-server-minimal'] as const)
const UPDATE_MODES = allOf<Software['updates']>()(['security', 'all'] as const)
const OEM_MODES = allOf<Software['oem']>()(['auto', 'yes', 'no'] as const)
const KERNEL_MODES = allOf<Software['kernel']['mode']>()(['default', 'flavor', 'package'] as const)
const APT_MODES = allOf<Apt['mode']>()(['default', 'country-mirror', 'custom'] as const)
const APT_FALLBACKS = allOf<Apt['fallback']>()([
  'abort',
  'continue-anyway',
  'offline-install',
] as const)
const REPORTING_KINDS = allOf<AutoinstallProfile['behavior']['reporting']['kind']>()([
  'console',
  'none',
  'rsyslog',
  'webhook',
] as const)

// ---------------------------------------------------------------------------
// ネットワーク
// ---------------------------------------------------------------------------

function summarizeNetwork(raw: unknown): LocalizedText {
  if (!isObject(raw)) return unknown(raw)
  switch (raw['mode']) {
    case 'installer-default':
      return localized('nav.summaryDefault', {
        detail: localized('nav.summaryNetworkInstallerDefault'),
      })
    case 'dhcp':
      return localized('nav.summaryNetworkDhcp')
    case 'static':
      return localized('nav.summaryNetworkStatic', {
        address: textOf(raw['address']).slice(0, 40) || '?',
      })
    case 'raw':
      return localized('nav.summaryNetworkRaw')
    default:
      return unknown(raw['mode'])
  }
}

// ---------------------------------------------------------------------------
// ディスク
// ---------------------------------------------------------------------------

/**
 * `DiskMatch` は判別可能ユニオン。**判別子ごとに読む**（落とし穴 22 / 29）。
 * `changed` は「既定 (`largest`) から変わっているか」。
 */
function describeDiskMatch(raw: unknown): { text: LocalizedText; changed: boolean } {
  if (!isObject(raw)) return { text: unknown(raw), changed: true }
  const kind = raw['kind']
  switch (kind) {
    case 'largest':
      return { text: localized('nav.summaryDiskLargest'), changed: false }
    case 'smallest':
      return { text: localized('nav.summaryDiskSmallest'), changed: true }
    case 'ssd':
      return { text: localized('nav.summaryDiskSsd'), changed: true }
    case 'any':
      return { text: localized('nav.summaryDiskAny'), changed: true }
    case 'path':
      return {
        text: localized('nav.summaryDiskPath', { path: textOf(raw['path']).slice(0, 40) || '?' }),
        changed: true,
      }
    case 'serial':
      return {
        text: localized('nav.summaryDiskSerial', {
          serial: textOf(raw['serial']).slice(0, 40) || '?',
        }),
        changed: true,
      }
    case 'model':
      return {
        text: localized('nav.summaryDiskModel', { model: textOf(raw['model']).slice(0, 40) || '?' }),
        changed: true,
      }
    default:
      return { text: unknown(kind), changed: true }
  }
}

function summarizeStorage(raw: unknown): LocalizedText {
  if (!isObject(raw)) return unknown(raw)
  const mode = raw['mode']
  if (mode === 'raw') return localized('nav.summaryStorageRaw')
  if (mode !== 'lvm' && mode !== 'direct' && mode !== 'zfs') return unknown(mode)

  const issues: LocalizedText[] = []
  const r = reader(issues, raw)
  const disk = describeDiskMatch(raw['match'])
  // `layout.password` も `sizing-policy` と同じく lvm レイアウトにしか出ない（`generate.ts`）。
  // 他のモードで値が残っていても YAML には出ないので、「暗号化あり」と言うのは嘘になる
  // （`validate.ts` が `encryptionRequiresLvm` を error で出して書き込みは止める）。
  // `r.filled` は先に呼ぶ — 短絡させると、読めない値を報告できなくなる。
  const hasPassphrase = r.filled('encryptionPassphrase')
  const encrypted = mode === 'lvm' && hasPassphrase
  // ディスク・構成方法・暗号化の 3 つは常に出す。ここが「どのディスクを消すか」を
  // 決める設定で、たたんだまま気づけないと事故になる（落とし穴 65）。
  const parts: LocalizedText[] = [
    disk.text,
    localized(
      mode === 'lvm'
        ? 'nav.summaryLayoutLvm'
        : mode === 'direct'
          ? 'nav.summaryLayoutDirect'
          : 'nav.summaryLayoutZfs',
    ),
    localized(encrypted ? 'nav.summaryEncryptionOn' : 'nav.summaryEncryptionOff'),
  ]
  let changed = mode !== 'lvm' || disk.changed || encrypted

  // `sizing-policy` は lvm レイアウトにしか出ない（`generate.ts`）。
  // 他のモードで出すと、要約は「ディスク全体を使う」と言うのに
  // 画面のどこにも解除する操作が無い（スイッチは LVM でしか描画されない）。
  if (mode === 'lvm' && r.flag('useWholeDisk', false)) {
    parts.push(localized('nav.summaryWholeDisk'))
    changed = true
  }
  const swap = r.nested('swap')
  if (swap && swap.choice('mode', SWAP_MODES, 'installer-default') !== 'installer-default') {
    parts.push(localized('nav.summarySwapCustom'))
    changed = true
  }
  const table = r.choice('partitionTable', PARTITION_TABLES, 'default')
  if (table !== 'default') {
    parts.push(localized('nav.summaryPartitionTable', { table }))
    changed = true
  }
  const reset = r.nested('resetPartition')
  if (reset?.flag('enabled', false)) {
    parts.push(localized('nav.summaryResetPartition'))
    changed = true
  }
  // parts は必ず 3 件以上あるので fallback には落ちない（型を満たすために渡す）。
  // 読めなかったものを先に出す（`join` は 4 枠で打ち切るので、後ろに置くと消える）。
  return present([...issues, ...parts], changed || issues.length > 0, 'nav.summaryStorageRaw')
}

// ---------------------------------------------------------------------------
// ソフトウェア（`software` + `apt`。どちらも SoftwareStep が編集する）
// ---------------------------------------------------------------------------

function summarizeSoftware(rawSoftware: unknown, rawApt: unknown): LocalizedText {
  if (!isObject(rawSoftware) || !isObject(rawApt)) {
    return unknown(isObject(rawSoftware) ? rawApt : rawSoftware)
  }
  const issues: LocalizedText[] = []
  const parts: LocalizedText[] = []
  const sw = reader(issues, rawSoftware)
  const apt = reader(issues, rawApt)

  const packages = sw.list('packages')
  if (packages > 0) parts.push(localized('nav.summaryPackages', { n: packages }))
  const snaps = sw.list('snaps')
  if (snaps > 0) parts.push(localized('nav.summarySnaps', { n: snaps }))
  if (sw.choice('sourceId', SOURCE_IDS, 'ubuntu-server') === 'ubuntu-server-minimal') {
    parts.push(localized('nav.summarySourceMinimal'))
  }
  if (sw.choice('updates', UPDATE_MODES, 'security') === 'all') {
    parts.push(localized('nav.summaryUpdatesAll'))
  }
  if (sw.flag('installDrivers', false)) parts.push(localized('nav.summaryDrivers'))
  const gpu = sw.nested('gpu')
  if (gpu?.flag('enabled', false)) parts.push(localized('nav.summaryGpuOn'))
  const kernel = sw.nested('kernel')
  if (kernel && kernel.choice('mode', KERNEL_MODES, 'default') !== 'default') {
    parts.push(localized('nav.summaryKernelCustom'))
  }
  if (sw.filled('ubuntuProToken')) parts.push(localized('nav.summaryUbuntuPro'))

  // `||` で並べると、先に真になった時点で残りを**読まない**（＝読めない値も報告しない）。
  // 全部読んでから畳む。
  const mirrorChanged = [
    apt.choice('mode', APT_MODES, 'default') !== 'default',
    apt.filled('proxy'),
    apt.flag('preserveSourcesList', false),
    apt.list('disableComponents') > 0,
    apt.choice('fallback', APT_FALLBACKS, 'abort') !== 'abort',
  ].some(Boolean)
  if (mirrorChanged) parts.push(localized('nav.summaryMirrorCustom'))
  const sources = apt.list('sources')
  if (sources > 0) parts.push(localized('nav.summaryAptSources', { n: sources }))

  // 個別に見出しを立てるほどではないが、既定ではないもの。
  // 数だけでも出さないと「既定のまま」が嘘になる。
  const others = [
    sw.flag('codecs', false),
    sw.choice('oem', OEM_MODES, 'auto') !== 'auto',
    sw.tristate('searchDrivers') !== null,
    sw.tristate('kernelCrashDumps') !== null,
  ].filter(Boolean).length
  if (others > 0) parts.push(localized('nav.summaryOther', { n: others }))

  const all = [...issues, ...parts]
  return present(all, all.length > 0, 'nav.summarySoftwareNone')
}

// ---------------------------------------------------------------------------
// インストール後（`postInstall` + `activeDirectory` + `behavior` の一部）
// ---------------------------------------------------------------------------

function summarizePostInstall(
  rawPost: unknown,
  rawAd: unknown,
  rawBehavior: unknown,
  rawAdvanced: unknown,
): LocalizedText {
  if (!isObject(rawPost)) return unknown(rawPost)
  const issues: LocalizedText[] = []
  const parts: LocalizedText[] = []
  const post = reader(issues, rawPost)
  /** セクションそのものが（`undefined` でもオブジェクトでもなく）壊れている場合。 */
  const section = (raw: unknown): Reader | undefined => {
    if (raw === undefined) return undefined
    if (isObject(raw)) return reader(issues, raw)
    issues.push(unknown(raw))
    return undefined
  }

  // **知らないプリセット ID は数に入れない。**
  // `findPreset` が読み飛ばすので、生成される YAML は既定と 1 バイトも変わらない。
  // 「よくある設定 1 件」と出すと、効いていない設定を効いていると言うことになる。
  // かといって黙って落とすのも違う（落とし穴 50）ので、読み取れないものとして出す。
  let presets = 0
  for (const id of post.items('presets')) {
    if (typeof id === 'string' && findPreset(id) !== undefined) presets += 1
    else issues.push(unknown(id))
  }
  if (presets > 0) parts.push(localized('nav.summaryPresets', { n: presets }))

  const commandLists = ['lateCommands', 'firstBootCommands', 'errorCommands'] as const
  const counted: [MsgKey, number][] = [
    ['nav.summaryFiles', post.list('files')],
    ['nav.summaryUsers', post.list('additionalUsers')],
    ['nav.summaryDeployments', post.list('deployments')],
    ['nav.summaryServices', post.list('services')],
    ['nav.summaryCommands', commandLists.reduce((sum, k) => sum + post.list(k), 0)],
  ]
  for (const [key, n] of counted) {
    if (n > 0) parts.push(localized(key, { n }))
  }

  if (post.flag('aptFullUpgrade', false)) parts.push(localized('nav.summaryFullUpgrade'))
  if (post.filled('debconfSelections')) parts.push(localized('nav.summaryDebconf'))
  // 既定が true なので、false のときだけ出す（「集めない」ほうが異常）。
  if (!post.flag('collectLogsOnError', true)) parts.push(localized('nav.summaryNoLogCollect'))
  const ad = section(rawAd)
  if (ad?.flag('enabled', false)) {
    parts.push(localized('nav.summaryActiveDirectory'))
  }
  const behaviorSection = section(rawBehavior)
  const reporting = behaviorSection?.nested('reporting')
  if (reporting && reporting.choice('kind', REPORTING_KINDS, 'console') !== 'console') {
    parts.push(localized('nav.summaryReporting'))
  }

  // **「詳しい設定」の中身も要約に入れる。**
  // 折りたたみの中は同じ画面で編集できるのに、ここが見ていなかったため
  // 「上級者向け」に 3 件の変更があっても、サイドバーは「既定のまま（何もしない）」
  // と出ていた。要約は「折りたたんでも中身が分かる」ための仕掛けなので、
  // 隠れている設定こそ数えなければ意味が無い。
  const advanced = section(rawAdvanced)
  // インストーラを最新に差し替える指定（チャンネルは本体が有効なときだけ意味を持つ）
  if (behaviorSection?.flag('refreshInstaller', false)) {
    parts.push(localized('nav.summaryRefreshInstaller'))
  }
  // **全画面で入力を待つ＝無人インストールでなくなる。** 最も影響が大きい。
  if (behaviorSection?.flag('interactiveAll', false)) {
    parts.push(localized('nav.summaryInteractiveAll'))
  }
  // 上書き YAML は autoinstall の任意のセクション（storage を含む）を差し替えられる
  if (advanced?.filled('rawOverlayYaml')) parts.push(localized('nav.summaryRawOverlay'))
  if (advanced?.filled('extraKernelArgs')) parts.push(localized('nav.summaryExtraKernelArgs'))

  const all = [...issues, ...parts]
  return present(all, all.length > 0, 'nav.summaryPostInstallNone')
}

// ---------------------------------------------------------------------------
// 実行時に決める
// ---------------------------------------------------------------------------

const RUNTIME_FIELD_LABEL: Record<string, MsgKey> = {
  hostname: 'nav.summaryRuntimeFieldHostname',
  network: 'nav.summaryRuntimeFieldNetwork',
  disk: 'nav.summaryRuntimeFieldDisk',
}

function summarizeRuntime(raw: unknown): LocalizedText {
  if (!isObject(raw)) return unknown(raw)
  const issues: LocalizedText[] = []
  const parts: LocalizedText[] = []
  const r = reader(issues, raw)

  for (const field of ['hostname', 'network', 'disk'] as const) {
    const mode = raw[field]
    const label = localized(RUNTIME_FIELD_LABEL[field]!)
    if (mode === 'fixed') continue
    if (mode === 'kernel-arg') {
      parts.push(localized('nav.summaryRuntimeKernelArg', { field: label }))
    } else if (mode === 'interactive') {
      parts.push(localized('nav.summaryRuntimeInteractive', { field: label }))
    } else {
      // 知らないモードを「固定値」に見せない。全台が同じ値を掴む事故につながる。
      issues.push(unknown(mode))
    }
  }
  const presets = r.list('presets')
  if (presets > 0) parts.push(localized('nav.summaryRuntimeHosts', { n: presets }))

  const all = [...issues, ...parts]
  return present(all, all.length > 0, 'nav.summaryRuntimeFixed')
}

// ---------------------------------------------------------------------------

/**
 * ステップの「いまの設定」を 1 行で表す。要約を出さないステップは `null`。
 *
 * `iso` / `basics` / `user` / `review` / `write` は `null`。
 * 前 3 つは**必ず設定する**ものなので「既定のまま」という概念が無く、
 * 後 2 つは設定を持たない。
 *
 * **例外を投げない。** サイドバーは Error Boundary の外にあるので、
 * ここで投げると画面全体が白くなる（落とし穴 60）。
 * 個々の読み取りはすべて `isObject` / `textOf` / `reader` を通していて
 * 投げないはずだが、想定外（getter を持つオブジェクト等）に備えて包んでおく。
 * 包みに落ちたことは `nav.summaryUnknown` で見えるようにする（黙って消さない）。
 */
export function summarizeStep(step: StepId, profile: AutoinstallProfile): LocalizedText | null {
  try {
    return summarizeStepUnguarded(step, profile)
  } catch {
    return localized('nav.summaryUnknown', { value: 'error' })
  }
}

/**
 * `summarizeStep` の中身。`switch` を網羅にしておくと、`StepId` を足したときに
 * **型エラーで気づける**（`default` を書くと黙って `null` になる）。
 */
function summarizeStepUnguarded(
  step: StepId,
  profile: AutoinstallProfile,
): LocalizedText | null {
  const p = profile as unknown
  if (!isObject(p)) return null
  switch (step) {
    case 'network':
      return summarizeNetwork(p['network'])
    case 'storage':
      return summarizeStorage(p['storage'])
    case 'software':
      return summarizeSoftware(p['software'], p['apt'])
    case 'postinstall':
      return summarizePostInstall(p['postInstall'], p['activeDirectory'], p['behavior'], p['advanced'])
    case 'runtime':
      return summarizeRuntime(p['runtimeValues'])
    case 'iso':
    case 'basics':
    case 'user':
    case 'review':
    case 'write':
      return null
  }
}
