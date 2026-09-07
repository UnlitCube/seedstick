// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createDefaultBondNetwork,
  createDefaultProfile,
  createTranslator,
  type BondNetworkConfig,
  type NetworkConfig,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { NetworkStep } from './NetworkStep.js'

// ---------------------------------------------------------------------------
// ネットワークの「複数の NIC を束ねる (bond)」。ここで固定するのは 6 つ。
//
//   1. 画面から bond を選べて、既定が安全側であること
//      （スイッチの設定が要らない `active-backup`、リンク監視 100 ミリ秒）
//   2. メンバーの**追加と削除が、狙った行に効く**こと。
//      消す行を間違えると、実機で片方を抜くまで気づけない（落とし穴 48 の系統）
//   3. **効かない項目を出さない**こと。`lacp-rate` は 802.3ad、
//      `transmit-hash-policy` は balance-xor / 802.3ad のときだけ
//   4. ただし**値が入っているときは出す**こと。隠すと検証の「効きません」を
//      消せなくなる（落とし穴 61 / 66）。単一 NIC の `target` も同じ
//   5. 危ない設定をその場で伝えること（`any` のメンバー・監視 0・2 枚未満・
//      802.3ad のスイッチ設定）
//   6. 手で編集された JSON（`parameters` が無い・`members` に null）でも
//      描画が落ちないこと（落とし穴 23 / 30 / 31）
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  // 画面の操作は updateProfile → regenerate を通る。regenerate は
  // window.autoinstall を触るので最低限の偽物を置く。
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = {
    generateConfig: async () => null,
  }
  useStore.setState({ locale: 'ja', profile: createDefaultProfile('24.04') })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

function render(network?: NetworkConfig): HTMLElement {
  if (network) {
    useStore.setState({ profile: { ...createDefaultProfile('24.04'), network } })
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<NetworkStep />))
  return host
}

const networkOf = (): NetworkConfig => useStore.getState().profile.network

/** bond のときだけ呼ぶ。読めない形なら失敗させる（`as` で黙って通さない）。 */
function bondOf(): BondNetworkConfig {
  const net = networkOf()
  expect(net.mode, 'bond ではない').toBe('bond')
  return net as BondNetworkConfig
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * React が張り替えた `value` のセッターを迂回して値を入れる。
 * `el.value = x` だと React の value tracker が「変化なし」と見なして
 * `onChange` を呼ばない（テストだけが静かに何も起きない）。
 */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  expect(setter, 'jsdom に value の setter が無い').toBeDefined()
  act(() => {
    setter!.call(el, value)
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    )
  })
}

/** ラベルの文言から入力欄を引く（`Field` は `<label for>`、ラジオは `<label>` が包む）。 */
function byLabel(el: HTMLElement, label: string): HTMLElement | null {
  for (const node of el.querySelectorAll('label')) {
    if (!node.textContent?.includes(label)) continue
    const forId = node.getAttribute('for')
    const target = forId ? el.querySelector(`[id="${forId}"]`) : node.querySelector('input')
    if (target) return target as HTMLElement
  }
  return null
}

/** その値の選択肢を持つ `<select>` をすべて返す（NIC の指定は行ごとに 1 つ出る）。 */
function selectsWithOption(el: HTMLElement, value: string): HTMLSelectElement[] {
  return [...el.querySelectorAll('select')].filter((s) =>
    [...s.options].some((o) => o.value === value),
  )
}

const one = (list: HTMLSelectElement[], why: string): HTMLSelectElement => {
  expect(list.length, why).toBe(1)
  return list[0]!
}

/** NIC の指定（メンバー行と、残っている `target` の欄）。 */
const interfaceSelects = (el: HTMLElement): HTMLSelectElement[] => selectsWithOption(el, 'mac')
/** 束ね方のモード。 */
const modeSelect = (el: HTMLElement): HTMLSelectElement =>
  one(selectsWithOption(el, '802.3ad'), 'モードの選択欄が 1 つでない')
/** LACP の送信間隔。効くモードか、値が入っているときだけ出る。 */
const lacpSelects = (el: HTMLElement): HTMLSelectElement[] => selectsWithOption(el, 'fast')
/** アドレスの決め方。 */
const addressingSelect = (el: HTMLElement): HTMLSelectElement =>
  one(selectsWithOption(el, 'dhcp'), 'アドレスの決め方の欄が 1 つでない')

