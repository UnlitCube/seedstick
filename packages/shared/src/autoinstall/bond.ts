import type { Choice } from './presets.js'
import type { InterfaceSelector } from './model.js'

// NIC のボンディング（netplan の `bonds:`）。
//
// 一次資料は `docs/research/R8-raid-and-bond.md` の 7 章。**ここに無い構文は書かない。**
// R8 が明記しているのは次の 5 点で、この実装はそれ以上を仮定しない:
//   1. メンバーは `ethernets:` にも宣言が要る（メンバー側にアドレスを付けない）
//   2. `mode` の値は 7 つ（Open vSwitch 専用の 2 つは対象外）
//   3. `lacp-rate` は `802.3ad` のときだけ意味を持つ
//   4. `mii-monitor-interval` の既定は 0＝監視しない
//   5. `transmit-hash-policy` は `balance-xor` / `802.3ad` でのみ効く
//
// **`lacp-rate` と `transmit-hash-policy` の「取りうる値」は R8 に列挙が無い。**
// だから列挙型として決め打ちにしない:
//   - `lacp-rate` は R8 の例に出る `fast` と、その対になる `slow` を選択肢に置き、
//     **既定は空（出力しない）**。出力しなければ netplan の既定に従うので、
//     こちらが値を推測して書いたことにはならない。
//   - `transmit-hash-policy` は自由入力。こちらが知らない値を弾いて
//     「正しい設定が書けない」ほうが害が大きい（落とし穴 69）。
//     形だけを検証し、効かないモードでの指定は検証で伝える（落とし穴 67）。

/**
 * bond のモード。R8 が列挙している 7 つ。
 *
 * Open vSwitch 専用の `balance-tcp` / `balance-slb` は、このアプリが
 * openvswitch を構成しない以上、書いても効かないので出さない。
 */
export type BondMode =
  | 'balance-rr'
  | 'active-backup'
  | 'balance-xor'
  | 'broadcast'
  | '802.3ad'
  | 'balance-tlb'
  | 'balance-alb'

export const BOND_MODES: readonly BondMode[] = [
  'balance-rr',
  'active-backup',
  'balance-xor',
  'broadcast',
  '802.3ad',
  'balance-tlb',
  'balance-alb',
]

// 表示名は辞書のキーで持つ（`presets.ts` の `Choice` と同じ規約。`labelJa` の形は使わない）。
export const BOND_MODE_CHOICES: readonly (Choice & { readonly value: BondMode })[] = [
  { value: 'active-backup', label: 'network.bondModeActiveBackup' },
  { value: '802.3ad', label: 'network.bondMode8023ad' },
  { value: 'balance-rr', label: 'network.bondModeBalanceRr' },
  { value: 'balance-xor', label: 'network.bondModeBalanceXor' },
  { value: 'balance-tlb', label: 'network.bondModeBalanceTlb' },
  { value: 'balance-alb', label: 'network.bondModeBalanceAlb' },
  { value: 'broadcast', label: 'network.bondModeBroadcast' },
]

/** `lacp-rate` が効くモード（R8: 「802.3ad のときだけ意味を持つ」）。 */
export function bondUsesLacpRate(mode: BondMode): boolean {
  return mode === '802.3ad'
}

/** `transmit-hash-policy` が効くモード（R8: 負荷分散するモードでのみ効く）。 */
export function bondUsesHashPolicy(mode: BondMode): boolean {
  return mode === 'balance-xor' || mode === '802.3ad'
}

/**
 * スイッチ側の設定（LACP）が要るモード。
 *
 * `802.3ad` はスイッチが LACP を話さないとリンクが上がらない。
 * 「冗長化のつもりで選んだら疎通しなくなった」を防ぐため検証で知らせる。
 */
export function bondNeedsSwitchConfig(mode: BondMode): boolean {
  return mode === '802.3ad'
}

/** `lacp-rate`。空文字は「出力しない」（netplan の既定に従う）。 */
export type BondLacpRate = '' | 'fast' | 'slow'

export const BOND_LACP_RATES: readonly BondLacpRate[] = ['', 'fast', 'slow']

export const BOND_LACP_RATE_CHOICES: readonly (Choice & { readonly value: BondLacpRate })[] = [
  { value: '', label: 'network.bondLacpRateDefault' },
  { value: 'fast', label: 'network.bondLacpRateFast' },
  { value: 'slow', label: 'network.bondLacpRateSlow' },
]

/** bond にアドレスを与える方法。**アドレスは bond 側に付ける**（R8）。 */
export type BondAddressing = 'dhcp' | 'static'

export const BOND_ADDRESSINGS: readonly BondAddressing[] = ['dhcp', 'static']

export const BOND_ADDRESSING_CHOICES: readonly (Choice & { readonly value: BondAddressing })[] = [
  { value: 'dhcp', label: 'network.bondAddressingDhcp' },
  { value: 'static', label: 'network.bondAddressingStatic' },
]

/**
 * 束ねる NIC 1 枚。
 *
 * `id` は**プロファイル JSON の中だけで意味を持つ内部 ID**（React の key と
 * 削除操作に要る）。netplan に出る `ethernets` のキーは
 * `generate-bond.ts` の `bondMemberKeys()` が発番する。
 * 添字で引かない（落とし穴 48）。
 */
