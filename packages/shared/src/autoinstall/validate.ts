import { parseAutoinstallYaml } from './yaml.js'
import type { AutoinstallProfile } from './model.js'
import { SERIES_FEATURES } from './model.js'
import { GenerateError, buildAutoinstallObject, collectPackages, parseOverlay } from './generate.js'
import { formatLocalized, localized } from '../i18n/index.js'
import type { LocalizedText, MsgKey, MsgParams } from '../i18n/index.js'
import { isAcceptedByChpasswd, isValidSha512CryptHash, looksLikeCryptHash } from '../crypt/validate.js'
import { getPreset } from './presets.js'
import { ARCHIVE_REQUIREMENTS } from './provisioning.js'
import { CUDA_REPO_DISTRO, cudaPackages, isValidServiceName } from './provisioning.js'
import { isDebLineSource, isPpaSource, isValidSizeSpec } from './advanced.js'
import { buildRaidPlan, isReadableDiskMatch } from './generate-raid.js'
import type { BondMember, BondMode, BondNetworkConfig, BondParameters } from './bond.js'
import {
  BOND_MODES,
  bondNeedsSwitchConfig,
  bondUsesHashPolicy,
  bondUsesLacpRate,
  isValidBondHashPolicy,
  isValidBondMiiInterval,
  isValidBondName,
} from './bond.js'
import type { RaidStorageConfig } from './raid.js'
import {
  RAID_MIN_DEVICES,
  isValidLvmName,
  isValidRaidArrayName,
  raidDiskMakesEsp,
  raidDiskUsageOf,
  raidHasRedundancy,
  raidRolePartClass,
} from './raid.js'
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

type AddIssue = (severity: IssueSeverity, field: string, key: MsgKey, params?: MsgParams) => void

/**
 * RAID + LVM の検証。`storage.mode === 'raid'` のときだけ呼ぶ。
 *
 * **手で編集された JSON でも例外を投げない**（落とし穴 23）。配列・オブジェクト・
 * 文字列の型を確かめてから触る。`migrate.ts` を通っていれば形は揃っているが、
 * このプロファイルは IPC からも来る。
 */
/**
 * 手で編集された JSON から届く「配列のはずのもの」を安全に文字列の配列にする。
 * **写しを作らない**（落とし穴 74）。以前は検証の中に局所の同名関数があった。
 */
