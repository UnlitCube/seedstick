import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './defaults.js'
import { migrateProfile } from './migrate.js'
import { buildAutoinstallObject } from './generate.js'
import { validateProfile } from './validate.js'

// 保存 → 読み込みで値が失われないことを確かめる。
//
// ここが壊れると「設定して保存 → 開き直すと消えている」だけでなく、
// 判別可能ユニオンの中身が欠けた状態で生成・検証に進んで例外になる
// （確認画面が空のまま次へ進めない／UserStep を開くと renderer が落ちる）。

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

/** 保存された JSON を模す（実際の保存経路と同じく JSON を往復させる）。 */
function roundTrip(profile: unknown): ReturnType<typeof migrateProfile> {
  return migrateProfile(JSON.parse(JSON.stringify(profile)))
}

describe('判別可能ユニオンが保存 → 読み込みで壊れない', () => {
  it('software.kernel の flavor が残る', () => {
    const base = createDefaultProfile('24.04')
    const saved = { ...base, software: { ...base.software, kernel: { mode: 'flavor', flavor: 'hwe' } } }
    const r = roundTrip(saved)
    expect(r.profile.software.kernel).toEqual({ mode: 'flavor', flavor: 'hwe' })
  })

  it('software.kernel の package が残る', () => {
    const base = createDefaultProfile('24.04')
    const saved = {
      ...base,
      software: { ...base.software, kernel: { mode: 'package', package: 'linux-generic-hwe-24.04' } },
    }
    expect(roundTrip(saved).profile.software.kernel).toEqual({
      mode: 'package',
      package: 'linux-generic-hwe-24.04',
    })
  })

  it('user.groups の append が残る', () => {
    const base = createDefaultProfile('26.04')
    const saved = { ...base, user: { ...base.user, groups: { mode: 'append', groups: ['docker', 'libvirt'] } } }
    expect(roundTrip(saved).profile.user.groups).toEqual({
      mode: 'append',
      groups: ['docker', 'libvirt'],
    })
  })

  it('behavior.reporting の webhook が残る', () => {
    const base = createDefaultProfile('24.04')
    const saved = {
      ...base,
      behavior: { ...base.behavior, reporting: { kind: 'webhook', endpoint: 'https://h.example/x' } },
    }
    expect(roundTrip(saved).profile.behavior.reporting).toEqual({
      kind: 'webhook',
      endpoint: 'https://h.example/x',
    })
  })

  it('activeDirectory が初期値に戻らない', () => {
    const base = createDefaultProfile('24.04')
    const saved = {
      ...base,
      activeDirectory: { enabled: true, adminName: 'Administrator', domainName: 'corp.example.com' },
    }
    expect(roundTrip(saved).profile.activeDirectory).toEqual({
      enabled: true,
      adminName: 'Administrator',
      domainName: 'corp.example.com',
    })
  })

  // 壊れた値は既定に戻す（落とすのではなく安全側に倒す）
  it('判別子が不正なら既定値に戻す', () => {
    const base = createDefaultProfile('24.04')
    for (const bad of [{ mode: 'nope' }, { mode: 'flavor' }, 'string', 42, null]) {
      const r = roundTrip({ ...base, software: { ...base.software, kernel: bad } })
      expect(r.profile.software.kernel).toEqual({ mode: 'default' })
    }
  })

  it('読み込んだプロファイルがそのまま生成・検証を通る', () => {
    const base = createDefaultProfile('26.04')
    const saved = {
      ...base,
      basics: { ...base.basics, hostname: 'h1' },
      user: { ...base.user, username: 'admin', passwordHash: HASH, groups: { mode: 'append', groups: ['docker'] } },
      software: { ...base.software, kernel: { mode: 'flavor', flavor: 'hwe' } },
      behavior: { ...base.behavior, reporting: { kind: 'webhook', endpoint: 'https://h.example/x' } },
    }
    const r = roundTrip(saved)
    // かつてはここで TypeError（groups が iterable でない / destination が undefined）になった
    expect(() => buildAutoinstallObject(r.profile)).not.toThrow()
    expect(() => validateProfile(r.profile)).not.toThrow()
    const o = buildAutoinstallObject(r.profile)
    expect((o['kernel'] as { flavor: string }).flavor).toBe('hwe')
    expect((o['identity'] as { groups: unknown }).groups).toEqual({ append: ['docker'] })
  })
})

