import type { BondMember, BondMode, BondNetworkConfig, BondParameters } from './bond.js'
import { BOND_MODES, bondUsesHashPolicy, bondUsesLacpRate } from './bond.js'
import type { InterfaceSelector } from './model.js'

// bond の netplan を組み立てる。一次資料は `docs/research/R8-raid-and-bond.md` の 7 章。
//
// ```yaml
// network:
//   version: 2
//   ethernets:
//     eth0: {match: {name: eth0}}
//     eth1: {match: {name: eth1}}
//   bonds:
//     bond0:
//       interfaces: [eth0, eth1]
//       parameters: {mode: 802.3ad, lacp-rate: fast, mii-monitor-interval: 100}
//       addresses: [192.168.1.100/24]
//       routes: [{to: default, via: 192.168.1.1}]
//       nameservers: {addresses: [8.8.8.8]}
// ```
//
// **メンバーは `ethernets:` にも宣言が要る**（「The interfaces listed in the
// `interfaces` key must also be defined」）。**メンバー側にアドレスを付けない。**

/**
 * 読めない NIC 指定に使う match。**一致しようがない名前**を出す。
 *
 * 手で編集された JSON では `selector` が読めないことがある。そこで
 * `match` を省いたり `{}` にしたりすると「**どの NIC でもよい**」になり、
 * 意図しない NIC が bond に取り込まれる。RAID のディスク指定と同じ考え方で
 * （`UNREADABLE_DISK_MATCH_SERIAL`）、一致しない値を出して netplan 側で止める。
 */
export const UNREADABLE_MEMBER_MATCH_NAME = 'autoinstall-unreadable-nic'

/** bond 名が空のときに使う名前。検証はエラーにするが、生成は必ず形になる YAML を出す。 */
const FALLBACK_BOND_NAME = 'bond0'

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * メンバーの netplan デバイス ID の「素」。
 *
 * R8 の例は `eth0: {match: {name: eth0}}` と、**ID を実際の NIC 名にしたうえで
 * match も書いている**ので、それに倣う。MAC 指定は MAC から決定的に作る
 * （添字にすると、行を並べ替えただけで YAML が変わる）。
 */
function memberBaseKey(selector: unknown, index: number): string {
  const sel = (selector ?? {}) as Partial<Extract<InterfaceSelector, { kind: string }>> &
    Record<string, unknown>
  if (sel.kind === 'name') {
    const name = text(sel['name'])
    if (name) return name
  }
  if (sel.kind === 'mac') {
    const mac = text(sel['macaddress']).toLowerCase().replace(/[^0-9a-f]/g, '')
    if (mac) return `nic-${mac}`
  }
  if (sel.kind === 'any') return 'any-ethernet'
  return `bond-member${index + 1}`
}

/**
 * メンバーの netplan デバイス ID を全員ぶん決める。
 *
 * **キーは必ず互いに違うものにする。** 単一 NIC 用の `interfaceKeyAndMatch` は
 * MAC 指定をどれも `nic-by-mac` にするので、そのまま使うと 2 枚目が 1 枚目を
 * 上書きし、`interfaces: [nic-by-mac, nic-by-mac]` という**メンバーが 1 枚しか
 * 無い bond** が黙って出来上がる。
 * 重複そのものは検証がエラーにするが、生成側でも必ず別々の ID にする。
 * bond 自身の名前とも衝突させない（netplan の ID は netdef 全体で一意）。
 */
export function bondMemberKeys(net: BondNetworkConfig): string[] {
  const taken = new Set<string>()
  const bondName = text(net?.name)
  if (bondName) taken.add(bondName)
  const members: readonly BondMember[] = Array.isArray(net?.members) ? net.members : []
  return members.map((m, i) => {
    const base = memberBaseKey(m?.selector, i)
    let key = base
    let n = 2
    while (taken.has(key)) key = `${base}-${n++}`
    taken.add(key)
    return key
  })
}