function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function validateRaidStorage(raid: RaidStorageConfig, add: AddIssue): void {
  const F = 'storage.raid'
  const disks = Array.isArray(raid.disks) ? raid.disks : []
  const arrays = Array.isArray(raid.arrays) ? raid.arrays : []
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  // --- ディスク ---
  if (disks.length === 0) {
    add('error', `${F}.disks`, 'validate.raidNoDisks')
  } else if (disks.length === 1) {
    add('error', `${F}.disks`, 'validate.raidNeedsTwoDisks')
  }

  // 内部 ID は配列がディスクを指す唯一の手がかり。空や重複があると、
  // どのディスクを消すのかが決まらない（生成側は先に出てきたほうを採る）。
  const knownIds = new Set<string>()
  disks.forEach((d, i) => {
    const id = text(d?.id)
    if (!id || knownIds.has(id)) {
      add('error', `${F}.disks[${i}]`, 'validate.raidDiskIdInvalid', { n: i + 1 })
      return
    }
    knownIds.add(id)
  })

  disks.forEach((d, i) => {
    const m = (d?.match ?? {}) as { kind?: string } & Record<string, unknown>
    const where = `${F}.disks[${i}]`
    if (
      !isReadableDiskMatch(d?.match) ||
      (m.kind === 'serial' && !text(m['serial'])) ||
      (m.kind === 'path' && !text(m['path'])) ||
      (m.kind === 'model' && !text(m['model']))
    ) {
      add('error', where, 'validate.raidDiskMatchEmpty', { n: i + 1 })
    } else if (m.kind === 'any' || m.kind === 'largest' || m.kind === 'smallest' || m.kind === 'ssd') {
      // 「一致するディスクのうち任意の 1 台が割り当てられる」（autoinstall リファレンス）。
      // RAID では**選んだディスクが全部消える**ので、どれが選ばれるか決められない
      // 指定は台数のぶんだけ被害が大きい（落とし穴 65）。
      add('warning', where, 'validate.raidMemberMatchNotSpecific', {
        n: i + 1,
        kind: String(m.kind),
      })
    }
  })

  // **丸ごとメンバーのディスクには ESP も /boot も置けない**（切る場所が無い）。
  // 生成側は黙って作らないので、ここで矛盾だと伝える。設定は残るので
  // 「ESP を外す」か「使い方をパーティションに戻す」で解除できる（落とし穴 66）。
  disks.forEach((d, i) => {
    if (raidDiskUsageOf(d) === 'whole' && (d as { esp?: unknown } | null)?.esp === true) {
      add('error', `${F}.disks[${i}]`, 'validate.raidWholeDiskEsp', { n: i + 1 })
    }
  })

  // ESP を作るディスク。`/boot` 用の配列のメンバーかどうかとは**別の軸**。
  const espDisks = disks.filter((d) => raidDiskMakesEsp(d))
  if (disks.length > 0 && espDisks.length === 0) {
    add('error', `${F}.disks`, 'validate.raidNoBootDisk')
  } else if (espDisks.length === 1 && disks.length > 1) {
    add('info', `${F}.disks`, 'validate.raidSingleBootDisk')
  }

  // --- 配列 ---
  const bootArrays = arrays.filter((a) => a?.role === 'boot')
  const pvArrays = arrays.filter((a) => a?.role === 'lvm-pv')
  const diskById = new Map<string, (typeof disks)[number]>()
  for (const d of disks) {
    const id = text(d?.id)
    // 重複した id は先に出てきたほうを採る（`indexDisks` と同じ。検証が別途 error にする）。
    if (id && !diskById.has(id)) diskById.set(id, d)
  }
  if (arrays.length === 0) {
    add('error', `${F}.arrays`, 'validate.raidNoArrays')
  } else {
    if (pvArrays.length === 0) add('error', `${F}.arrays`, 'validate.raidNoLvmArray')
    // `/boot` は 1 か所にしかマウントできない。
    if (bootArrays.length > 1) add('error', `${F}.arrays`, 'validate.raidMultipleBootArrays')
    if (bootArrays.length === 0) {
      // 断定はしない。GRUB は mdraid1x と lvm のモジュールを持っているので
      // 「LVM on RAID の中の /boot」も読めることが多いが、
      // 一次資料 (R8) はこの組み合わせについて何も言っていない。
      add('info', `${F}.arrays`, 'validate.raidNoDedicatedBootArray')
    }
  }

  const names = new Set<string>()
  const usedByRole = new Map<string, Set<string>>()
  arrays.forEach((a, j) => {
    const where = `${F}.arrays[${j}]`
    const name = text(a?.name)
    const label = name || `#${j + 1}`
    if (!name) {
      add('error', `${where}.name`, 'validate.raidArrayNameEmpty', { n: j + 1 })
    } else if (!isValidRaidArrayName(name)) {
      add('error', `${where}.name`, 'validate.raidArrayNameInvalid', { name })
    } else if (names.has(name)) {
      add('error', `${where}.name`, 'validate.raidArrayNameDuplicated', { name })
    }
    if (name) names.add(name)

    const devices = stringList(a?.diskIds)
    const spares = stringList(a?.spareDiskIds)
    const all = [...devices, ...spares]

    const missing = all.filter((id) => !knownIds.has(id))
    if (missing.length > 0) {
      add('error', where, 'validate.raidUnknownDiskRef', { name: label, count: missing.length })
    }
    // 本体とスペアに同じディスクを入れる場合もここで拾う。
    if (new Set(all).size !== all.length) {
      add('error', where, 'validate.raidDiskDuplicatedInArray', { name: label })
    }
    // 同じパーティションを 2 つの配列が取り合うと、そのディスクにどちらの配列の
    // パーティションを作ればよいか決まらない（`/boot` 用と PV 用の 2 本に
    // 同じディスクが入るのは**正常**なので、作るパーティションの種類ごとに見る）。
    //
    // `lvm-pv` と `data` は**同じデータ用パーティション**を使うので、ここで衝突する。
    // 丸ごとメンバー (`usage: 'whole'`) はディスクそのものがメンバーなので、
    // 用途にかかわらず 2 つの配列には入れられない（`whole` という 1 つの枠で見る）。
    for (const id of new Set(all)) {
      const cls =
        raidDiskUsageOf(diskById.get(id)) === 'whole' ? 'whole' : raidRolePartClass(a?.role)
      const used = usedByRole.get(cls) ?? new Set<string>()
      if (used.has(id)) {
        add('error', where, 'validate.raidDiskInTwoArraysOfSameRole', { name: label })
      }
      used.add(id)
      usedByRole.set(cls, used)
    }

    // 最小台数は curtin のドキュメントの数字（R8 の表）。**RAID10 は 4 台から。**
    const level = a?.level
    const need = typeof level === 'string' ? RAID_MIN_DEVICES[level as keyof typeof RAID_MIN_DEVICES] : undefined
    const have = devices.filter((id: string) => knownIds.has(id)).length
    if (typeof need === 'number' && have < need) {
      add('error', where, 'validate.raidTooFewDevices', {
        name: label,
        level: String(level),
        need,
        have,
      })
    }
    if (typeof level === 'string' && RAID_MIN_DEVICES[level as keyof typeof RAID_MIN_DEVICES] !== undefined) {
      if (!raidHasRedundancy(level as keyof typeof RAID_MIN_DEVICES)) {
        add('warning', where, 'validate.raidLevel0NoRedundancy', { name: label })
        if (spares.length > 0) {
          add('warning', where, 'validate.raidSparesIgnoredForLevel0', { name: label })
        }
      }
    }

    if (a?.role === 'boot') {
      // **「ESP を作るか」と「/boot のメンバーか」は別の軸**なので、
      // 「ESP を作らないディスクが /boot 配列に入っている」こと自体は正常
      // （ESP は 1 台目だけ・/boot は 2 台のミラー、という構成がまさにそれ）。
      //
      // 危ないのは「ESP を作るディスクが 1 台もこの配列に入っていない」ほう。
      // GRUB は ESP のあるディスクから起動して /boot を読むので、
      // /boot がまったく別のディスク群にあると、そのディスクが 1 台落ちただけで
      // 起動できなくなる組み合わせになりうる。
      const hasEspMember = all.some((id) => raidDiskMakesEsp(diskById.get(id)))
      if (all.length > 0 && espDisks.length > 0 && !hasEspMember) {
        add('warning', where, 'validate.raidBootArrayWithoutEspDisk', { name: label })
      }
      // 丸ごとメンバーには /boot 用のパーティションを切れない（矛盾）。
      const wholeMembers = all.filter((id) => raidDiskUsageOf(diskById.get(id)) === 'whole')
      if (wholeMembers.length > 0) {
        add('error', where, 'validate.raidWholeDiskInBootArray', {
          name: label,
          count: wholeMembers.length,
        })
      }
    }
  })

  // --- 使われないディスク・消えるディスク・マウントしない配列 ---
  // `buildRaidPlan` と同じ計算を 2 度書かない（食い違うと「検証は通るのに
  // 生成だけ違う」が戻る）。
  const plan = buildRaidPlan(raid)
  // 作るだけでマウントしない配列。黙って作ると「作ったのに使えない」に見える
  // （落とし穴 67）。ただし意図的な構成なので **error ではなく info**。止めない。
  for (const name of plan.unmountedArrayNames) {
    add('info', `${F}.arrays`, 'validate.raidArrayNotMounted', { name })
  }
  for (const i of plan.unusedDiskIndexes) {
    add('warning', `${F}.disks[${i}]`, 'validate.raidDiskUnused', { n: i + 1 })
  }
  const wiped = disks.length - plan.unusedDiskIndexes.length
  if (wiped > 0) {
    // 危険な設定ほど強い助言を出す（落とし穴 65）。RAID は台数が増えるぶん被害も増える。
    add('warning', `${F}.disks`, 'validate.raidWipesAllMemberDisks', { count: wiped })
  }

  // --- 名前とサイズ ---
  if (!isValidLvmName(text(raid.volumeGroup))) {
    add('error', `${F}.volumeGroup`, 'validate.raidVolumeGroupNameInvalid', {
      name: text(raid.volumeGroup),
    })
  }
  if (!isValidLvmName(text(raid.rootName))) {
    add('error', `${F}.rootName`, 'validate.raidRootNameInvalid', { name: text(raid.rootName) })
  }
  // そのサイズが実際に使われるときだけ見る（使われない欄で書き込みを止めない）。
  if (espDisks.length > 0 && !isValidSizeSpec(text(raid.espSize))) {
    add('error', `${F}.espSize`, 'validate.raidSizeInvalid', {
      field: localized('validate.raidFieldEsp'),
      value: text(raid.espSize),
    })
  }
  if (bootArrays.length > 0 && !isValidSizeSpec(text(raid.bootSize))) {
    add('error', `${F}.bootSize`, 'validate.raidSizeInvalid', {
      field: localized('validate.raidFieldBoot'),
      value: text(raid.bootSize),
    })
  }
  // root は空なら「残り全部」なので、入っているときだけ見る。
  if (text(raid.rootSize) && !isValidSizeSpec(text(raid.rootSize))) {
    add('error', `${F}.rootSize`, 'validate.raidSizeInvalid', {
      field: localized('validate.raidFieldRoot'),
      value: text(raid.rootSize),
    })
  }

  // --- ブートローダ ---
  if (espDisks.length >= 2) {
    if (raid.mirrorBootloader) {
      // 「実機で確かめていない」ことを黙らない（落とし穴 72）。
      add('info', `${F}.mirrorBootloader`, 'validate.raidGrubMirrorUnverified')

      // **複製は「インストール先が使うディスク」にしか届かない。**
      // late-command は `/target` `/target/boot` `/target/boot/efi` を backing する
      // ディスクだけを対象にする（そうしないとインストーラ USB や
      // 別の OS のディスクまで書き換える。落とし穴 114）。
      // ところが「ESP を作るか」は配列メンバーかどうかと**独立した軸**なので、
      // **マウントされる FS を 1 つも支えないディスクに ESP を作る**構成が作れてしまう。
      // そのディスクの ESP は黙って skip され、
      // 「1 台目が壊れても起動する」という約束だけが残る（落とし穴 82 の軸違い）。
      const mountedRoles = new Set(['boot', 'lvm-pv'])
      const diskIdsInMountedArrays = new Set<string>()
      for (const a of arrays) {
        if (!mountedRoles.has(String(a?.role))) continue
        for (const id of [...stringList(a?.diskIds), ...stringList(a?.spareDiskIds)]) {
          diskIdsInMountedArrays.add(id)
        }
      }
      const unreachable = espDisks.filter(
        (d, i) => i > 0 && !diskIdsInMountedArrays.has(text((d as Record<string, unknown>)['id'])),
      )
      if (unreachable.length > 0) {
        add('warning', `${F}.mirrorBootloader`, 'validate.raidGrubMirrorUnreachableDisk', {
          count: unreachable.length,
        })
      }
    } else {
      add('warning', `${F}.mirrorBootloader`, 'validate.raidGrubOnlyOnFirstDisk')
    }
  }
}