export interface BondMember {
  readonly id: string
  /** どの NIC か。単一 NIC の設定と同じ型を使い回す。 */
  readonly selector: InterfaceSelector
}

export interface BondParameters {
  readonly mode: BondMode
  /** `802.3ad` のときだけ効く。空なら出力しない。 */
  readonly lacpRate: BondLacpRate
  /**
   * `mii-monitor-interval`（ミリ秒）。
   *
   * **0 は「監視しない」**（netplan の既定）。0 のときは**キー自体を出力しない**
   * ——出しても既定と同じで、YAML が「監視を設定した」ように見えるだけ害がある。
   * 監視が無いとリンク断を検出できないので、検証で警告する。
   */
  readonly miiMonitorInterval: number
  /**
   * `transmit-hash-policy`。空なら出力しない。
   *
   * R8 に取りうる値の列挙が無いので**自由入力**（列挙にすると、こちらが
   * 知らない正しい値を書けなくなる）。形だけを検証する。
   */
  readonly transmitHashPolicy: string
}

/**
 * bond の設定。
 *
 * `target` / `optional` を持つのは、既存の 3 モードと**同じ narrowing で読めるようにする**ため。
 * `network.mode !== 'raw' && network.mode !== 'installer-default'` で絞ってから
 * `target` / `optional` を読むコードが `generate.ts` と `validate.ts` にあり、
 * bond がこれらを持たないと一斉に型エラーになる（`StorageConfig` に `raid` を
 * 足したときと同じ判断）。
 *
 * - `target`（単一 NIC の選択）は **bond では使われない**。
 *   dhcp / static に戻したときに選択が残っているように保持し、
 *   既定 (`any`) から変わっていれば「この構成では使われません」と伝える（落とし穴 66 / 67）。
 * - `optional` は bond 自身に付く（未接続でも起動を待たない）ので**使う**。
 */
export interface BondNetworkConfig {
  readonly mode: 'bond'
  /** bond では使わない。dhcp / static に戻したときのために保持する。 */
  readonly target: InterfaceSelector
  /** `optional: true`。bond が上がらなくても起動を待たない。 */
  readonly optional: boolean
  /** netplan に出る bond のデバイス ID（`bond0`） */
  readonly name: string
  /** 束ねる NIC。2 枚未満は bond にならない（検証で止める）。 */
  readonly members: readonly BondMember[]
  readonly parameters: BondParameters
  readonly addressing: BondAddressing
  /** CIDR 表記（`addressing: 'static'` のときだけ使う） */
  readonly address: string
  readonly gateway: string
  readonly nameservers: readonly string[]
  readonly searchDomains: readonly string[]
}

/**
 * 何も設定していない bond。
 *
 * モードの既定は `active-backup`。**スイッチ側の設定が要らない唯一の冗長モード**で、
 * 「とりあえず冗長化したい」に対して安全側に外れる。
 * netplan の既定は `balance-rr` だが、それを既定にすると
 * 「スイッチが対応していないと通信が壊れる」構成が既定になる。
 *
 * `miiMonitorInterval` の既定は 100。R8 が「実運用では 100 程度を入れる」と
 * 書いているとおりで、既定の 0（監視しない）のまま出すと
 * ケーブルが抜けても切り替わらない bond になる。
 */
export function createDefaultBondNetwork(): BondNetworkConfig {
  return {
    mode: 'bond',
    target: { kind: 'any' },
    optional: false,
    name: 'bond0',
    members: [],
    parameters: {
      mode: 'active-backup',
      lacpRate: '',
      miiMonitorInterval: 100,
      transmitHashPolicy: '',
    },
    addressing: 'dhcp',
    address: '',
    gateway: '',
    nameservers: [],
    searchDomains: [],
  }
}

/** 新しいメンバー行。UI が「追加」で使う。 */
export function createBondMember(
  id: string,
  selector: InterfaceSelector = { kind: 'name', name: '' },
): BondMember {
  return { id, selector }
}

// ---------------------------------------------------------------------------
// 形の検査（生成側と検証側で同じ判定を使う）
// ---------------------------------------------------------------------------

// 判定用と置換用の正規表現を共有しない（落とし穴 63）。ここは判定専用で `/g` を付けない。
// netplan のデバイス ID に使える形。実際のカーネルのインターフェース名になりうるので
// IFNAMSIZ (15 文字) に収める。
const BOND_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,14}$/
// `transmit-hash-policy` に出てくる形（`layer2+3` / `encap3+4` など）。
// 取りうる値は決め打ちにしない（R8 に列挙が無い）。区切りとして `+` と `-` を許す。
const HASH_POLICY_RE = /^[a-z0-9]+([+-][a-z0-9]+)*$/

export function isValidBondName(name: string): boolean {
  return BOND_NAME_RE.test(name)
}

export function isValidBondHashPolicy(value: string): boolean {
  return HASH_POLICY_RE.test(value)
}

/**
 * `mii-monitor-interval` に出せる値か。
 *
 * netplan は整数ミリ秒を取る。小数や負数、`Infinity` / `NaN` は
 * 手で編集された JSON から実際に届く（`typeof x === 'number'` は通る）。
 */
export function isValidBondMiiInterval(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 4_294_967_295
}