/** メンバーの `match`。**どの NIC でもよい形にはしない**（上のコメント）。 */
function memberMatch(selector: unknown): Record<string, string> {
  const sel = (selector ?? {}) as Partial<Extract<InterfaceSelector, { kind: string }>> &
    Record<string, unknown>
  if (sel.kind === 'name') {
    const name = text(sel['name'])
    if (name) return { name }
  }
  if (sel.kind === 'mac') {
    const mac = text(sel['macaddress'])
    if (mac) return { macaddress: mac }
  }
  if (sel.kind === 'any') {
    // en* は systemd の予測可能なインターフェース名に一致する。
    // **1 つの netdef が複数の NIC に一致する**ので、どの NIC が束ねられるかは
    // 実機まで分からない。検証で警告する。
    return { name: 'en*' }
  }
  return { name: UNREADABLE_MEMBER_MATCH_NAME }
}

/**
 * `parameters`。**指定されたものだけ出す。**
 *
 * `parameters` が丸ごと欠けた JSON（手で編集したもの）が実際に届くので、
 * 触る前に型を確かめる（落とし穴 23 / 30）。
 *
 * 知らない `mode` は**そのまま出す**。既定に差し替えると、利用者が書いた
 * つもりの束ね方と違うモードで黙って組まれる。そのまま出せば netplan が
 * その場で拒否するので、間違いが必ず表に出る（検証も error にしている）。
 */
function bondParameters(net: BondNetworkConfig): Record<string, unknown> {
  const p = (net.parameters ?? {}) as Partial<BondParameters>
  const out: Record<string, unknown> = {}
  const known = typeof p.mode === 'string' && (BOND_MODES as readonly string[]).includes(p.mode)
  // mode は利用者が選んだ設定そのもの。netplan の既定 (balance-rr) と同じ値でも、
  // 「どのモードのつもりか」が YAML から読めるように必ず出す。
  if (typeof p.mode === 'string' && p.mode) out['mode'] = p.mode
  // `lacp-rate` は 802.3ad のときだけ意味を持つ。効かないモードで出すと
  // 「設定した」ように見えるだけなので出さない（効かない指定は検証が伝える）。
  const lacpRate = text(p.lacpRate)
  if (lacpRate && known && bondUsesLacpRate(p.mode as BondMode)) out['lacp-rate'] = lacpRate
  // 0 は netplan の既定（監視しない）。出しても既定と同じなので出さない。
  // 監視が無いことは検証が警告する。
  if (Number.isInteger(p.miiMonitorInterval) && (p.miiMonitorInterval as number) > 0) {
    out['mii-monitor-interval'] = p.miiMonitorInterval
  }
  const hash = text(p.transmitHashPolicy)
  if (hash && known && bondUsesHashPolicy(p.mode as BondMode)) out['transmit-hash-policy'] = hash
  return out
}

/**
 * bond の netplan（`network` キーの中身）を作る。
 *
 * 出力の並びは「読んで確かめられる」順にする:
 * `version` → `ethernets`（メンバー）→ `bonds`。
 */
export function buildBondNetplan(net: BondNetworkConfig): Record<string, unknown> {
  const members: readonly BondMember[] = Array.isArray(net.members) ? net.members : []
  const keys = bondMemberKeys(net)

  const ethernets: Record<string, unknown> = {}
  members.forEach((m, i) => {
    // **メンバー側にアドレスを付けない**（R8）。match だけを書く。
    ethernets[keys[i]!] = { match: memberMatch(m?.selector) }
  })

  const bond: Record<string, unknown> = {
    interfaces: keys,
    parameters: bondParameters(net),
  }

  // アドレス・経路・DNS は **bond 側**に付ける（R8）。
  if (net.addressing === 'static') {
    bond['dhcp4'] = false
    if (net.address) bond['addresses'] = [net.address]
    if (net.gateway) {
      // routes 形式が netplan の推奨。gateway4 は非推奨で警告が出る
      // （単一 NIC 側と同じ形にそろえる）。
      bond['routes'] = [{ to: 'default', via: net.gateway }]
    }
    const ns: Record<string, unknown> = {}
    const addresses = Array.isArray(net.nameservers) ? net.nameservers : []
    const search = Array.isArray(net.searchDomains) ? net.searchDomains : []
    if (addresses.length > 0) ns['addresses'] = [...addresses]
    if (search.length > 0) ns['search'] = [...search]
    if (Object.keys(ns).length > 0) bond['nameservers'] = ns
  } else {
    bond['dhcp4'] = true
  }
  if (net.optional) bond['optional'] = true

  return {
    version: 2,
    ethernets,
    bonds: { [text(net.name) || FALLBACK_BOND_NAME]: bond },
  }
}