/**
 * 生の YAML の中で、`macaddress` が**数として読まれてしまった**場所を集める。
 *
 * 解析側は 60 進数のタグを外してあるので（`yaml.ts`）、
 * 文字列で書かれた MAC がここに落ちてくることはもう無い。
 * 残るのは**利用者が数として書いた場合**（`macaddress: 41135085296`）で、
 * それは何の方言で読んでも誤りなので伝える。
 *
 * **YAML はアンカーで自分自身を指せる。** `ethernets: &e` / `self: *e` と書かれた
 * プロファイルで素朴な再帰が `RangeError: Maximum call stack size exceeded` になり、
 * **検証そのものが例外で抜けていた**（落とし穴 23。実際に再現して直した）。
 * 一度見たオブジェクトは辿らない。
 */
function numericKeyPaths(
  value: unknown,
  keys: ReadonlySet<string>,
  path: string,
  seen = new WeakSet<object>(),
): string[] {
  if (!value || typeof value !== 'object') return []
  if (seen.has(value as object)) return []
  seen.add(value as object)
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => numericKeyPaths(v, keys, `${path}[${i}]`, seen))
  }
  const out: string[] = []
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(k) && typeof v === 'number') {
      out.push(`${path}.${k}`)
    } else {
      out.push(...numericKeyPaths(v, keys, `${path}.${k}`, seen))
    }
  }
  return out
}

