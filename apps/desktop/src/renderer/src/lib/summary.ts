import {
  SERIES_FEATURES,
  UBUNTU_SERIES,
  createDefaultProfile,
  findPreset,
  localized,
  type AutoinstallProfile,
  type LocalizedText,
  type MsgKey,
  type SeriesFeatures,
  type UbuntuSeries,
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
//
// 4. **そのリリースで出力されない設定を「有効」と言わない**（`SERIES_FEATURES`）。
//    `generate.ts` は `features.source` / `features.codecsOemAd` /
//    `features.resetPartition` / `features.aptFallback` / `features.interactiveAll` /
//    `features.kernelCrashDumps` でキーごと落とす。要約がそれを見ないと、
//    22.04 で「最小構成・リセット領域あり・**全画面で入力を待つ**」と出るのに
//    生成物は既定と 1 バイトも変わらない（実際にそうなっていた）。
//    最後のものは「完全無人インストールなのに、そうでないと言う」嘘で、
//    6 巡目に直した「隠した設定が要約に出ない」のちょうど逆向きになる。
//    **黙って断片を消すのも同じ嘘**（落とし穴 50）なので、
//    落とした件数を `nav.summaryIneffective` で必ず言う。
//    「既定のまま」の判定 (`changed`) も**同じ計算から**導く
//    （別々に数えると、効かない設定だけを変えたプロファイルが
//    「既定のまま」と包まれずに出る）。

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
// 並び順（`join` は 4 枠で打ち切るので、順番が「何を見せるか」を決める）
// ---------------------------------------------------------------------------

/**
 * 断片の重み。**小さいほど先に出す。**
 *
 * `join()` は 4 枠を超えた分を「ほか N 件」に畳むので、**並び順はそのまま
 * 「どれを見せてどれを消すか」の決定**になる。ところが実際の並びは
 * コードに書いた順（＝件数ものが先、あとから足した設定が後ろ）だったため、
 * **いちばん影響の大きい設定から先に消えていた**:
 *
 *   よくある設定 1 件・ファイル 1 件・追加ユーザー 1 件・ほか 4 件
 *
 * この「ほか 4 件」の中に `interactiveAll`（＝**無人インストールでなくなる**）と
 * `rawOverlayYaml`（＝autoinstall の任意のセクションを上書きできる）が入っていた。
 * 6 巡目に直した「隠した設定が要約に出ない」が、**順番の形で残っていた**ことになる。
 *
 * 重みの決め方（大きいほうから）:
 *
 *   1. `anchor`   その画面の芯。「いま何になっているか」が分からなくなるので必ず出す
 *                 （どのディスクを消すか・誰でログインするか）
 *   2. `breaking` 無人インストールでなくなる／管理者権限やログイン手段を失う
 *   3. `rewrite`  生成される YAML や起動そのものを丸ごと変える
 *   4. `system`   インストール先の全体に効くが、出力の骨格は変えない
 *   5. `count`    件数もの。消えても「何かがある」ことは他の断片から分かる
 */
const IMPACT = {
  anchor: 1,
  breaking: 2,
  rewrite: 3,
  system: 4,
  count: 5,
} as const

/**
 * 断片のキー → 重み。**表に無いキーは 0（先頭）に置く。**
 *
 * 「知らないものを後ろに落とす」と、設定を足した人が順位を書き忘れたときに
 * **その設定だけが黙って消える**（この不具合そのものの作り方）。
 * 前に出しておけば、少なくとも画面には出る。書き忘れは
 * `summary-order.test.ts` が源を走査して落とす。
 */
export const IMPACT_RANK: Partial<Record<MsgKey, number>> = {
  // --- user: 誰でログインするか / どうやって入るか ---
  'nav.summaryUserName': IMPACT.anchor,
  'nav.summaryUserNameMissing': IMPACT.anchor,
  'nav.summarySshOn': IMPACT.anchor,
  'nav.summarySshOff': IMPACT.anchor,
  // グループの置き換えは sudo を落とせる（＝管理者でなくなる）。追加は足すだけ。
  'nav.summaryGroupsOverride': IMPACT.breaking,
  // パスワード認証を切ると、鍵が無ければ二度と入れない
  'nav.summarySshKeyOnly': IMPACT.breaking,
  'nav.summaryGroupsAppend': IMPACT.system,
  'nav.summarySudoNoPassword': IMPACT.system,
  'nav.summarySshKeys': IMPACT.count,
  'nav.summaryUsers': IMPACT.count,

  // --- storage: どのディスクを消すかが芯（落とし穴 65） ---
  'nav.summaryDiskLargest': IMPACT.anchor,
  'nav.summaryDiskSmallest': IMPACT.anchor,
  'nav.summaryDiskSsd': IMPACT.anchor,
  'nav.summaryDiskAny': IMPACT.anchor,
  'nav.summaryDiskPath': IMPACT.anchor,
  'nav.summaryDiskSerial': IMPACT.anchor,
  'nav.summaryDiskModel': IMPACT.anchor,
  'nav.summaryLayoutLvm': IMPACT.anchor,
  'nav.summaryLayoutDirect': IMPACT.anchor,
  'nav.summaryLayoutZfs': IMPACT.anchor,
  'nav.summaryEncryptionOn': IMPACT.anchor,
  'nav.summaryEncryptionOff': IMPACT.anchor,
  'nav.summaryWholeDisk': IMPACT.rewrite,
  'nav.summarySwapCustom': IMPACT.system,
  'nav.summaryPartitionTable': IMPACT.system,
  'nav.summaryResetPartition': IMPACT.system,

  // --- software ---
  'nav.summarySourceMinimal': IMPACT.rewrite,
  'nav.summaryKernelCustom': IMPACT.rewrite,
  'nav.summaryMirrorCustom': IMPACT.rewrite,
  'nav.summaryUpdatesAll': IMPACT.system,
  'nav.summaryDrivers': IMPACT.system,
  'nav.summaryGpuOn': IMPACT.system,
  'nav.summaryUbuntuPro': IMPACT.system,
  'nav.summaryPackages': IMPACT.count,
  'nav.summarySnaps': IMPACT.count,
  'nav.summaryAptSources': IMPACT.count,
  'nav.summaryOther': IMPACT.count,

  // --- postinstall ---
  'nav.summaryInteractiveAll': IMPACT.breaking,
  'nav.summaryRawOverlay': IMPACT.rewrite,
  'nav.summaryExtraKernelArgs': IMPACT.rewrite,
  'nav.summaryRefreshInstaller': IMPACT.rewrite,
  // チャンネル指定つきの差し替え（`refreshInstaller` と同じ重み。出るのはどちらか一方）
  'nav.summaryRefreshChannel': IMPACT.rewrite,
  'nav.summaryActiveDirectory': IMPACT.system,
  'nav.summaryReporting': IMPACT.system,
  'nav.summaryFullUpgrade': IMPACT.system,
  'nav.summaryDebconf': IMPACT.system,
  'nav.summaryNoLogCollect': IMPACT.system,
  'nav.summaryPresets': IMPACT.count,
  'nav.summaryFiles': IMPACT.count,
  'nav.summaryDeployments': IMPACT.count,
  'nav.summaryServices': IMPACT.count,
  'nav.summaryCommands': IMPACT.count,

  // --- runtime: 入力を待つほうが「起動メニューで選ぶ」より影響が大きい ---
  'nav.summaryRuntimeInteractive': IMPACT.breaking,
  'nav.summaryRuntimeKernelArg': IMPACT.rewrite,
  'nav.summaryRuntimeHosts': IMPACT.count,
}

/**
 * 影響の大きい順に並べ替える。**同じ重みの中は足した順**
 * （`Array#sort` は ES2019 から安定であることが仕様で保証されている）。
 *
 * 「読み取れない設定」と「このリリースでは効かない設定」は断片ではなく
 * **要約そのものの但し書き**なので、ここには通さず呼び出し側が先頭に置く。
 */
function byImpact(parts: readonly LocalizedText[]): LocalizedText[] {
  return [...parts].sort((a, b) => (IMPACT_RANK[a.key] ?? 0) - (IMPACT_RANK[b.key] ?? 0))
}

// ---------------------------------------------------------------------------
// リリースによる出し分け（`SERIES_FEATURES`）
// ---------------------------------------------------------------------------

/**
 * `series` から機能表を引く。**読めなければ `null`**（＝出し分けをしない）。
 *
 * ここで既定のリリースに落とすと、22.04 の設定を 24.04 の表で読むことになり、
 * 「効く/効かない」の判定そのものが嘘になる。分からないときは
 * **出し分けをやめて全部そのまま出し、読めなかったことを言う**
 * （落とし穴 49 / 50）。`migrateProfile` は知らない series を `notes` で伝えつつ
 * 24.04 に寄せるので、ここに来るのは主に手で書き換えられた直後の値。
 */
interface SeriesInfo {
  /** そのリリースの機能表。`series` が読めなければ `null`。 */
  readonly features: SeriesFeatures | null
  /** `series` が読めなかったときに出す断片。読めていれば `null`。 */
  readonly issue: LocalizedText | null
}

function readSeries(raw: unknown): SeriesInfo {
  if (typeof raw === 'string' && (UBUNTU_SERIES as readonly string[]).includes(raw)) {
    return { features: SERIES_FEATURES[raw as UbuntuSeries], issue: null }
  }
  return { features: null, issue: unknown(raw) }
}

/**
 * 「そのリリースで実際に YAML に出る設定」だけを断片にするための箱。
 *
 * `on(supported, active)` は **設定されていて、かつこのリリースで出力される**
 * ときだけ true を返し、「設定されているのに出力されない」ものを数える。
 * 判定と件数が同じ 1 か所から出るので、**断片と `changed` が食い違わない**
 * （落とし穴 22 の「別々に数えると片方が追いつかない」を作らない）。
 *
 * `features` が `null`（series が読めない）のときは出し分けをしない。
 */
interface SeriesGate {
  on(supported: (f: SeriesFeatures) => boolean, active: boolean): boolean
  /** 設定されているのに、このリリースでは出力されないものの件数。 */
  readonly ineffective: number
}

function seriesGate(features: SeriesFeatures | null): SeriesGate {
  let ineffective = 0
  return {
    on(supported, active) {
      if (!active) return false
      if (features !== null && !supported(features)) {
        ineffective += 1
        return false
      }
      return true
    },
    get ineffective() {
      return ineffective
    },
  }
}

/**
 * 効かない設定の件数を断片にする。**0 件なら何も出さない。**
 *
 * 置く場所は「読み取れない」の直後・他の断片の前。`join` は 4 枠で打ち切るので、
 * 後ろに置くと**言うべきことから先に消える**。
 */
function ineffectiveNote(gate: SeriesGate): LocalizedText[] {
  return gate.ineffective > 0
    ? [localized('nav.summaryIneffective', { n: gate.ineffective })]
    : []
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
// 管理ユーザー（`user` + `ssh` + `postInstall.additionalUsers`）
// ---------------------------------------------------------------------------

/**
 * 既定値の出どころ。**`'ubuntu'` のような既定を書き写さない**（2 か所で数えない）。
 * ここから読むのは series によって変わらないフィールドだけ。
 */
const DEFAULTS = createDefaultProfile()

/**
 * `user` ステップの 1 行要約。
 *
 * **このステップだけ要約が `null` だった。** 折りたたみ（管理ユーザーの追加グループ）を
 * 持つのに要約が無いので、「たたんでも中身が分かる」という仕掛けがこの画面にだけ
 * 効いていなかった。引き継ぎ (§3.1) が「意図的なのか漏れなのかを決めていない」と
 * 書いていたところで、**漏れ**だった。
 * `iso` / `basics` は折りたたみを持たない（実際に読んで確かめた）ので `null` のまま。
 *
 * **何を出すか（決めた理由）**
 *
 * - `ユーザー名` と `SSH の有無` は**必ず**出す。この画面の芯は
 *   「誰でログインするか」「そもそも遠隔で入れるか」で、それが分からない要約は
 *   出しても意味が無い（storage でディスクを必ず出すのと同じ理由）。
 * - `グループ` は折りたたみの中身そのもの。`override` は sudo を落とせる
 *   （＝管理者でなくなる）ので `append` より重く扱う。
 * - `公開鍵のみ`（パスワード認証を切る）と `公開鍵 N 件`。この 2 つが
 *   「鍵が無いのにパスワード認証も切った」＝**入れない USB** の材料になる。
 *   ただし `UserStep` の `lockedOut` 判定をここに書き写すことはしない
 *   （同じことを 2 か所で数えると、片方だけが追いつかない——落とし穴 22 の親戚）。
 *   画面側の警告 (`ssh.lockedOutTitle`) が正で、ここは材料だけを出す。
 * - `追加ユーザー N 件` はここ。データは `postInstall` にあるが、
 *   **編集できるのはこの画面だけ**（`AdditionalUsersSection`）。
 *
 * **出さないもの**
 *
 * - **パスワードは平文もハッシュも出さない**（規約）。`passwordHash` が空かどうかも
 *   出さない: 入力中は 300 ms のデバウンスのあとにしかハッシュが入らないので、
 *   打っている最中に「未設定」が点滅する。未設定であることは `validate.ts` が
 *   error で言い、確認画面と書き込みボタンが止める。
 * - `realname` は表示名で、間違えても誰も困らない。1 行の枠を使う価値が無い。
 */
function summarizeUser(
  rawUser: unknown,
  rawSsh: unknown,
  rawPost: unknown,
  series: SeriesInfo,
): LocalizedText {
  if (!isObject(rawUser)) return unknown(rawUser)
  const issues: LocalizedText[] = []
  if (series.issue) issues.push(series.issue)
  const gate = seriesGate(series.features)
  const parts: LocalizedText[] = []
  const u = reader(issues, rawUser)
  /** セクションそのものが（`undefined` でもオブジェクトでもなく）壊れている場合。 */
  const section = (raw: unknown): Reader | undefined => {
    if (raw === undefined) return undefined
    if (isObject(raw)) return reader(issues, raw)
    issues.push(unknown(raw))
    return undefined
  }

  // --- 芯 1: ユーザー名 ---
  // `filled` を先に呼ぶ（短絡させると、読めない値を報告できなくなる）。
  const hasName = u.filled('username')
  const name = textOf(rawUser['username']).trim().slice(0, 40)
  parts.push(
    hasName ? localized('nav.summaryUserName', { name }) : localized('nav.summaryUserNameMissing'),
  )
  let changed = !hasName || name !== DEFAULTS.user.username

  // --- 芯 2: SSH で入れるか ---
  const ssh = section(rawSsh)
  const installServer =
    ssh?.flag('installServer', DEFAULTS.ssh.installServer) ?? DEFAULTS.ssh.installServer
  const allowPassword =
    ssh?.flag('allowPasswordAuth', DEFAULTS.ssh.allowPasswordAuth) ?? DEFAULTS.ssh.allowPasswordAuth
  const keys = ssh?.list('authorizedKeys') ?? 0
  parts.push(localized(installServer ? 'nav.summarySshOn' : 'nav.summarySshOff'))
  if (installServer !== DEFAULTS.ssh.installServer) changed = true

  // --- 折りたたみの中身: 追加グループ（判別可能ユニオン。判別子ごとに読む） ---
  // `identity.groups` は 26.04 以降だけ。`generate.ts` は
  // `features.identityGroups` が false ならキーごと出さないので、
  // 22.04 で「グループを置き換え」と言うと、起きないことを起きると言うことになる。
  const rawGroups = rawUser['groups']
  if (rawGroups !== undefined) {
    if (!isObject(rawGroups)) issues.push(unknown(rawGroups))
    else {
      const mode = rawGroups['mode']
      if (mode === 'append' || mode === 'override') {
        if (gate.on((f) => f.identityGroups, true)) {
          parts.push(
            localized(mode === 'append' ? 'nav.summaryGroupsAppend' : 'nav.summaryGroupsOverride'),
          )
        }
        changed = true
      } else if (mode !== 'default') {
        issues.push(unknown(mode))
      }
    }
  }

  // --- 残り ---
  // パスワード認証を切るのは、SSH サーバーを入れているときだけ意味がある。
  if (installServer && !allowPassword) {
    parts.push(localized('nav.summarySshKeyOnly'))
    changed = true
  } else if (!allowPassword) {
    // SSH を入れていないので YAML には出ないが、値は残っている。黙って既定に見せない。
    changed = true
  }
  if (u.flag('sudoNoPassword', DEFAULTS.user.sudoNoPassword)) {
    parts.push(localized('nav.summarySudoNoPassword'))
    changed = true
  }
  if (keys > 0) {
    parts.push(localized('nav.summarySshKeys', { n: keys }))
    changed = true
  }
  // 追加ユーザー。`postInstall` が丸ごと壊れていてもここで報告される。
  const post = section(rawPost)
  const extraUsers = post?.list('additionalUsers') ?? 0
  if (extraUsers > 0) {
    parts.push(localized('nav.summaryUsers', { n: extraUsers }))
    changed = true
  }

  // parts は必ず 2 件あるので fallback には落ちない（型を満たすために渡す）。
  return present(
    [...issues, ...ineffectiveNote(gate), ...byImpact(parts)],
    changed || issues.length > 0,
    'nav.summaryUserNameMissing',
  )
}

// ---------------------------------------------------------------------------
// ネットワーク
// ---------------------------------------------------------------------------

/**
 * `InterfaceSelector` は判別可能ユニオン。**判別子ごとに読む**（落とし穴 22 / 29）。
 *
 * 以前は `target` を**読まずに**「DHCP（NIC を指定）」と出していた。
 * `changeMode('dhcp')` が入れる既定は `{kind:'any'}`（すべての有線 LAN）なので、
 * **何も指定していないのに「指定した」と言う**嘘になっていた。
 * 読んで言うか、言わないかのどちらかにする——ここは読んで言うほうを採る
 * （どの NIC が対象かは、複数 NIC の機械では要約に出す価値がある）。
 */
function describeInterfaceTarget(raw: unknown): LocalizedText {
  if (!isObject(raw)) return unknown(raw)
  const kind = raw['kind']
  switch (kind) {
    case 'any':
      return localized('nav.summaryTargetAny')
    case 'name':
      return localized('nav.summaryTargetName', {
        name: textOf(raw['name']).slice(0, 40) || '?',
      })
    case 'mac':
      return localized('nav.summaryTargetMac', {
        mac: textOf(raw['macaddress']).slice(0, 40) || '?',
      })
    default:
      // 知らない指定を「すべての NIC」に見せない（落とし穴 49 / 50）。
      return unknown(kind)
  }
}

function summarizeNetwork(raw: unknown): LocalizedText {
  if (!isObject(raw)) return unknown(raw)
  switch (raw['mode']) {
    case 'installer-default':
      return localized('nav.summaryDefault', {
        detail: localized('nav.summaryNetworkInstallerDefault'),
      })
    case 'dhcp':
      return localized('nav.summaryNetworkDhcp', {
        target: describeInterfaceTarget(raw['target']),
      })
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

function summarizeStorage(raw: unknown, series: SeriesInfo): LocalizedText {
  if (!isObject(raw)) return unknown(raw)
  const mode = raw['mode']
  if (mode === 'raw') return localized('nav.summaryStorageRaw')
  if (mode !== 'lvm' && mode !== 'direct' && mode !== 'zfs') return unknown(mode)

  const issues: LocalizedText[] = []
  if (series.issue) issues.push(series.issue)
  const gate = seriesGate(series.features)
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
  // `reset-partition` は 22.04 の subiquity が知らない。`generate.ts` は
  // `features.resetPartition` が false ならキーごと出さないので、
  // 「リセット領域あり」と言うと、作られないものを作ると言うことになる。
  const reset = r.nested('resetPartition')
  if (gate.on((f) => f.resetPartition, reset?.flag('enabled', false) === true)) {
    parts.push(localized('nav.summaryResetPartition'))
    changed = true
  }
  // parts は必ず 3 件以上あるので fallback には落ちない（型を満たすために渡す）。
  // 読めなかったものと「効かない設定」を先に出す
  // （`join` は 4 枠で打ち切るので、後ろに置くと消える）。
  return present(
    [...issues, ...ineffectiveNote(gate), ...byImpact(parts)],
    changed || issues.length > 0,
    'nav.summaryStorageRaw',
  )
}

// ---------------------------------------------------------------------------
// ソフトウェア（`software` + `apt`。どちらも SoftwareStep が編集する）
// ---------------------------------------------------------------------------

function summarizeSoftware(
  rawSoftware: unknown,
  rawApt: unknown,
  series: SeriesInfo,
): LocalizedText {
  if (!isObject(rawSoftware) || !isObject(rawApt)) {
    return unknown(isObject(rawSoftware) ? rawApt : rawSoftware)
  }
  const issues: LocalizedText[] = []
  if (series.issue) issues.push(series.issue)
  const gate = seriesGate(series.features)
  const parts: LocalizedText[] = []
  const sw = reader(issues, rawSoftware)
  const apt = reader(issues, rawApt)

  const packages = sw.list('packages')
  if (packages > 0) parts.push(localized('nav.summaryPackages', { n: packages }))
  const snaps = sw.list('snaps')
  if (snaps > 0) parts.push(localized('nav.summarySnaps', { n: snaps }))
  // `source` キーそのものが 22.04 の autoinstall に無い（`features.source`）。
  // 最小構成の指定も `search_drivers` も、そのリリースでは 1 バイトも出力されない。
  const minimal = sw.choice('sourceId', SOURCE_IDS, 'ubuntu-server') === 'ubuntu-server-minimal'
  if (gate.on((f) => f.source, minimal)) {
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
  // 全部読んでから畳む。配列リテラルは短絡しないので `gate.on` の計数も落ちない。
  //
  // `apt.fallback` は 22.04 のスキーマに無く、`generate.ts` が出さない。
  // fallback **だけ**を変えたプロファイルでは `apt` キーごと undefined になるので、
  // ここで数に入れると「ミラー指定」という嘘になる。
  const mirrorChanged = [
    apt.choice('mode', APT_MODES, 'default') !== 'default',
    apt.filled('proxy'),
    apt.flag('preserveSourcesList', false),
    apt.list('disableComponents') > 0,
    gate.on((f) => f.aptFallback, apt.choice('fallback', APT_FALLBACKS, 'abort') !== 'abort'),
  ].some(Boolean)
  if (mirrorChanged) parts.push(localized('nav.summaryMirrorCustom'))
  const sources = apt.list('sources')
  if (sources > 0) parts.push(localized('nav.summaryAptSources', { n: sources }))

  // 個別に見出しを立てるほどではないが、既定ではないもの。
  // 数だけでも出さないと「既定のまま」が嘘になる。
  // どれもリリースで出し分けられる（`codecs` / `oem` は `features.codecsOemAd`、
  // `search_drivers` は `source` の中なので `features.source`、
  // `kernel-crash-dumps` は `features.kernelCrashDumps`）。
  const others = [
    gate.on((f) => f.codecsOemAd, sw.flag('codecs', false)),
    gate.on((f) => f.codecsOemAd, sw.choice('oem', OEM_MODES, 'auto') !== 'auto'),
    gate.on((f) => f.source, sw.tristate('searchDrivers') !== null),
    gate.on((f) => f.kernelCrashDumps, sw.tristate('kernelCrashDumps') !== null),
  ].filter(Boolean).length
  if (others > 0) parts.push(localized('nav.summaryOther', { n: others }))

  // `changed` は**効く断片と読めない値だけ**から作る。効かない設定を数に入れると、
  // 生成物が既定と 1 バイトも変わらないのに「既定のまま」と包まれなくなる。
  const all = [...issues, ...ineffectiveNote(gate), ...byImpact(parts)]
  return present(all, issues.length + parts.length > 0, 'nav.summarySoftwareNone')
}

// ---------------------------------------------------------------------------
// インストール後（`postInstall` + `activeDirectory` + `behavior` の一部）
// ---------------------------------------------------------------------------

function summarizePostInstall(
  rawPost: unknown,
  rawAd: unknown,
  rawBehavior: unknown,
  rawAdvanced: unknown,
  series: SeriesInfo,
): LocalizedText {
  if (!isObject(rawPost)) return unknown(rawPost)
  const issues: LocalizedText[] = []
  if (series.issue) issues.push(series.issue)
  const gate = seriesGate(series.features)
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

  // **`additionalUsers` はここでは数えない。**
  // データの置き場所は `postInstall` だが、**編集できるのは `user` ステップだけ**
  // （`UserStep.tsx` の `AdditionalUsersSection`）。要約は「その画面を開かなくても
  // 中身が分かる」ための仕掛けなので、**編集できる画面**の側に出さないと、
  // 「追加ユーザー 2 件」を見て開いた画面のどこにもその設定が無いことになる。
  // → `summarizeUser()` が出す。
  const commandLists = ['lateCommands', 'firstBootCommands', 'errorCommands'] as const
  const counted: [MsgKey, number][] = [
    ['nav.summaryFiles', post.list('files')],
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
  // `active-directory` は `codecs` / `oem` と同じ `features.codecsOemAd` の中。
  // 22.04 では出力されないので、「AD 参加」と言うと参加しないものを参加すると言うことになる。
  const ad = section(rawAd)
  if (gate.on((f) => f.codecsOemAd, ad?.flag('enabled', false) === true)) {
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
  // インストーラを最新に差し替える指定。**チャンネルまで要約に出す。**
  // 折りたたみの Badge（`countAdvancedChanges`）は channel を数えるのに
  // ここが見ていなかったため、「1 件変更」なのに要約は「既定のまま」だった。
  // channel は `refreshInstaller` が true のときしか画面に描画されないので、
  // 数え方（`countAdvancedChanges`）と同じ条件で読む。
  // 無効なのに channel が残っている場合は `validate.refreshChannelIgnored` が伝える。
  if (behaviorSection?.flag('refreshInstaller', false)) {
    parts.push(
      localized(
        behaviorSection.filled('refreshInstallerChannel')
          ? 'nav.summaryRefreshChannel'
          : 'nav.summaryRefreshInstaller',
      ),
    )
  }
  // **全画面で入力を待つ＝無人インストールでなくなる。** 最も影響が大きい。
  // だからこそ 22.04（`features.interactiveAll: false`）で言ってはいけない。
  // そのリリースでは `interactive-sections: ['*']` が出力されず、
  // 実際には**完全無人**なのに「全画面で入力を待つ」と出ていた。
  if (gate.on((f) => f.interactiveAll, behaviorSection?.flag('interactiveAll', false) === true)) {
    parts.push(localized('nav.summaryInteractiveAll'))
  }
  // 上書き YAML は autoinstall の任意のセクション（storage を含む）を差し替えられる
  if (advanced?.filled('rawOverlayYaml')) parts.push(localized('nav.summaryRawOverlay'))
  if (advanced?.filled('extraKernelArgs')) parts.push(localized('nav.summaryExtraKernelArgs'))

  const all = [...issues, ...ineffectiveNote(gate), ...byImpact(parts)]
  return present(all, issues.length + parts.length > 0, 'nav.summaryPostInstallNone')
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

  const all = [...issues, ...byImpact(parts)]
  return present(all, all.length > 0, 'nav.summaryRuntimeFixed')
}

// ---------------------------------------------------------------------------

/**
 * ステップの「いまの設定」を 1 行で表す。要約を出さないステップは `null`。
 *
 * `iso` / `basics` / `review` / `write` は `null`。
 * 前 2 つは**折りたたみを持たない**（画面に出ているものがすべて）ので、
 * サイドバーに写しても新しく分かることが無い。後 2 つは設定を持たない。
 *
 * **`user` は `null` ではない。** 折りたたみ（管理ユーザーの追加グループ）を
 * 持つのに要約が無く、このステップだけ仕掛けが効いていなかった（→ `summarizeUser`）。
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
  // `network` / `runtime` にはリリースで出し分けられる設定が無い
  // （`features.interactiveSections` は 4 リリースとも true）。
  const series = readSeries(p['series'])
  switch (step) {
    case 'network':
      return summarizeNetwork(p['network'])
    case 'storage':
      return summarizeStorage(p['storage'], series)
    case 'software':
      return summarizeSoftware(p['software'], p['apt'], series)
    case 'postinstall':
      return summarizePostInstall(
        p['postInstall'],
        p['activeDirectory'],
        p['behavior'],
        p['advanced'],
        series,
      )
    case 'runtime':
      return summarizeRuntime(p['runtimeValues'])
    case 'user':
      // `identity.groups` が 26.04 以降だけなので、ここも series を渡す。
      return summarizeUser(p['user'], p['ssh'], p['postInstall'], series)
    case 'iso':
    case 'basics':
    case 'review':
    case 'write':
      return null
  }
}
