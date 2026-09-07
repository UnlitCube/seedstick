import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import Ajv2020, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { createDefaultProfile } from './defaults.js'
import { buildAutoinstallObject, generateUserData } from './generate.js'
import { UNREADABLE_MEMBER_MATCH_NAME, bondMemberKeys } from './generate-bond.js'
import { migrateProfile } from './migrate.js'
import { createDefaultBondNetwork } from './bond.js'
import type { BondMember, BondNetworkConfig } from './bond.js'
import type { AutoinstallProfile, UbuntuSeries } from './model.js'
import { validateProfile } from './validate.js'
import { formatLocalized } from '../i18n/index.js'

// NIC のボンディング（netplan の `bonds:`）。
//
// 壊れると気づきにくいのは次の 3 つなので、そこを重点的に見る:
//   1. **メンバーが `ethernets:` に出ていない** → netplan が bond ごと拒否する
//   2. **メンバー側にアドレスが付く** → 2 つの NIC が別々に IP を持ち、bond にならない
//   3. **メンバーのデバイス ID が重複する** → `interfaces` が 1 枚に潰れ、
//      「2 枚あるつもりの冗長化が 1 枚」になる（実機で片方を抜くまで気づけない）

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

function member(id: string, selector: BondMember['selector']): BondMember {
  return { id, selector }
}

function bond(over: Partial<BondNetworkConfig> = {}): BondNetworkConfig {
  const base = createDefaultBondNetwork()
  return { ...base, ...over, parameters: { ...base.parameters, ...(over.parameters ?? {}) } }
}

function bondProfile(
  net: Partial<BondNetworkConfig>,
  series: UbuntuSeries = '24.04',
): AutoinstallProfile {
  const p = createDefaultProfile(series)
  return {
    ...p,
    basics: { ...p.basics, hostname: 'bondhost' },
    user: { ...p.user, passwordHash: HASH },
    network: bond(net),
  }
}

/** LACP (802.3ad) + 固定 IP。R8 の例そのままの構成。 */
const LACP_STATIC: Partial<BondNetworkConfig> = {
  members: [
    member('m1', { kind: 'name', name: 'eth0' }),
    member('m2', { kind: 'name', name: 'eth1' }),
  ],
  parameters: {
    mode: '802.3ad',
    lacpRate: 'fast',
    miiMonitorInterval: 100,
    transmitHashPolicy: 'layer3+4',
  },
  addressing: 'static',
  address: '192.168.1.100/24',
  gateway: '192.168.1.1',
  nameservers: ['8.8.8.8'],
  searchDomains: ['example.test'],
}

/** active-backup + DHCP。MAC で NIC を選ぶ。 */
const ACTIVE_BACKUP_DHCP: Partial<BondNetworkConfig> = {
  optional: true,
  members: [
    member('m1', { kind: 'mac', macaddress: '52:54:00:12:34:56' }),
    member('m2', { kind: 'mac', macaddress: '52:54:00:12:34:57' }),
  ],
}

type Netplan = {
  version?: unknown
  ethernets?: Record<string, Record<string, unknown>>
  bonds?: Record<string, Record<string, unknown>>
}