/** netplan で「文字列でなければならない」キー。 */
const NETWORK_STRING_KEYS: ReadonlySet<string> = new Set(['macaddress'])

/**
 * curtin が **udev の文字列と比較する**ディスク選択子。
 *
 * ここが数になると **どのディスクにも一致しない**。しかも書き方によっては
 * 値そのものが壊れる（実測）:
 *
 * | 書いた値 | 出力される値 |
 * |---|---|
 * | `20250101` | `20250101`（数。文字列比較に一致しない） |
 * | `0x5002538e40a1b2c3` | `5765262343422457000`（**桁が落ちている**。真値は …456515） |
 * | `0755` | `493`（八進数として読まれた） |
 * | `1e5` | `100000` |
 *
 * MAC を直したときに**同じ性質の軸がここに丸ごと残っていた**（落とし穴 82 / 83）。
 * `size` は数でも文字列でも正しいので入れない。
 */
const STORAGE_STRING_KEYS: ReadonlySet<string> = new Set(['serial', 'wwn', 'path', 'model'])

/**
 * 生の YAML を JS の値にする。**例外を投げない。**
 *
 * `toJS()` は素の YAML でも投げる:
 * エイリアスを入れ子で増やした YAML は `ReferenceError: Excessive alias count`
 * （`yaml` パッケージの資源枯渇対策）で落ちる。
 * 検証が投げると GUI は「理由の分からない空の確認画面」になる（落とし穴 23）ので、
 * ここで受け止めて `undefined` を返し、呼び出し側が指摘として伝える。
 */
