import type { Choice } from './presets.js'
import type { DiskMatch } from './model.js'

// RAID + LVM のディスク構成。
//
// 既存の 3 モード (lvm / direct / zfs) は autoinstall の `storage.layout` を出すが、
// RAID は `storage.config`（curtin のアクション列）でしか表現できない。
// **`layout` と `config` は排他**（autoinstall リファレンス:
// "If the layout feature is used to configure the disks, the config section is not used."）。
//
// 一次資料は `docs/research/R8-raid-and-bond.md`。ここに無い構文は書かない。

/**
 * curtin の `raidlevel`。
 *
 * curtin は `1` / `raid1` / `mirror` のどれでも受けるが、**曖昧さの無い形だけ**を出す。
 * 数値で持つと YAML に `1` と出て「レベル 1」か「デバイス 1 台」か読めなくなる。
 */
export type RaidLevel = 'raid0' | 'raid1' | 'raid5' | 'raid6' | 'raid10'

export const RAID_LEVELS: readonly RaidLevel[] = ['raid0', 'raid1', 'raid5', 'raid6', 'raid10']

/**
 * レベルごとの最小デバイス数。**curtin のドキュメントの数字**（R8 の表）。
 *
 * mdadm 自体は `--level=10 --raid-devices=2` を受け付けるが、
 * **curtin が保証しているのは 4 台以上**なので、2 台の raid10 は検証で止める
 * （どうしても必要なら `mode: 'raw'`（curtin 直書き）へ逃がす）。
 */
export const RAID_MIN_DEVICES: Record<RaidLevel, number> = {
  raid0: 2,
  raid1: 2,
  raid5: 3,
  raid6: 4,
  raid10: 4,
}

/** 冗長性があるか（1 台壊れても動くか）。RAID0 だけ無い。 */
export function raidHasRedundancy(level: RaidLevel): boolean {
  return level !== 'raid0'
}

// 表示名は辞書のキーで持つ（`presets.ts` の `Choice` と同じ規約。`labelJa` の形は使わない）。
export const RAID_LEVEL_CHOICES: readonly (Choice & { readonly value: RaidLevel })[] = [
  { value: 'raid1', label: 'storage.raidLevelRaid1' },
  { value: 'raid10', label: 'storage.raidLevelRaid10' },
  { value: 'raid5', label: 'storage.raidLevelRaid5' },
  { value: 'raid6', label: 'storage.raidLevelRaid6' },
  { value: 'raid0', label: 'storage.raidLevelRaid0' },
]

/**
 * 配列の用途。
 *
 * - `boot`   … `/boot` にする（GRUB が読む。ESP は**別**で、RAID には置けない）
 * - `lvm-pv` … LVM のボリュームグループの PV にする（この上に root を切る）
 */
export type RaidArrayRole = 'boot' | 'lvm-pv'

export const RAID_ROLES: readonly RaidArrayRole[] = ['boot', 'lvm-pv']

export const RAID_ROLE_CHOICES: readonly (Choice & { readonly value: RaidArrayRole })[] = [
  { value: 'lvm-pv', label: 'storage.raidRoleLvmPv' },
  { value: 'boot', label: 'storage.raidRoleBoot' },
]

export type RaidRootFstype = 'ext4' | 'xfs'

export const RAID_ROOT_FSTYPES: readonly RaidRootFstype[] = ['ext4', 'xfs']

export const RAID_ROOT_FSTYPE_CHOICES: readonly (Choice & { readonly value: RaidRootFstype })[] = [
  { value: 'ext4', label: 'storage.raidFstypeExt4' },
  { value: 'xfs', label: 'storage.raidFstypeXfs' },
]

/**
 * RAID に使うディスク 1 台。
 *
 * `id` は**プロファイル JSON の中だけで意味を持つ内部 ID**で、
 * 配列 (`RaidArray.diskIds`) はこれを参照する。行を並べ替えても壊れないように
 * 添字ではなく id で指す（落とし穴 48）。
 * curtin に出す `disk-0` のような id は生成時に振り直す。
 */