const miiInput = (el: HTMLElement): HTMLInputElement =>
  byLabel(el, t('network.bondMiiMonitor')) as HTMLInputElement
const hashInput = (el: HTMLElement): HTMLInputElement | null =>
  byLabel(el, t('network.bondHashPolicy')) as HTMLInputElement | null

/** メンバーを 1 枚足して、名前を入れる。 */
function addMemberNamed(el: HTMLElement, name: string): void {
  const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(t('network.bondAddMember')))
  expect(add, '「ネットワークカードを追加」が無い').toBeTruthy()
  click(add!)
  const rows = interfaceSelects(el)
  const last = rows[rows.length - 1]!
  // 追加直後は「名前で指定」（既定）。名前の入力欄はその行の中にある。
  const input = last.closest('li')?.querySelector('input[placeholder="enp0s3"]')
  expect(input, `${name} の入力欄が出ていない`).toBeTruthy()
  setValue(input as HTMLInputElement, name)
}

const bondWith = (over: Partial<BondNetworkConfig> = {}): BondNetworkConfig => ({
  ...createDefaultBondNetwork(),
  ...over,
})

const twoMembers = [
  { id: 'member-1', selector: { kind: 'name' as const, name: 'eth0' } },
  { id: 'member-2', selector: { kind: 'name' as const, name: 'eth1' } },
]

// ---------------------------------------------------------------------------

describe('bond を選ぶ', () => {
  it('モードの選択肢に出ていて、選ぶと安全側の既定になる', () => {
    const el = render()
    const radio = byLabel(el, t('network.modeBond')) as HTMLInputElement
    expect(radio, 'bond の選択肢が無い').not.toBeNull()

    click(radio)
    const bond = bondOf()
    // 既定は「スイッチ側の設定が要らない」モードと、リンク監視あり。
    expect(bond.parameters.mode).toBe('active-backup')
    expect(bond.parameters.miiMonitorInterval).toBe(100)
    expect(bond.name).toBe('bond0')
    expect(bond.members).toEqual([])
  })

  it('直前のモードで選んでいた NIC を持ち込まない', () => {
    // 持ち込むと、利用者が何もしていないのに「この指定は使われません」の
    // 警告が出た状態から始まる（束ねる NIC は下で指定するので、
    // 単一 NIC の選択には意味が無い）。
    const el = render({
      mode: 'static',
      target: { kind: 'name', name: 'enp0s3' },
      address: '10.0.0.2/24',
      gateway: '10.0.0.1',
      nameservers: [],
      searchDomains: [],
      optional: false,
    })
    click(byLabel(el, t('network.modeBond')) as HTMLInputElement)
    expect(bondOf().target).toEqual({ kind: 'any' })
    expect(el.textContent).not.toContain(t('validate.bondTargetIgnored'))
  })

  it('bond にすると単一 NIC の選択が使われないことを画面に出す', () => {
    const el = render(bondWith({ members: twoMembers }))
    expect(el.textContent, '「使われません」が画面に出ていない').toContain(
      t('network.bondTargetInactive'),
    )
    // 束ねる NIC は bond の中で指定する。単一 NIC の欄（Card）は出さない。
    expect(el.textContent).not.toContain(t('network.optional'))
  })

  it('bond をやめれば元の 3 モードへ戻れる（既存の動きを変えない）', () => {
    const el = render(bondWith({ members: twoMembers }))
    click(byLabel(el, t('network.modeStatic')) as HTMLInputElement)
    expect(networkOf().mode).toBe('static')
    expect(el.querySelector('input[placeholder="192.168.1.10/24"]')).not.toBeNull()
  })
})