function toJsSafe(doc: { toJS: () => unknown }): { ok: true; value: unknown } | { ok: false; detail: string } {
  try {
    return { ok: true, value: doc.toJS() }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 固定 IP の検査。単一 NIC (`mode: 'static'`) と bond (`addressing: 'static'`) で**共有する**。
 *
 * 指摘の `field` は両方とも `network.address` / `network.gateway` /
 * `network.nameservers`。同じ入力欄を指すので、写しを持たずに 1 か所で作る。
 *
 * `nameservers` が配列でないことがある（手で編集された JSON。落とし穴 23 / 30）ので
 * `Array.isArray` を通してから触る。以前は `.entries()` を直接呼んでいて、
 * `nameservers: null` の JSON では検証そのものが例外で抜けていた。
 */
function validateStaticAddressing(
  net: { address: string; gateway: string; nameservers: readonly string[] },
  add: AddIssue,
): void {
  if (!isValidCidr(net.address)) {
    add('error', 'network.address', 'validate.networkAddressInvalid')
  }
  if (net.gateway && !isValidIPv4(net.gateway)) {
    add('error', 'network.gateway', 'validate.networkGatewayInvalid')
  }
  if (!net.gateway) {
    add('warning', 'network.gateway', 'validate.networkGatewayMissing')
  }
  const nameservers = Array.isArray(net.nameservers) ? net.nameservers : []
  for (const [i, ns] of nameservers.entries()) {
    if (typeof ns !== 'string' || !isValidIPv4(ns)) {
      add('error', `network.nameservers[${i}]`, 'validate.networkNameserverInvalid', { n: i + 1 })
    }
  }
  if (nameservers.length === 0) {
    add('warning', 'network.nameservers', 'validate.networkNameserversMissing')
  }
}

/**
 * bond の検証。`network.mode === 'bond'` のときだけ呼ぶ。
 *
 * **手で編集された JSON でも例外を投げない**（落とし穴 23）。配列・オブジェクト・
 * 文字列の型を確かめてから触る。`migrate.ts` を通っていれば形は揃っているが、
 * このプロファイルは IPC からも来る。
 */
function validateBondNetwork(net: BondNetworkConfig, add: AddIssue): void {
  const F = 'network.bond'
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const members: readonly BondMember[] = Array.isArray(net.members) ? net.members : []

  // --- bond の名前 ---
  const name = text(net.name)
  if (!name) {
    add('error', `${F}.name`, 'validate.bondNameEmpty')
  } else if (!isValidBondName(name)) {
    add('error', `${F}.name`, 'validate.bondNameInvalid', { name })
  }

  // --- メンバー ---
  // 1 枚では束ねるものが無い。netplan は通るが、冗長化にも帯域の合算にもならない。
  if (members.length < 2) {
    add('error', `${F}.members`, 'validate.bondNeedsTwoMembers', { count: members.length })
  }

  // 「同じ NIC を 2 回」は netplan が 1 枚として扱うので、**2 枚あるつもりの
  // 冗長化が実は 1 枚**になる。判別子と値を合わせた文字列で重複を見る。
  const seen = new Set<string>()
  members.forEach((m, i) => {
    const where = `${F}.members[${i}]`
    const n = i + 1
    const sel = (m?.selector ?? {}) as { kind?: unknown } & Record<string, unknown>
    let fingerprint: string | null = null
    if (sel.kind === 'name') {
      const value = text(sel['name'])
      if (!value) {
        add('error', where, 'validate.bondMemberNameEmpty', { n })
      } else if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)) {
        add('error', where, 'validate.bondMemberNameInvalid', { n, name: value })
      } else {
        fingerprint = `name:${value}`
      }
    } else if (sel.kind === 'mac') {
      const value = text(sel['macaddress'])
      if (!MAC_RE.test(value)) {
        add('error', where, 'validate.bondMemberMacInvalid', { n })
      } else {
        fingerprint = `mac:${value.toLowerCase()}`
      }
    } else if (sel.kind === 'any') {
      // 1 つの netdef が `en*` に一致する全 NIC を拾う。どの NIC が束ねられるかは
      // 実機まで分からず、管理用に残したい NIC まで巻き込む（落とし穴 65）。
      add('warning', where, 'validate.bondMemberAny', { n })
      fingerprint = 'any'
    } else {
      // 判別子が読めない。生成側は「一致しない match」を出して netplan に止めさせる。
      add('error', where, 'validate.bondMemberUnreadable', { n })
    }
    if (fingerprint !== null) {
      if (seen.has(fingerprint)) {
        add('error', where, 'validate.bondMemberDuplicated', { n })
      }
      seen.add(fingerprint)
    }
  })

  // netplan のデバイス ID は netdef 全体で一意でなければならない。
  // メンバー名が bond 名と同じだと、`ethernets` と `bonds` に同じ ID が並ぶ。
  if (name && members.some((m) => text((m?.selector as { name?: unknown })?.name) === name)) {
    add('error', `${F}.members`, 'validate.bondMemberKeyIsBondName', { name })
  }

  // --- パラメータ ---
  const p = (net.parameters ?? {}) as Partial<BondParameters>
  const mode = (BOND_MODES as readonly string[]).includes(p.mode as string)
    ? (p.mode as BondMode)
    : null
  if (mode === null) {
    add('error', `${F}.parameters.mode`, 'validate.bondModeInvalid', { value: String(p.mode) })
  } else if (bondNeedsSwitchConfig(mode)) {
    // スイッチ側で LACP を設定していないとリンクが上がらない。
    // 「冗長化したつもりで疎通しなくなる」のは無人インストールでは致命的。
    add('info', `${F}.parameters.mode`, 'validate.bondModeNeedsSwitchConfig', { mode })
  }

  // 効かない設定を黙って捨てない（落とし穴 67）。生成側も出力しない。
  const lacpRate = text(p.lacpRate)
  if (lacpRate && mode !== null && !bondUsesLacpRate(mode)) {
    add('warning', `${F}.parameters.lacpRate`, 'validate.bondLacpRateIgnored', { mode })
  }
  const hashPolicy = text(p.transmitHashPolicy)
  if (hashPolicy && !isValidBondHashPolicy(hashPolicy)) {
    add('error', `${F}.parameters.transmitHashPolicy`, 'validate.bondHashPolicyInvalid', {
      value: hashPolicy,
    })
  } else if (hashPolicy && mode !== null && !bondUsesHashPolicy(mode)) {
    add('warning', `${F}.parameters.transmitHashPolicy`, 'validate.bondHashPolicyIgnored', { mode })
  }

  const mii = p.miiMonitorInterval
  if (typeof mii !== 'number' || !isValidBondMiiInterval(mii)) {
    add('error', `${F}.parameters.miiMonitorInterval`, 'validate.bondMiiMonitorInvalid', {
      value: String(mii),
    })
  } else if (mii === 0) {
    // 既定は 0＝監視しない。リンクが落ちても bond は気づかず、
    // 切り替わらないまま通信が止まる（R8）。
    add('warning', `${F}.parameters.miiMonitorInterval`, 'validate.bondMiiMonitorDisabled')
  }

  // --- アドレスの決め方 ---
  // 生成側は `static` 以外をすべて DHCP として扱う。知らない値を黙って
  // DHCP にすると、固定 IP のつもりのサーバーが DHCP で上がる（落とし穴 50）。
  if (net.addressing !== 'dhcp' && net.addressing !== 'static') {
    add('error', `${F}.addressing`, 'validate.bondAddressingInvalid', {
      value: String(net.addressing),
    })
  }

  // --- この構成では使われない設定（落とし穴 67） ---
  // 単一 NIC の選択は bond では意味を持たない。値は残す（bond をやめたら
  // また使えるようにする・落とし穴 66）が、効かないことは伝える。
  const targetKind = (net.target as { kind?: unknown } | undefined)?.kind
  if (targetKind === 'name' || targetKind === 'mac') {
    add('warning', 'network.target', 'validate.bondTargetIgnored')
  }
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
  } else if (!isAcceptedByChpasswd(profile.user.passwordHash)) {
    // 26.10 の subiquity は postinstall で `chpasswd --encrypted` に通し、
    // 形の崩れたハッシュはそこで拒まれてインストールの最後で失敗する（落とし穴 156）。
    // それより前のリリースでも、どんなパスワードとも一致しないのでログインできない。
    add('error', 'user.passwordHash', 'validate.passwordHashMalformed')
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
    validateStaticAddressing(profile.network, add)
  } else if (profile.network.mode === 'bond') {
    // アドレス・経路・DNS は **bond 側**に付く（R8）。固定 IP の検査は
    // 単一 NIC のときと**同じ関数**を通す（写しを持つと片方だけが直る）。
    if (profile.network.addressing === 'static') {
      validateStaticAddressing(profile.network, add)
    }
    validateBondNetwork(profile.network, add)
  } else if (profile.network.mode === 'raw') {
    const doc = parseAutoinstallYaml(profile.network.yaml)
    if (doc.errors.length > 0) {
      add('error', 'network.yaml', 'validate.networkYamlSyntax', { detail: doc.errors[0]!.message })
    } else {
      // **数として書かれた MAC は、どの方言で読んでも誤り。**
      // 文字列で書かれた MAC は解析側が 60 進数を外しているので数にならない
      // （`yaml.ts`。`00:50:56:...` を数にして誤って止めていたのを直した）。
      // ここに落ちるのは `macaddress: 41135085296` のように**数で書かれた**場合だけ。
      // 生成側は 1.1 でクォートするので、文字列でありさえすれば必ず文字列で届く。
      //
      // **`toJS()` は投げる。** エイリアスを入れ子で増やした YAML は
      // `ReferenceError: Excessive alias count` になる。投げさせない（落とし穴 23）。
      const js = toJsSafe(doc)
      if (!js.ok) {
        add('error', 'network.yaml', 'validate.networkYamlSyntax', { detail: js.detail })
      } else {
        for (const path of numericKeyPaths(js.value, NETWORK_STRING_KEYS, 'network')) {
          add('error', 'network.yaml', 'validate.networkYamlUnquotedMac', { path })
        }
      }
    }
  }

  // --- ストレージ ---
  if (profile.storage.mode === 'raw') {
    const doc = parseAutoinstallYaml(profile.storage.yaml)
    if (doc.errors.length > 0) {
      add('error', 'storage.yaml', 'validate.storageYamlSyntax', { detail: doc.errors[0]!.message })
    } else {
      // **ディスク選択子が数になると、どのディスクにも一致しない。**
      // curtin は `serial` / `wwn` / `path` / `model` を udev の**文字列**と比べる。
      // `0x5002538e40a1b2c3` は桁が落ちた数になり、`0755` は八進数 493 になる（実測）。
      // MAC を直したときに**同じ性質の軸がここに残っていた**（落とし穴 82 / 83）。
      const js = toJsSafe(doc)
      if (!js.ok) {
        add('error', 'storage.yaml', 'validate.storageYamlSyntax', { detail: js.detail })
      } else {
        for (const path of numericKeyPaths(js.value, STORAGE_STRING_KEYS, 'storage')) {
          add('error', 'storage.yaml', 'validate.storageYamlNumericSelector', { path })
        }
      }
    }
  } else {
    if (profile.storage.mode === 'zfs' && profile.storage.encryptionPassphrase) {
      add('warning', 'storage.encryptionPassphrase', 'validate.zfsEncryptionUnverified')
    }
    if (profile.storage.encryptionPassphrase && profile.storage.encryptionPassphrase.length < 8) {
      add('error', 'storage.encryptionPassphrase', 'validate.encryptionPassphraseTooShort')
    }
    // `sizing-policy` は lvm レイアウトにしか出ない（`generate.ts`）。
    // スイッチも LVM のときしか描画されないので、`{mode:'direct', useWholeDisk:true}`
    // の JSON（手で編集したもの・古いプロファイル）は
    // **件数にも要約にも出ないまま値だけが残る**。
    // 6 巡目に「モードを変えるときに消す」を入れたが、それは画面から操作したときだけ。
    // 黙って無かったことにしない（落とし穴 50 / 67）。
    if (profile.storage.useWholeDisk && profile.storage.mode !== 'lvm') {
      add('warning', 'storage.useWholeDisk', 'validate.wholeDiskRequiresLvm', {
        mode: profile.storage.mode,
      })
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
    if (profile.storage.mode === 'raid') {
      // RAID では `storage.config` を出すので `layout` は出ない。`storage.match` は
      // 画面には出たままなのに 1 バイトも使われない（配列ごとのディスク指定が使われる）。
      // 黙って無視すると「設定したのに効かない」になる（落とし穴 67）。
      add('warning', 'storage.match', 'validate.raidMatchIgnored')
      if (profile.storage.resetPartition.enabled) {
        // reset-partition は `layout` の中のキー。`config` では出力しない。
        add('warning', 'storage.resetPartition', 'validate.raidResetPartitionIgnored')
      }
      validateRaidStorage(profile.storage.raid, add)
    } else {
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
  //
  // bond はここを通さない。**bond では `target` が使われない**ので、
  // 直せないうえに効かないエラーを出すことになる（落とし穴 61 / 66）。
  // 「使われない」ことは `validateBondNetwork` が warning で伝える。
  if (profile.network.mode === 'dhcp' || profile.network.mode === 'static') {
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
  // 固定 IP でゲートウェイが無いと外に出られない＝ apt が必ず失敗する。
  // **bond でも同じ**（アドレスは bond 側に付くので、見る場所が違うだけ）。
  const staticWithoutGateway =
    (profile.network.mode === 'static' && !profile.network.gateway) ||
    (profile.network.mode === 'bond' &&
      profile.network.addressing === 'static' &&
      !profile.network.gateway)
  if ((packages.length > 0 || profile.software.snaps.length > 0 || needsNetworkPresets.length > 0) && staticWithoutGateway) {
    add('error', 'software.packages', 'validate.packagesWithoutGateway')
  }
  if (profile.software.ubuntuProToken && !/^C[1-9A-HJ-NP-Za-km-z]{23,29}$/.test(profile.software.ubuntuProToken)) {
    add('error', 'software.ubuntuProToken', 'validate.ubuntuProTokenInvalid')
  }
  if (!features.source && profile.software.sourceId === 'ubuntu-server-minimal') {
    add('warning', 'software.sourceId', 'validate.sourceKeyUnsupported', { series: profile.series })
  }
  // `search_drivers` は `source` の**中**にあるので、`source` キーごと無い
  // リリースでは一緒に落ちる。UI (`SoftwareStep`) も `features.source` で隠すため、
  // 何も言わないと「設定は残る・生成物には出ない・誰も何も言わない」になる（落とし穴 67）。
  if (!features.source && profile.software.searchDrivers !== null) {
    add(
      'warning',
      'software.searchDrivers',
      'validate.searchDriversUnsupported',
      { series: profile.series },
    )
  }
  // `codecs` / `oem` は `active-directory` と同じ `features.codecsOemAd` の中。
  // AD にだけ警告があり、この 2 つは無言だった。
  if (!features.codecsOemAd && profile.software.codecs) {
    add('warning', 'software.codecs', 'validate.codecsUnsupported', { series: profile.series })
  }
  if (!features.codecsOemAd && profile.software.oem !== 'auto') {
    add('warning', 'software.oem', 'validate.oemUnsupported', { series: profile.series })
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
    } else if (u.passwordHash && !isAcceptedByChpasswd(u.passwordHash)) {
      // 追加ユーザーは全リリースで late-commands の `chpasswd -e` を通る（落とし穴 156）
      add(
        'error',
        `${where}.passwordHash`,
        'validate.additionalUserPasswordHashMalformed',
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

  // channel の欄は `refreshInstaller` が true のときしか描画されない。
  // 無効なのに残っていると、件数にも要約にも出ないのに
  // `refresh-installer: {update: false, channel: ...}` として YAML には出る
  // （`generate.ts`）。画面から直す先が無いので、ここで伝える（落とし穴 50 / 67）。
  if (!profile.behavior.refreshInstaller && profile.behavior.refreshInstallerChannel.trim()) {
    add('warning', 'behavior.refreshInstallerChannel', 'validate.refreshChannelIgnored')
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
  if (rv.disk === 'kernel-arg' && profile.storage.mode === 'raid') {
    // 置換スクリプトは `storage.layout.match` を書き換える。RAID は `config` を出すので
    // `layout` が無く、引数を渡しても反映できない。**反映できなかったら止める**
    // （落とし穴 27）ので、そのまま作ると全台が起動直後に `exit 1` で止まる。
    add('error', 'runtimeValues.disk', 'validate.diskKernelArgWithRaidStorage')
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
    // raid には `layout.match` が無いので「シリアルで指定してください」は的外れ
    // （上の diskKernelArgWithRaidStorage が本当の理由を出している）。
    profile.storage.mode !== 'raid' &&
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
      const overlay = parseOverlay(profile.advanced.rawOverlayYaml)
      // 上書き YAML も生の netplan と同じ経路で読まれるので、
      // クォートしていない MAC は同じように数になる（落とし穴 108）。
      // 生の YAML 側と**同じ判定**を通す（写しを持つと片方だけが直る）。
      for (const path of numericKeyPaths(overlay, NETWORK_STRING_KEYS, 'overlay')) {
        add('error', 'advanced.rawOverlayYaml', 'validate.networkYamlUnquotedMac', { path })
      }
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