export interface RaidDisk {
  readonly id: string
  /**
   * どのディスクか。
   *
   * **`any` / `largest` / `smallest` / `ssd` を RAID のメンバーに使うのは危険。**
   * 「アクションは書かれた順に処理され、一致するディスクのうち**任意の 1 台**が
   * 割り当てられる」（autoinstall リファレンス）ので、どのディスクが消えるかを
   * 事前に決められない。検証で強く警告する（落とし穴 65）。
   */
  readonly match: DiskMatch
  /**
   * このディスクから起動できるようにするか。
   * true なら ESP（素の FAT。**RAID には置けない**）を作る。
   */
  readonly boot: boolean
}

/** RAID 配列 1 つ。 */
export interface RaidArray {
  readonly id: string
  /** md デバイス名（`md0`）。curtin の `raid.name` にそのまま出る。 */
  readonly name: string
  readonly level: RaidLevel
  readonly role: RaidArrayRole
  /** 使うディスク（`RaidDisk.id`）。並び順がそのまま `devices` の順になる。 */
  readonly diskIds: readonly string[]
  /** ホットスペア（`RaidDisk.id`）。 */
  readonly spareDiskIds: readonly string[]
}

/**
 * RAID + LVM の構成。
 *
 * 台数は決め打ちしない。ディスクを何台でも並べ、配列ごとにレベルと
 * 使うディスクを選ぶ。台数不足は検証で止める（RAID10 は 4 台から）。
 */
export interface RaidStorageConfig {
  readonly disks: readonly RaidDisk[]
  readonly arrays: readonly RaidArray[]
  /** LVM のボリュームグループ名 */
  readonly volumeGroup: string
  /** root の論理ボリューム名 */
  readonly rootName: string
  /** root の大きさ。**空なら残り全部**（curtin の `size: -1`）。 */
  readonly rootSize: string
  readonly rootFstype: RaidRootFstype
  /** 各 boot ディスクに作る ESP の大きさ */
  readonly espSize: string
  /** `/boot` 用パーティションの大きさ（`/boot` 配列があるときだけ使う） */
  readonly bootSize: string
  /**
   * 2 台目以降の boot ディスクにも late-commands で GRUB を入れる。
   *
   * curtin の `grub_device` は 1 台にしか設定できない（curtin のドキュメント）。
   * 「どちらが壊れても起動する」はこのアプリが late-commands で補う。
   * **実機では未検証**（`generate-raid.ts` のコメントを参照）。
   */
  readonly mirrorBootloader: boolean
}

/** 何も設定していない RAID 構成。`createDefaultProfile()` が使う。 */
export function createDefaultRaidStorage(): RaidStorageConfig {
  return {
    disks: [],
    arrays: [],
    volumeGroup: 'vg0',
    rootName: 'root',
    rootSize: '',
    rootFstype: 'ext4',
    espSize: '512M',
    bootSize: '2G',
    mirrorBootloader: true,
  }
}

/** 新しいディスク行。UI が「追加」で使う。 */
export function createRaidDisk(id: string, match: DiskMatch = { kind: 'serial', serial: '' }): RaidDisk {
  return { id, match, boot: true }
}

/** 新しい配列。UI が「追加」で使う。 */
export function createRaidArray(id: string, name: string, role: RaidArrayRole): RaidArray {
  return {
    id,
    name,
    role,
    // 既定は「1 台壊れても動く」ほうにする。RAID0 を既定にすると
    // 冗長性のつもりで組んだ配列が 1 台の故障で全損する。
    level: 'raid1',
    diskIds: [],
    spareDiskIds: [],
  }
}

// ---------------------------------------------------------------------------
// 名前の検査（生成側と検証側で同じ判定を使う）
// ---------------------------------------------------------------------------

// 判定用と置換用の正規表現を共有しない（落とし穴 63）。ここは判定専用で `/g` を付けない。
const MD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/
// LVM の VG / LV 名。lvm(8) が許すのは英数字と `+ _ . -`（先頭に `-` は不可）。
const LVM_NAME_RE = /^[A-Za-z0-9+_.][A-Za-z0-9+_.-]{0,126}$/

export function isValidRaidArrayName(name: string): boolean {
  return MD_NAME_RE.test(name)
}

export function isValidLvmName(name: string): boolean {
  if (name === '.' || name === '..') return false
  return LVM_NAME_RE.test(name)
}