describe('束ねるネットワークカード', () => {
  it('追加できる。ID は行ごとに違う', () => {
    const el = render(bondWith())
    expect(interfaceSelects(el)).toHaveLength(0)

    addMemberNamed(el, 'eth0')
    addMemberNamed(el, 'eth1')

    const bond = bondOf()
    expect(bond.members.map((m) => m.selector)).toEqual([
      { kind: 'name', name: 'eth0' },
      { kind: 'name', name: 'eth1' },
    ])
    expect(
      new Set(bond.members.map((m) => m.id)).size,
      '同じ ID の行が 2 つある（React の key と削除が狂う）',
    ).toBe(2)
  })

  it('削除は押した行に効く（残る行が入れ替わらない）', () => {
    const el = render(bondWith({ members: twoMembers }))
    expect(interfaceSelects(el)).toHaveLength(2)

    const remove = [...el.querySelectorAll('button')].filter(
      (b) => b.getAttribute('aria-label') === t('network.bondRemoveMember'),
    )
    expect(remove).toHaveLength(2)
    click(remove[0]!)

    expect(bondOf().members).toEqual([
      { id: 'member-2', selector: { kind: 'name', name: 'eth1' } },
    ])
    expect(interfaceSelects(el)).toHaveLength(1)
  })

  it('2 枚未満なら、その場で理由つきに止める', () => {
    const el = render(bondWith({ members: [twoMembers[0]!] }))
    expect(el.textContent).toContain(t('validate.bondNeedsTwoMembers', { count: 1 }))

    // 2 枚になれば消える（消えない警告を残さない）
    addMemberNamed(el, 'eth1')
    expect(el.textContent).not.toContain(t('validate.bondNeedsTwoMembers', { count: 2 }))
  })

  it('「すべての有線 LAN」を選んだ行には、その行に警告を出す', () => {
    const el = render(bondWith({ members: twoMembers }))
    expect(el.textContent).not.toContain(t('validate.bondMemberAny', { n: 1 }))

    setValue(interfaceSelects(el)[1]!, 'any')
    expect(bondOf().members[1]!.selector).toEqual({ kind: 'any' })
    // 何枚目かが分かる形で出る（2 枚目を直したいのに 1 枚目の話に見えない）
    expect(el.textContent).toContain(t('validate.bondMemberAny', { n: 2 }))
    expect(el.textContent).not.toContain(t('validate.bondMemberAny', { n: 1 }))
  })

  it('MAC でも指定できる', () => {
    const el = render(bondWith({ members: twoMembers }))
    setValue(interfaceSelects(el)[0]!, 'mac')
    const input = interfaceSelects(el)[0]!
      .closest('li')
      ?.querySelector('input[placeholder="52:54:00:12:34:56"]')
    expect(input, 'MAC の入力欄が出ていない').toBeTruthy()
    setValue(input as HTMLInputElement, '52:54:00:AA:BB:CC')
    // 大文字小文字は netplan 側の一致に効くので小文字へ寄せる（単一 NIC と同じ）
    expect(bondOf().members[0]!.selector).toEqual({
      kind: 'mac',
      macaddress: '52:54:00:aa:bb:cc',
    })
  })
})