function netplanOf(profile: AutoinstallProfile): Netplan {
  const built = buildAutoinstallObject(profile, { comments: 'none' }) as Record<string, unknown>
  return built['network'] as Netplan
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

describe('bond の netplan を組み立てる', () => {
  it('LACP + 固定 IP の形を固定する', () => {
    const net = netplanOf(bondProfile(LACP_STATIC))
    expect(net).toEqual({
      version: 2,
      ethernets: {
        eth0: { match: { name: 'eth0' } },
        eth1: { match: { name: 'eth1' } },
      },
      bonds: {
        bond0: {
          interfaces: ['eth0', 'eth1'],
          parameters: {
            mode: '802.3ad',
            'lacp-rate': 'fast',
            'mii-monitor-interval': 100,
            'transmit-hash-policy': 'layer3+4',
          },
          dhcp4: false,
          addresses: ['192.168.1.100/24'],
          routes: [{ to: 'default', via: '192.168.1.1' }],
          nameservers: { addresses: ['8.8.8.8'], search: ['example.test'] },
        },
      },
    })
  })

  it('active-backup + DHCP の形を固定する', () => {
    const net = netplanOf(bondProfile(ACTIVE_BACKUP_DHCP))
    expect(net).toEqual({
      version: 2,
      ethernets: {
        'nic-525400123456': { match: { macaddress: '52:54:00:12:34:56' } },
        'nic-525400123457': { match: { macaddress: '52:54:00:12:34:57' } },
      },
      bonds: {
        bond0: {
          interfaces: ['nic-525400123456', 'nic-525400123457'],
          // lacp-rate と transmit-hash-policy は既定（空）なので出ない
          parameters: { mode: 'active-backup', 'mii-monitor-interval': 100 },
          dhcp4: true,
          optional: true,
        },
      },
    })
  })

  it('メンバーは ethernets にも宣言される（interfaces に並ぶ ID と一致する）', () => {
    // 「The interfaces listed in the `interfaces` key must also be defined」。
    // 宣言が無いと netplan が bond ごと拒否する。
    const net = netplanOf(bondProfile(LACP_STATIC))
    const declared = Object.keys(net.ethernets ?? {})
    expect(net.bonds?.['bond0']?.['interfaces']).toEqual(declared)
  })

  it('メンバー側にアドレスを付けない（アドレスは bond 側だけ）', () => {
    // メンバーに IP が付くと 2 枚が別々の回線として上がり、bond にならない。
    const net = netplanOf(bondProfile(LACP_STATIC))
    for (const [key, iface] of Object.entries(net.ethernets ?? {})) {
      expect(Object.keys(iface), `${key} は match だけを持つこと`).toEqual(['match'])
    }
    expect(net.bonds?.['bond0']?.['addresses']).toEqual(['192.168.1.100/24'])
  })

  it('MAC が違えばメンバーのデバイス ID も違う（1 枚に潰れない）', () => {
    // 単一 NIC 用のキー生成はどの MAC でも `nic-by-mac` を返す。それを使い回すと
    // 2 枚目が 1 枚目を上書きし、interfaces が同じ ID 2 つになる。
    const net = netplanOf(bondProfile(ACTIVE_BACKUP_DHCP))
    const keys = Object.keys(net.ethernets ?? {})
    expect(new Set(keys).size).toBe(2)
    expect(net.bonds?.['bond0']?.['interfaces']).toEqual(keys)
  })

  it('同じ指定が 2 行あってもデバイス ID は重複しない', () => {
    const net = netplanOf(
      bondProfile({
        members: [
          member('m1', { kind: 'name', name: 'eth0' }),
          member('m2', { kind: 'name', name: 'eth0' }),
        ],
      }),
    )
    expect(Object.keys(net.ethernets ?? {})).toEqual(['eth0', 'eth0-2'])
    expect(net.bonds?.['bond0']?.['interfaces']).toEqual(['eth0', 'eth0-2'])
  })

  it('メンバーのデバイス ID は bond 名と衝突しない', () => {
    // netplan の ID は netdef 全体で一意。ethernets と bonds に同じ ID は置けない。
    const keys = bondMemberKeys(
      bond({ name: 'bond0', members: [member('m1', { kind: 'name', name: 'bond0' })] }),
    )
    expect(keys).toEqual(['bond0-2'])
  })

  it('効かないパラメータは出力しない', () => {
    // lacp-rate は 802.3ad、transmit-hash-policy は balance-xor / 802.3ad でのみ効く。
    const net = netplanOf(
      bondProfile({
        members: LACP_STATIC.members,
        parameters: {
          mode: 'active-backup',
          lacpRate: 'fast',
          miiMonitorInterval: 100,
          transmitHashPolicy: 'layer3+4',
        },
      }),
    )
    expect(net.bonds?.['bond0']?.['parameters']).toEqual({
      mode: 'active-backup',
      'mii-monitor-interval': 100,
    })
  })

  it('mii-monitor-interval が 0 のときはキー自体を出さない（netplan の既定と同じ）', () => {
    const net = netplanOf(
      bondProfile({
        members: LACP_STATIC.members,
        parameters: {
          mode: 'active-backup',
          lacpRate: '',
          miiMonitorInterval: 0,
          transmitHashPolicy: '',
        },
      }),
    )
    expect(net.bonds?.['bond0']?.['parameters']).toEqual({ mode: 'active-backup' })
  })

  it('balance-xor では transmit-hash-policy が出る', () => {
    const net = netplanOf(
      bondProfile({
        members: LACP_STATIC.members,
        parameters: {
          mode: 'balance-xor',
          lacpRate: 'fast',
          miiMonitorInterval: 100,
          transmitHashPolicy: 'layer2+3',
        },
      }),
    )
    // lacp-rate は 802.3ad 専用なので出ない
    expect(net.bonds?.['bond0']?.['parameters']).toEqual({
      mode: 'balance-xor',
      'mii-monitor-interval': 100,
      'transmit-hash-policy': 'layer2+3',
    })
  })

  it('DHCP のときはアドレス・経路・DNS を出さない', () => {
    const net = netplanOf(
      bondProfile({
        ...ACTIVE_BACKUP_DHCP,
        addressing: 'dhcp',
        address: '10.0.0.5/24',
        gateway: '10.0.0.1',
        nameservers: ['10.0.0.1'],
      }),
    )
    const b = net.bonds?.['bond0'] ?? {}
    expect(b['dhcp4']).toBe(true)
    expect(b['addresses']).toBeUndefined()
    expect(b['routes']).toBeUndefined()
    expect(b['nameservers']).toBeUndefined()
  })

  it('読めないメンバー指定は「一致しない match」になる（どの NIC でもよい形にしない）', () => {
    const net = netplanOf(
      bondProfile({
        members: [
          { id: 'm1', selector: { kind: 'bogus' } as unknown as BondMember['selector'] },
          member('m2', { kind: 'name', name: 'eth1' }),
        ],
      }),
    )
    expect(net.ethernets?.['bond-member1']).toEqual({
      match: { name: UNREADABLE_MEMBER_MATCH_NAME },
    })
  })

  it('YAML を往復してもモード名が文字列のまま残る（802.3ad は数に見える）', () => {
    // `802.3ad` を数値として書き出すと netplan が読めない。
    const yaml = generateUserData(bondProfile(LACP_STATIC), { comments: 'none' })
    const parsed = parse(yaml) as {
      autoinstall: { network: Netplan }
    }
    expect(parsed.autoinstall.network.bonds?.['bond0']?.['parameters']).toEqual({
      mode: '802.3ad',
      'lacp-rate': 'fast',
      'mii-monitor-interval': 100,
      'transmit-hash-policy': 'layer3+4',
    })
  })

  it('既存の 3 モードの出力は変わらない', () => {
    // bond を足したことで単一 NIC の出力が動いていないことを確かめる。
    const p = createDefaultProfile('24.04')
    const dhcp = buildAutoinstallObject(
      { ...p, network: { mode: 'dhcp', target: { kind: 'mac', macaddress: 'aa:bb:cc:dd:ee:ff' }, optional: true } },
      { comments: 'none' },
    ) as Record<string, unknown>
    expect(dhcp['network']).toEqual({
      version: 2,
      ethernets: { 'nic-by-mac': { match: { macaddress: 'aa:bb:cc:dd:ee:ff' }, dhcp4: true, optional: true } },
    })
    const def = buildAutoinstallObject(p, { comments: 'none' }) as Record<string, unknown>
    expect(def['network']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// subiquity 公式スキーマ
// ---------------------------------------------------------------------------

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/research/schema')
const SCHEMA_FILES: Record<UbuntuSeries, string> = {
  '22.04': 'autoinstall-schema.22.04.2.json',
  '24.04': 'autoinstall-schema.24.04.4.json',
  '25.10': 'autoinstall-schema.25.10.json',
  '26.04': 'autoinstall-schema.26.04.1.json',
}

function validatorFor(series: UbuntuSeries): (data: unknown) => ErrorObject[] | null {
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8')) as object
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  return (data: unknown) => (validate(data) ? null : (validate.errors ?? []))
}

function toPlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if ('value' in value && Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    return (value as { value: unknown }).value
  }
  if (Array.isArray(value)) return value.map(toPlain)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]))
}

describe.each(['22.04', '24.04', '25.10', '26.04'] as UbuntuSeries[])(
  'bond の生成結果が公式スキーマを通る (%s)',
  (series) => {
    const validate = validatorFor(series)

    it.each([
      ['LACP + 固定 IP', LACP_STATIC],
      ['active-backup + DHCP', ACTIVE_BACKUP_DHCP],
    ])('%s', (_label, net) => {
      const built = toPlain(buildAutoinstallObject(bondProfile(net, series), { comments: 'none' }))
      const errors = validate(built)
      expect(errors?.map((e) => `${e.instancePath} ${e.message ?? ''}`).join('\n') ?? '').toBe('')
    })

    it('network.bonds の宣言はリリースによらず type: object だけ', () => {
      // `bonds` の中身をスキーマが検証しない＝**リリース差が無い**（落とし穴 64 の確認）。
      // ここが変わったらリリースごとの出し分けが要る。
      const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8')) as {
        properties?: { network?: { oneOf?: { properties?: Record<string, unknown> }[] } }
      }
      const direct = schema.properties?.network?.oneOf?.[0]?.properties
      expect(direct?.['bonds']).toEqual({ type: 'object' })
    })
  },
)

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

/** 指摘のキーだけを集める（文言ではなくキーで比べる）。 */
function issueKeys(profile: AutoinstallProfile): string[] {
  return validateProfile(profile).issues.map((i) => i.text.key)
}

function severityOf(profile: AutoinstallProfile, key: string): string | undefined {
  return validateProfile(profile).issues.find((i) => i.text.key === key)?.severity
}

describe('bond の検証', () => {
  it('正しい構成では bond の指摘が出ない', () => {
    const keys = issueKeys(bondProfile(LACP_STATIC)).filter((k) => k.startsWith('validate.bond'))
    // 802.3ad はスイッチ側の設定が要ることだけ伝える（info）。
    expect(keys).toEqual(['validate.bondModeNeedsSwitchConfig'])
    expect(severityOf(bondProfile(LACP_STATIC), 'validate.bondModeNeedsSwitchConfig')).toBe('info')
  })

  it('メンバーが 2 つ未満なら error', () => {
    for (const members of [[], [member('m1', { kind: 'name', name: 'eth0' })]]) {
      const p = bondProfile({ members })
      expect(issueKeys(p)).toContain('validate.bondNeedsTwoMembers')
      expect(severityOf(p, 'validate.bondNeedsTwoMembers')).toBe('error')
    }
    expect(issueKeys(bondProfile(LACP_STATIC))).not.toContain('validate.bondNeedsTwoMembers')
  })

  it('同じ NIC を 2 回指定したら error（名前でも MAC でも）', () => {
    const byName = bondProfile({
      members: [
        member('m1', { kind: 'name', name: 'eth0' }),
        member('m2', { kind: 'name', name: 'eth0' }),
      ],
    })
    expect(issueKeys(byName)).toContain('validate.bondMemberDuplicated')
    const byMac = bondProfile({
      members: [
        member('m1', { kind: 'mac', macaddress: '52:54:00:12:34:56' }),
        // 大文字小文字が違うだけの同じ MAC
        member('m2', { kind: 'mac', macaddress: '52:54:00:12:34:56'.toUpperCase() }),
      ],
    })
    expect(issueKeys(byMac)).toContain('validate.bondMemberDuplicated')
    expect(issueKeys(bondProfile(ACTIVE_BACKUP_DHCP))).not.toContain('validate.bondMemberDuplicated')
  })

  it('lacp-rate は 802.3ad 以外では「効きません」と伝える', () => {
    const p = bondProfile({
      members: LACP_STATIC.members,
      parameters: { mode: 'balance-xor', lacpRate: 'fast', miiMonitorInterval: 100, transmitHashPolicy: '' },
    })
    expect(issueKeys(p)).toContain('validate.bondLacpRateIgnored')
    expect(severityOf(p, 'validate.bondLacpRateIgnored')).toBe('warning')
    // 802.3ad なら言わない
    expect(issueKeys(bondProfile(LACP_STATIC))).not.toContain('validate.bondLacpRateIgnored')
  })

  it('transmit-hash-policy は balance-xor / 802.3ad 以外では「効きません」と伝える', () => {
    const ignored = bondProfile({
      members: LACP_STATIC.members,
      parameters: { mode: 'active-backup', lacpRate: '', miiMonitorInterval: 100, transmitHashPolicy: 'layer2' },
    })
    expect(issueKeys(ignored)).toContain('validate.bondHashPolicyIgnored')
    for (const mode of ['balance-xor', '802.3ad'] as const) {
      const p = bondProfile({
        members: LACP_STATIC.members,
        parameters: { mode, lacpRate: '', miiMonitorInterval: 100, transmitHashPolicy: 'layer2' },
      })
      expect(issueKeys(p)).not.toContain('validate.bondHashPolicyIgnored')
    }
  })

  it('mii-monitor-interval が 0 のままなら警告', () => {
    const p = bondProfile({
      members: LACP_STATIC.members,
      parameters: { mode: 'active-backup', lacpRate: '', miiMonitorInterval: 0, transmitHashPolicy: '' },
    })
    expect(issueKeys(p)).toContain('validate.bondMiiMonitorDisabled')
    expect(severityOf(p, 'validate.bondMiiMonitorDisabled')).toBe('warning')
    expect(issueKeys(bondProfile(LACP_STATIC))).not.toContain('validate.bondMiiMonitorDisabled')
  })

  it('メンバーに any を使ったら警告（どの NIC が束ねられるか分からない）', () => {
    const p = bondProfile({
      members: [member('m1', { kind: 'any' }), member('m2', { kind: 'name', name: 'eth1' })],
    })
    expect(issueKeys(p)).toContain('validate.bondMemberAny')
    expect(severityOf(p, 'validate.bondMemberAny')).toBe('warning')
  })

  it('bond では network.target が「使われません」と伝わる', () => {
    const p = bondProfile({ ...LACP_STATIC, target: { kind: 'name', name: 'eno1' } })
    expect(issueKeys(p)).toContain('validate.bondTargetIgnored')
    // **target の中身のエラーは出さない**（bond では直す先が無い・落とし穴 61）
    const empty = bondProfile({ ...LACP_STATIC, target: { kind: 'name', name: '' } })
    expect(issueKeys(empty)).not.toContain('validate.interfaceNameEmpty')
  })

  it('固定 IP の検査は単一 NIC と同じ指摘を出す', () => {
    const p = bondProfile({
      ...LACP_STATIC,
      address: 'nope',
      gateway: 'nope',
      nameservers: ['nope'],
    })
    const keys = issueKeys(p)
    expect(keys).toContain('validate.networkAddressInvalid')
    expect(keys).toContain('validate.networkGatewayInvalid')
    expect(keys).toContain('validate.networkNameserverInvalid')
  })

  it('固定 IP でゲートウェイが無いままパッケージを入れようとしたら error', () => {
    const p = bondProfile({ ...LACP_STATIC, gateway: '' })
    expect(issueKeys({ ...p, software: { ...p.software, packages: ['htop'] } })).toContain(
      'validate.packagesWithoutGateway',
    )
  })

  it('DHCP のときは固定 IP の指摘を出さない', () => {
    const keys = issueKeys(bondProfile(ACTIVE_BACKUP_DHCP))
    expect(keys).not.toContain('validate.networkAddressInvalid')
    expect(keys).not.toContain('validate.networkGatewayMissing')
  })

  it('IP をカーネル引数で渡す設定とは併用できない', () => {
    // 置換スクリプトは network.ethernets しか書き換えないので、bond の
    // アドレスは差し替えられない。黙って通すと全台が同じ IP を掴む。
    const p = bondProfile(LACP_STATIC)
    const keys = issueKeys({
      ...p,
      runtimeValues: {
        ...p.runtimeValues,
        network: 'kernel-arg',
        presets: [
          { id: 'h1', label: 'web01', hostname: 'web01', ipv4: '10.0.0.2/24', gateway: '10.0.0.1', nameservers: '10.0.0.1', disk: '' },
        ],
      },
    })
    expect(keys).toContain('validate.networkKernelArgNeedsStatic')
  })

  it('壊れた JSON でも例外を投げない', () => {
    const broken = [
      { mode: 'bond' },
      { mode: 'bond', members: null, parameters: null, target: null },
      { mode: 'bond', members: [null, 42, {}], parameters: { mode: 5, miiMonitorInterval: 'x' } },
      { mode: 'bond', name: 42, members: [{ id: 1, selector: [] }], nameservers: null },
      { mode: 'bond', members: LACP_STATIC.members, parameters: { mode: '802.3ad', miiMonitorInterval: Number.NaN } },
    ]
    for (const net of broken) {
      const p = { ...bondProfile({}), network: net as unknown as BondNetworkConfig }
      expect(() => validateProfile(p)).not.toThrow()
      expect(() => buildAutoinstallObject(p, { comments: 'none' })).not.toThrow()
      // 指摘は必ず訳せる（キー名がそのまま画面に出ない）
      for (const issue of validateProfile(p).issues) {
        expect(formatLocalized('en', issue.text)).not.toBe(issue.text.key)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 移行（保存済み JSON の読み込み）
// ---------------------------------------------------------------------------

function loadNetwork(network: unknown): {
  net: AutoinstallProfile['network']
  notes: string[]
} {
  const saved = { ...bondProfile({}), network } as unknown
  const result = migrateProfile(JSON.parse(JSON.stringify(saved)) as unknown)
  return { net: result.profile.network, notes: result.notes.map((n) => formatLocalized('ja', n)) }
}

describe('bond の読み込み', () => {
  it('保存した設定をそのまま読み戻せる', () => {
    const { net } = loadNetwork(bond(LACP_STATIC))
    expect(net).toEqual(bond(LACP_STATIC))
  })

  it('メンバーの行が消えない（mergeSection はレコードの配列を潰す）', () => {
    // ここを通さないと `members` が文字列だけに潰され、**行が丸ごと消える**。
    const { net } = loadNetwork(bond(ACTIVE_BACKUP_DHCP))
    expect(net.mode).toBe('bond')
    if (net.mode !== 'bond') throw new Error('bond no hazu')
    expect(net.members).toHaveLength(2)
    expect(net.members[0]?.selector).toEqual({ kind: 'mac', macaddress: '52:54:00:12:34:56' })
  })

  it('メンバーの selector は型ごとに読む（判別可能ユニオンを潰さない）', () => {
    const { net } = loadNetwork({
      ...bond({}),
      members: [
        { id: 'm1', selector: { kind: 'mac', macaddress: '52:54:00:12:34:56' } },
        { id: 'm2', selector: { kind: 'name', name: 'eth1' } },
        { id: 'm3', selector: { kind: 'any' } },
      ],
    })
    if (net.mode !== 'bond') throw new Error('bond no hazu')
    expect(net.members.map((m) => m.selector)).toEqual([
      { kind: 'mac', macaddress: '52:54:00:12:34:56' },
      { kind: 'name', name: 'eth1' },
      { kind: 'any' },
    ])
  })

  it('読めない selector は any ではなく空欄に落とす', () => {
    // `any`（すべての有線 LAN）に落とすと、どの NIC が束ねられるか分からない
    // 指定に黙って化ける。空欄なら検証が「入力してください」と言う。
    const { net } = loadNetwork({
      ...bond({}),
      members: [{ id: 'm1', selector: { kind: 'bogus', name: 'eth0' } }],
    })
    if (net.mode !== 'bond') throw new Error('bond no hazu')
    expect(net.members[0]?.selector).toEqual({ kind: 'name', name: '' })
  })

  it('要素でない行は落とし、落としたことを notes で伝える', () => {
    const { net, notes } = loadNetwork({
      ...bond({}),
      members: [null, 'eth0', { id: 'm1', selector: { kind: 'name', name: 'eth0' } }],
    })
    if (net.mode !== 'bond') throw new Error('bond no hazu')
    expect(net.members).toHaveLength(1)
    expect(notes.join('\n')).toContain('2')
  })

  it('id が無い行にも id を振る（React の key と削除操作に要る）', () => {
    const { net } = loadNetwork({
      ...bond({}),
      members: [{ selector: { kind: 'name', name: 'eth0' } }, { selector: { kind: 'name', name: 'eth1' } }],
    })
    if (net.mode !== 'bond') throw new Error('bond no hazu')
    const ids = net.members.map((m) => m.id)
    expect(ids.every((id) => id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('知らない列挙値は既定に戻し、戻したことを伝える', () => {
    const { net, notes } = loadNetwork({
      ...bond({}),
      addressing: 'magic',
      parameters: { mode: 'magic', lacpRate: 'magic', miiMonitorInterval: 100, transmitHashPolicy: '' },
    })
    if (net.mode !== 'bond') throw new Error('bond no hazu')
    expect(net.parameters.mode).toBe('active-backup')
    expect(net.parameters.lacpRate).toBe('')
    expect(net.addressing).toBe('dhcp')
    expect(notes.length).toBeGreaterThanOrEqual(3)
  })

  it('target（bond では使わない）も判別可能ユニオンとして読む', () => {
    const { net } = loadNetwork({ ...bond({}), target: { kind: 'mac', macaddress: 'aa:bb:cc:dd:ee:ff' } })
    if (net.mode !== 'bond') throw new Error('bond no hazu')
    expect(net.target).toEqual({ kind: 'mac', macaddress: 'aa:bb:cc:dd:ee:ff' })
  })

  it('壊れた JSON でも例外を投げず、形の揃ったプロファイルになる', () => {
    for (const network of [
      { mode: 'bond' },
      { mode: 'bond', members: 'nope', parameters: 42, target: null, nameservers: null },
      { mode: 'bond', members: [{ id: 5, selector: 7 }], parameters: { miiMonitorInterval: 'x' } },
      { mode: 'bond', name: null, addressing: null },
    ]) {
      expect(() => migrateProfile({ ...bondProfile({}), network })).not.toThrow()
      const { net } = loadNetwork(network)
      if (net.mode !== 'bond') throw new Error('bond no hazu')
      expect(Array.isArray(net.members)).toBe(true)
      expect(typeof net.name).toBe('string')
      expect(typeof net.parameters.mode).toBe('string')
      expect(Array.isArray(net.nameservers)).toBe(true)
    }
  })

  it('既存の 3 モードの読み込みは変わらない', () => {
    const { net } = loadNetwork({
      mode: 'static',
      target: { kind: 'mac', macaddress: 'aa:bb:cc:dd:ee:ff' },
      address: '10.0.0.2/24',
      gateway: '10.0.0.1',
      nameservers: ['10.0.0.1'],
      searchDomains: [],
      optional: true,
    })
    expect(net).toEqual({
      mode: 'static',
      target: { kind: 'mac', macaddress: 'aa:bb:cc:dd:ee:ff' },
      address: '10.0.0.2/24',
      gateway: '10.0.0.1',
      nameservers: ['10.0.0.1'],
      searchDomains: [],
      optional: true,
    })
  })
})