describe('古いプロファイルに無いキーを補う', () => {
  // v2 には storage.swap / resetPartition が無い。既定のモード (lvm) と違う
  // direct / zfs を選んでいると、かつては丸ごと採用してキーが欠けたままになり
  // ディスク画面が storage.swap.mode で落ちた。
  it('v2 の direct レイアウトでも swap / resetPartition が入る', () => {
    const r = migrateProfile({
      profileVersion: 2,
      series: '24.04',
      storage: {
        mode: 'direct',
        match: { kind: 'largest' },
        useWholeDisk: false,
        encryptionPassphrase: '',
        disableSwap: true,
        partitionTable: 'default',
      },
    })
    const st = r.profile.storage
    expect(st.mode).toBe('direct')
    if (st.mode === 'raw') throw new Error('raw にならないはず')
    expect(st.swap).toEqual({ mode: 'none', size: '' })
    expect(st.resetPartition).toEqual({ enabled: false, size: '' })
    expect(() => buildAutoinstallObject(r.profile)).not.toThrow()
  })

  it('v1 の静的ネットワークでも searchDomains が入る', () => {
    const r = migrateProfile({
      profileVersion: 1,
      series: '22.04',
      network: {
        mode: 'static',
        target: { kind: 'any' },
        address: '10.0.0.5/24',
        gateway: '10.0.0.1',
        nameservers: ['1.1.1.1'],
      },
    })
    const net = r.profile.network
    expect(net.mode).toBe('static')
    if (net.mode !== 'static') throw new Error('static のはず')
    expect(net.address).toBe('10.0.0.5/24')
    expect(net.searchDomains).toEqual([])
    expect(() => buildAutoinstallObject(r.profile)).not.toThrow()
  })

  it('未知のモードは既定値に戻す', () => {
    const r = migrateProfile({ profileVersion: 4, series: '24.04', storage: { mode: 'btrfs' } })
    expect(r.profile.storage.mode).toBe(createDefaultProfile('24.04').storage.mode)
  })
})