describe('束ね方（モードによる出し分け）', () => {
  it('active-backup では lacp-rate も transmit-hash-policy も出さない', () => {
    const el = render(bondWith({ members: twoMembers }))
    expect(lacpSelects(el), 'active-backup で lacp-rate が出ている').toHaveLength(0)
    expect(hashInput(el), 'active-backup で transmit-hash-policy が出ている').toBeNull()
    // スイッチ側の設定は要らないモードなので、その案内も出さない
    expect(el.textContent).not.toContain(
      t('validate.bondModeNeedsSwitchConfig', { mode: 'active-backup' }),
    )
  })

  it('802.3ad にすると両方出て、スイッチ側の設定が要ることを伝える', () => {
    const el = render(bondWith({ members: twoMembers }))
    setValue(modeSelect(el), '802.3ad')

    expect(bondOf().parameters.mode).toBe('802.3ad')
    expect(lacpSelects(el), '802.3ad なのに lacp-rate が出ない').toHaveLength(1)
    expect(hashInput(el), '802.3ad なのに transmit-hash-policy が出ない').not.toBeNull()
    expect(el.textContent).toContain(
      t('validate.bondModeNeedsSwitchConfig', { mode: '802.3ad' }),
    )

    setValue(lacpSelects(el)[0]!, 'fast')
    expect(bondOf().parameters.lacpRate).toBe('fast')
  })

  it('balance-xor では transmit-hash-policy だけ出る', () => {
    const el = render(bondWith({ members: twoMembers }))
    setValue(modeSelect(el), 'balance-xor')
    expect(lacpSelects(el), 'balance-xor で lacp-rate が出ている').toHaveLength(0)
    expect(hashInput(el)).not.toBeNull()

    setValue(hashInput(el)!, 'layer3+4')
    expect(bondOf().parameters.transmitHashPolicy).toBe('layer3+4')
  })

  it('効かないモードへ移しても、入っている値は画面に残す（消せなくしない）', () => {
    // 保存済みプロファイルを開いた状態。検証は「効きません」と言い続けるので、
    // 欄を隠すと直す先が無くなる（落とし穴 61 / 66）。
    const el = render(
      bondWith({
        members: twoMembers,
        parameters: {
          mode: 'active-backup',
          lacpRate: 'fast',
          miiMonitorInterval: 100,
          transmitHashPolicy: 'layer2',
        },
      }),
    )
    expect(lacpSelects(el), '値が入っているのに lacp-rate が消えている').toHaveLength(1)
    expect(hashInput(el), '値が入っているのに transmit-hash-policy が消えている').not.toBeNull()
    // なぜ効かないかを、その場で言う（落とし穴 67）
    expect(el.textContent).toContain(
      t('validate.bondLacpRateIgnored', { mode: 'active-backup' }),
    )
    expect(el.textContent).toContain(
      t('validate.bondHashPolicyIgnored', { mode: 'active-backup' }),
    )

    // 消せること
    setValue(lacpSelects(el)[0]!, '')
    expect(bondOf().parameters.lacpRate).toBe('')
    setValue(hashInput(el)!, '')
    expect(bondOf().parameters.transmitHashPolicy).toBe('')
    expect(el.textContent).not.toContain(
      t('validate.bondLacpRateIgnored', { mode: 'active-backup' }),
    )
  })

  it('残っている単一 NIC の指定は、bond の画面から消せる', () => {
    const el = render(
      bondWith({ members: twoMembers, target: { kind: 'name', name: 'enp0s3' } }),
    )
    expect(el.textContent).toContain(t('validate.bondTargetIgnored'))
    // メンバー 2 行 + 残っている target の 1 行（メンバーだけが `li` の中）
    const selects = interfaceSelects(el)
    expect(selects).toHaveLength(3)
    const targetSelect = selects.filter((s) => s.closest('li') === null)
    expect(targetSelect, '残っている target の欄が引けない').toHaveLength(1)

    setValue(targetSelect[0]!, 'any')
    expect(bondOf().target).toEqual({ kind: 'any' })
    expect(el.textContent).not.toContain(t('validate.bondTargetIgnored'))
    expect(interfaceSelects(el)).toHaveLength(2)
  })
})

describe('リンク監視の間隔', () => {
  it('0 なら「切り替わらない」ことを伝える', () => {
    const el = render(bondWith({ members: twoMembers }))
    expect(el.textContent).not.toContain(t('validate.bondMiiMonitorDisabled'))

    setValue(miiInput(el), '0')
    expect(bondOf().parameters.miiMonitorInterval).toBe(0)
    expect(el.textContent).toContain(t('validate.bondMiiMonitorDisabled'))
  })

  it('全部消してから打ち直せる（0 が書き戻って続きが打てなくならない）', () => {
    const el = render(bondWith({ members: twoMembers }))
    const input = miiInput(el)
    expect(input.value).toBe('100')

    setValue(input, '')
    expect(miiInput(el).value, '消した瞬間に 0 が書き戻っている（落とし穴 58 の数値版）').toBe('')

    setValue(miiInput(el), '2')
    setValue(miiInput(el), '25')
    setValue(miiInput(el), '250')
    expect(miiInput(el).value).toBe('250')
    expect(bondOf().parameters.miiMonitorInterval).toBe(250)
  })
})