// 回帰: 既定値の形だけを写すマージは、ネストした判別可能ユニオンの固有フィールドを落とす。
// storage.match がシリアル指定から `{}`（＝任意のディスク）に化けると、
// 複数ディスク機で別のディスクを消しかねない。このツールで最も破壊的な失敗。
describe('ネストしたユニオン（match / target）が保存 → 読み込みで壊れない', () => {
  it('storage.match.serial が残る（lvm / direct / zfs すべて）', () => {
    for (const mode of ['lvm', 'direct', 'zfs'] as const) {
      const base = createDefaultProfile('24.04')
      const saved = {
        ...base,
        storage: { ...base.storage, mode, match: { kind: 'serial', serial: 'CT500MX500SSD1' } },
      }
      const st = roundTrip(saved).profile.storage
      if (st.mode === 'raw') throw new Error('raw にならないはず')
      expect(st.match).toEqual({ kind: 'serial', serial: 'CT500MX500SSD1' })
      const layout = (buildAutoinstallObject(roundTrip(saved).profile)['storage'] as {
        layout: { match: Record<string, unknown> }
      }).layout
      // `match: {}` は「任意のディスク」を意味する（autoinstall リファレンス）
      expect(layout.match).toEqual({ serial: 'CT500MX500SSD1' })
    }
  })

  it('storage.match の path / model も残る', () => {
    const base = createDefaultProfile('24.04')
    for (const m of [
      { kind: 'path', path: '/dev/disk/by-id/x' },
      { kind: 'model', model: 'Samsung SSD' },
    ]) {
      const st = roundTrip({ ...base, storage: { ...base.storage, match: m } }).profile.storage
      if (st.mode === 'raw') throw new Error('raw にならないはず')
      expect(st.match).toEqual(m)
    }
  })

  it('network.target の NIC 名 / MAC が残る', () => {
    const base = createDefaultProfile('24.04')
    const withName = roundTrip({
      ...base,
      network: {
        mode: 'static',
        target: { kind: 'name', name: 'eno1' },
        address: '10.0.0.5/24',
        gateway: '10.0.0.1',
        nameservers: ['1.1.1.1'],
        searchDomains: [],
        optional: false,
      },
    }).profile.network
    if (withName.mode !== 'static') throw new Error('static のはず')
    expect(withName.target).toEqual({ kind: 'name', name: 'eno1' })
    // netplan のキーが "undefined" にならないこと
    const eth = (buildAutoinstallObject({
      ...createDefaultProfile('24.04'),
      network: withName,
    })['network'] as { ethernets: Record<string, unknown> }).ethernets
    expect(Object.keys(eth)).toEqual(['eno1'])

    const withMac = roundTrip({
      ...base,
      network: { mode: 'dhcp', target: { kind: 'mac', macaddress: 'aa:bb:cc:dd:ee:ff' }, optional: true },
    }).profile.network
    if (withMac.mode !== 'dhcp') throw new Error('dhcp のはず')
    expect(withMac.target).toEqual({ kind: 'mac', macaddress: 'aa:bb:cc:dd:ee:ff' })
  })

  it('プロトタイプ汚染を持ち込まない', () => {
    const base = createDefaultProfile('24.04')
    const saved = JSON.parse(
      JSON.stringify({ ...base, storage: { ...base.storage, match: { kind: 'serial', serial: 'X' } } }).replace(
        '"kind":"serial"',
        '"kind":"serial","__proto__":{"polluted":true}',
      ),
    ) as unknown
    const r = migrateProfile(saved)
    expect((r.profile as unknown as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

// 回帰: migrateProfile が返す値は AutoinstallProfile として使える形でなければならない。
// 型は合っているのに中身が null / 配列 / プリミティブ、という状態を作ると、
// validateProfile と buildAutoinstallObject が例外で抜け、
// GUI は理由の分からない空の確認画面になる（React のレンダリングごと落ちることもある）。
describe('壊れた JSON を読んでも「使える形」を返す', () => {
  const consumers = (p: ReturnType<typeof migrateProfile>['profile']): void => {
    expect(() => validateProfile(p)).not.toThrow()
    expect(() => buildAutoinstallObject(p)).not.toThrow()
  }

  it('ネストしたオブジェクトが null でも落ちない', () => {
    const base = createDefaultProfile('24.04')
    const spots: [string, string][] = [
      ['basics', 'keyboard'],
      ['storage', 'match'],
      ['storage', 'swap'],
      ['storage', 'resetPartition'],
      ['software', 'gpu'],
      ['network', 'target'],
      ['user', 'groups'],
      ['software', 'kernel'],
      ['behavior', 'reporting'],
    ]
    for (const [section, key] of spots) {
      const saved = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
      saved[section]![key] = null
      consumers(migrateProfile(saved).profile)
    }
  })

  it('ネストしたオブジェクトが配列や文字列でも落ちない', () => {
    const base = createDefaultProfile('24.04')
    for (const bad of [[], [1, 2], 'x', 42, true]) {
      for (const [section, key] of [
        ['basics', 'keyboard'],
        ['storage', 'match'],
        ['storage', 'swap'],
      ] as const) {
        const saved = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
        saved[section]![key] = bad
        consumers(migrateProfile(saved).profile)
      }
    }
  })

  // 回帰: SwapConfig は判別可能ユニオンではない普通のオブジェクト。
  // mode を判別子とみなして丸ごと採ると size が落ち、size.trim() で落ちる。
  it('storage.swap の mode だけが保存されていても size を補う', () => {
    const base = createDefaultProfile('24.04')
    for (const mode of ['installer-default', 'none', 'size']) {
      const saved = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
      saved['storage']!['swap'] = { mode }
      const p = migrateProfile(saved).profile
      if (p.storage.mode === 'raw') throw new Error('raw にならないはず')
      expect(typeof p.storage.swap.size).toBe('string')
      consumers(p)
    }
  })

  it('レコードの配列に null やプリミティブが混ざっても落ちない', () => {
    const base = createDefaultProfile('24.04')
    const arrays = ['files', 'additionalUsers', 'deployments', 'services']
    for (const key of arrays) {
      const saved = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
      saved['postInstall']![key] = [null, 'x', 42, {}]
      const p = migrateProfile(saved).profile
      // 使えない要素は落とし、残った要素はひな型で埋める
      const list = (p.postInstall as unknown as Record<string, unknown[]>)[key]!
      expect(list.every((el) => el !== null && typeof el === 'object')).toBe(true)
      consumers(p)
    }
  })

  it('null を既定値に使うキーはオブジェクトや配列を受け付けない', () => {
    const base = createDefaultProfile('24.04')
    for (const bad of [{ a: 1 }, [1, 2]]) {
      const saved = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
      saved['software']!['searchDrivers'] = bad
      const p = migrateProfile(saved).profile
      expect(p.software.searchDrivers).toBeNull()
      const saved2 = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
      ;(saved2['basics']!['keyboard'] as Record<string, unknown>)['toggle'] = bad
      expect(migrateProfile(saved2).profile.basics.keyboard.toggle).toBeNull()
    }
  })

  it('アプリ展開の取得元（ユニオン）が保存 → 読み込みで壊れない', () => {
    const base = createDefaultProfile('24.04')
    const sources = [
      { kind: 'host-file', path: 'C:/tmp/app.tar.gz', sizeBytes: 123 },
      { kind: 'url', url: 'https://example.com/a.tgz', sha256: 'a'.repeat(64) },
      { kind: 'inline', content: 'hello' },
    ]
    for (const source of sources) {
      const saved = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
      saved['postInstall']!['deployments'] = [
        { id: 'd1', kind: 'archive', name: 'a.tgz', targetPath: '/opt/a', source },
      ]
      const d = migrateProfile(saved).profile.postInstall.deployments[0]!
      expect(d.source).toEqual(source)
    }
  })

  it('要素に id が無ければ補う（React の key と削除操作に要る）', () => {
    const base = createDefaultProfile('24.04')
    const saved = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>
    saved['postInstall']!['services'] = [{ name: 'a' }, { name: 'b' }]
    const ids = migrateProfile(saved).profile.postInstall.services.map((s) => s.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every(Boolean)).toBe(true)
  })
})