describe('bond のアドレス', () => {
  it('DHCP のときは固定 IP の欄を出さない', () => {
    const el = render(bondWith({ members: twoMembers }))
    expect(addressingSelect(el).value).toBe('dhcp')
    expect(el.querySelector('input[placeholder="192.168.1.10/24"]')).toBeNull()
  })

  it('固定 IP にすると bond 側に値が入る', () => {
    const el = render(bondWith({ members: twoMembers }))
    setValue(addressingSelect(el), 'static')
    expect(bondOf().addressing).toBe('static')

    const address = el.querySelector('input[placeholder="192.168.1.10/24"]') as HTMLInputElement
    expect(address, '固定 IP の入力欄が出ない').not.toBeNull()
    setValue(address, '192.168.1.100/24')
    setValue(el.querySelector('input[placeholder="192.168.1.1"]') as HTMLInputElement, '192.168.1.1')
    expect(bondOf()).toMatchObject({ address: '192.168.1.100/24', gateway: '192.168.1.1' })

    // 区切り文字を打っても消えない（下書きを通している。落とし穴 58）
    const dns = el.querySelector('input[placeholder="1.1.1.1, 8.8.8.8"]') as HTMLInputElement
    setValue(dns, '1.1.1.1,')
    expect(dns.value).toBe('1.1.1.1,')
    setValue(dns, '1.1.1.1,8.8.8.8')
    expect(bondOf().nameservers).toEqual(['1.1.1.1', '8.8.8.8'])
  })

  it('DHCP に戻しても入力した固定 IP は消さない（黙って捨てない。落とし穴 50）', () => {
    const el = render(
      bondWith({ members: twoMembers, addressing: 'static', address: '10.0.0.5/24' }),
    )
    setValue(addressingSelect(el), 'dhcp')
    expect(bondOf().address).toBe('10.0.0.5/24')
  })
})

describe('手で編集されたプロファイル', () => {
  it('parameters が無くても落ちず、選び直せる', () => {
    const broken = { ...createDefaultBondNetwork(), members: twoMembers } as Record<string, unknown>
    delete broken.parameters
    const el = render(broken as unknown as NetworkConfig)

    // 既定を表示するが、プロファイルの中身は触らないまま
    expect(modeSelect(el).value).toBe('active-backup')
    setValue(modeSelect(el), '802.3ad')
    expect(bondOf().parameters).toEqual({
      mode: '802.3ad',
      lacpRate: '',
      miiMonitorInterval: 100,
      transmitHashPolicy: '',
    })
  })

  it('知らないモードは黙って既定へ落とさず、そのまま出して理由を言う', () => {
    const el = render(
      bondWith({
        members: twoMembers,
        parameters: {
          mode: 'balance-tcp' as never,
          lacpRate: '',
          miiMonitorInterval: 100,
          transmitHashPolicy: '',
        },
      }),
    )
    expect(modeSelect(el).value, '選択欄の表示が実際の値と食い違っている').toBe('balance-tcp')
    expect(el.textContent).toContain(t('validate.bondModeInvalid', { value: 'balance-tcp' }))
    // 触っていない設定を書き換えていない
    expect(bondOf().parameters.mode).toBe('balance-tcp')
  })

  it('members に null が混じっていても描画が落ちない（落とし穴 31）', () => {
    const el = render(
      bondWith({ members: [null as never, twoMembers[1]!] }),
    )
    // 2 行とも描ける。読めない行は空欄（`any` に落とさない）。
    expect(interfaceSelects(el)).toHaveLength(2)
    expect(interfaceSelects(el)[0]!.value).toBe('name')

    // その行を直せば、ID の付いた行として書き戻る
    const input = interfaceSelects(el)[0]!.closest('li')?.querySelector('input[placeholder="enp0s3"]')
    setValue(input as HTMLInputElement, 'eth9')
    const first = bondOf().members[0]!
    expect(first.selector).toEqual({ kind: 'name', name: 'eth9' })
    expect(typeof first.id, 'ID を発番していない').toBe('string')
    expect(first.id).not.toBe(bondOf().members[1]!.id)
  })

  it('addressing が読めない値でも、選び直せる形で出す', () => {
    const el = render(bondWith({ members: twoMembers, addressing: 'bootp' as never }))
    expect(addressingSelect(el).value).toBe('bootp')
    expect(el.textContent).toContain(t('validate.bondAddressingInvalid', { value: 'bootp' }))
    setValue(addressingSelect(el), 'dhcp')
    expect(bondOf().addressing).toBe('dhcp')
  })
})
