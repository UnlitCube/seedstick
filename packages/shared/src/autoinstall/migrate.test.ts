import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './defaults.js'
import { migrateProfile } from './migrate.js'
import { buildAutoinstallObject } from './generate.js'
import { validateProfile } from './validate.js'
import {
  en,
  formatLocalized,
  isLocalizedText,
  ja,
  LOCALES,
  type LocalizedText,
} from '../i18n/index.js'

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
const SERVICE_SAMPLE = {
  id: 's1',
  name: 'app',
  description: '',
  execStart: '/usr/bin/true',
  execStartPre: '',
  workingDirectory: '',
  user: '',
  group: '',
  environment: [] as unknown[],
  environmentFile: '',
  serviceType: 'simple',
  restart: 'no',
  restartSec: 5,
  after: [] as unknown[],
  wantedBy: 'multi-user.target',
  enabled: true,
}

const USER_SAMPLE = {
  id: 'u1',
  username: 'deploy',
  realname: '',
  passwordHash: '',
  sudo: 'none',
  groups: [] as unknown[],
  shell: '',
  sshAuthorizedKeys: [] as unknown[],
  createHome: true,
  systemAccount: false,
}

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

  it('文字列の配列に混ざった非文字列を落とす（例外にせず、汚染も通さない）', () => {
    // レコードの中の配列（services[].environment、
    // additionalUsers[].sshAuthorizedKeys、behavior.interactiveSections …）は
    // mergeSection の配列分岐を通る。素通しにすると `[42]` が型だけ合った状態で
    // 通り、validateProfile も buildAutoinstallObject も `e.trim is not a function`
    // で落ちる（落とし穴 23：GUI が理由の分からない空の確認画面になる）。
    const base = createDefaultProfile('24.04')
    const saved = JSON.parse(
      JSON.stringify(base).replace(
        '"interactiveSections":[]',
        '"interactiveSections":["identity",42,null,{"__proto__":{"polluted":true}}]',
      ),
    ) as unknown

    const r = migrateProfile(saved)
    expect(r.profile.behavior.interactiveSections).toEqual(['identity'])
    // オブジェクトが一切通らないので、プロトタイプ汚染も起きない
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('知らない列挙値は既定に戻し、戻したことを伝える', () => {
    // 素通しにすると、その値がそのまま autoinstall YAML に出る。
    // subiquity 側で弾かれるので、気づくのは**実機でインストールを始めてから**。
    // migrate も validate も何も言わないまま USB が焼き上がっていた。
    const base = createDefaultProfile('24.04')
    const saved = {
      ...base,
      apt: { ...base.apt, fallback: 'NOT-A-REAL-VALUE' },
      behavior: { ...base.behavior, shutdown: 'bogus-shutdown' },
      software: { ...base.software, updates: 'bogus-updates' },
      storage: { ...base.storage, partitionTable: 'bogus-table' },
    } as unknown

    const r = migrateProfile(saved)
    expect(r.profile.apt.fallback).toBe(base.apt.fallback)
    expect(r.profile.behavior.shutdown).toBe(base.behavior.shutdown)
    expect(r.profile.software.updates).toBe(base.software.updates)
    if (r.profile.storage.mode !== 'raw' && base.storage.mode !== 'raw') {
      expect(r.profile.storage.partitionTable).toBe(base.storage.partitionTable)
    }

    // 黙って戻さない（落とし穴 50）
    expect(r.notes.length).toBeGreaterThanOrEqual(4)
    for (const field of [
      'migrate.field.aptFallback',
      'migrate.field.behaviorShutdown',
      'migrate.field.softwareUpdates',
      'migrate.field.storagePartitionTable',
    ]) {
      expect(
        r.notes.some(
          (n) =>
            n.key === 'migrate.enumReset' &&
            (n.params?.['field'] as LocalizedText | undefined)?.key === field,
        ),
        field,
      ).toBe(true)
    }
    // **どちらの言語でも、どの項目が戻ったのかが読める。**
    // 項目名を訳文の連結で組み立てると、ここが片方の言語で崩れる。
    for (const locale of LOCALES) {
      const text = r.notes.map((n) => formatLocalized(locale, n)).join(' / ')
      for (const path of [
        'apt.fallback',
        'behavior.shutdown',
        'software.updates',
        'storage.partitionTable',
      ]) {
        expect(text, `${locale}: ${path}`).toContain(path)
      }
    }

    // 生成物にも漏れない
    const built = JSON.stringify(buildAutoinstallObject(r.profile))
    expect(built).not.toContain('NOT-A-REAL-VALUE')
    expect(built).not.toContain('bogus-')
  })

  it('正しい列挙値はそのまま通す', () => {
    const base = createDefaultProfile('24.04')
    const saved = {
      ...base,
      apt: { ...base.apt, fallback: 'offline-install' },
      behavior: { ...base.behavior, shutdown: 'poweroff' },
      software: { ...base.software, updates: 'all' },
    } as unknown
    const r = migrateProfile(saved)
    expect(r.profile.apt.fallback).toBe('offline-install')
    expect(r.profile.behavior.shutdown).toBe('poweroff')
    expect(r.profile.software.updates).toBe('all')
    expect(r.notes).toEqual([])
  })

  it('レコードの中の文字列配列が壊れていても、検証と生成が例外を投げない', () => {
    // 例外を投げると GUI は「理由の分からない空の確認画面」と
    // 「反応しない書き込みボタン」になる（落とし穴 23）。
    const base = createDefaultProfile('24.04')
    const saved = {
      ...base,
      postInstall: {
        ...base.postInstall,
        services: [{ ...SERVICE_SAMPLE, environment: [42, { evil: 1 }, 'OK=1'] }],
        additionalUsers: [{ ...USER_SAMPLE, sshAuthorizedKeys: [{ evil: 1 }, 'ssh-ed25519 AAAA a@b'] }],
      },
    } as unknown

    const r = migrateProfile(saved)
    expect(() => validateProfile(r.profile)).not.toThrow()
    expect(() => buildAutoinstallObject(r.profile)).not.toThrow()
    // 文字列だけが残る
    expect(r.profile.postInstall.services[0]!.environment).toEqual(['OK=1'])
    expect(r.profile.postInstall.additionalUsers[0]!.sshAuthorizedKeys).toEqual([
      'ssh-ed25519 AAAA a@b',
    ])
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

// 読み込みの notes は「英語の画面に日本語が出る」経路そのもの。
//
// ここに出るのは落とし穴 49 / 50 のための安全通知（「ディスクの構成方法を
// 認識できず既定に戻した」＝別のディスクを消しかねない、と伝える最後の手段）で、
// 日本語の素の string で積んでいた間、英語の利用者にはまったく届いていなかった。
describe('読み込みの notes は訳す前のまま運ぶ', () => {
  /** 出しうる通知をひととおり起こす。新しい通知を足したらここにも足す。 */
  function everyNote(): LocalizedText[] {
    const notes: LocalizedText[] = []
    notes.push(...migrateProfile('nonsense').notes)
    notes.push(...migrateProfile({ profileVersion: 2, series: '24.04' }).notes)
    notes.push(...migrateProfile({ profileVersion: 3, series: '24.04' }).notes)
    notes.push(...migrateProfile({ profileVersion: 99, series: '24.04' }).notes)
    notes.push(
      ...migrateProfile({
        profileVersion: 1,
        series: '18.04',
        apt: { fallback: 'bogus-fallback' },
        behavior: { shutdown: 'bogus-shutdown' },
        software: { updates: 'bogus-updates', snaps: [null] },
        storage: { mode: 'bogus-mode', match: { kind: 'serial', serial: 'S1' } },
        postInstall: {
          files: [null],
          additionalUsers: [42],
          deployments: ['nope'],
          services: [null],
        },
      }).notes,
    )
    notes.push(
      ...migrateProfile({
        profileVersion: 4,
        series: '24.04',
        storage: { mode: 'lvm', partitionTable: 'bogus-table' },
      }).notes,
    )
    return notes
  }

  /** 入れ子の差し込み値も含めて、使われているキーをすべて集める。 */
  function keysOf(notes: readonly LocalizedText[]): string[] {
    const out: string[] = []
    const walk = (n: LocalizedText): void => {
      out.push(n.key)
      for (const v of Object.values(n.params ?? {})) if (isLocalizedText(v)) walk(v)
    }
    for (const n of notes) walk(n)
    return [...new Set(out)]
  }

  it('notes は LocalizedText（訳した文字列ではない）', () => {
    const notes = everyNote()
    expect(notes.length).toBeGreaterThan(10)
    for (const n of notes) {
      // deep: 差し込み値まで見る（IPC を通るので純粋なデータでなければならない）
      expect(isLocalizedText(n, true), JSON.stringify(n)).toBe(true)
      expect(typeof n).not.toBe('string')
    }
  })

  it('notes のキーは ja と en の両方に実在する（キー名が画面に出ない）', () => {
    // 辞書に無いキーは createTranslator がキー名をそのまま返すので、
    // 画面に `migrate.fromV2` と出る。型では捕まらない（MsgKey は文字列の合併なので
    // 片方の辞書だけ足しても satisfies は通る…ことは無いが、綴り違いは通る）。
    for (const key of keysOf(everyNote())) {
      expect(Object.prototype.hasOwnProperty.call(ja, key), `ja に ${key} が無い`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(en, key), `en に ${key} が無い`).toBe(true)
    }
  })

  it('英語に訳すと日本語が残らない', () => {
    // **ひな型（差し込み前）で見る。** 差し込み値は利用者のデータなので、
    // 手で編集された JSON なら日本語が入りうる。訳文そのものを見ないと、
    // 「値のせいで落ちるテスト」か「訳し忘れ」かが区別できない。
    const JAPANESE = /[ぁ-んァ-ヶ一-龠]/
    for (const key of keysOf(everyNote())) {
      const template = (en as Record<string, string>)[key]!
      expect(JAPANESE.test(template), `en.${key} に日本語が残っている: ${template}`).toBe(false)
    }
  })

  it('落とし穴 49 の「ディスク指定が既定に戻った」通知が両方の言語で出る', () => {
    // `{kind:'serial'}` が黙って `{kind:'largest'}` に落ちると、複数ディスク機で
    // 意図と違うディスクを消す（このツールで最も破壊的な失敗）。
    // 通知が片方の言語にしか出ないなら、その言語の利用者には防ぎようがない。
    const r = migrateProfile({
      profileVersion: 4,
      series: '24.04',
      storage: { mode: 'bogus-mode', match: { kind: 'serial', serial: 'ABC-123' } },
    })
    const note = r.notes.find((n) => n.key === 'migrate.storageModeReset')
    expect(note, JSON.stringify(r.notes)).toBeDefined()
    // 指定は残っている（読めた部分は既定に戻さない）
    expect(r.profile.storage.mode !== 'raw' && r.profile.storage.match).toEqual({
      kind: 'serial',
      serial: 'ABC-123',
    })
    for (const locale of LOCALES) {
      const text = formatLocalized(locale, note!)
      expect(text.length, locale).toBeGreaterThan(0)
      // キー名がそのまま出ていない・差し込み忘れが無い
      expect(text, locale).not.toBe(note!.key)
      expect(text, locale).toContain('bogus-mode')
      expect(text, locale).not.toContain('{mode}')
    }
    // 英語の通知に日本語が混ざらない（差し込み値は ASCII だけを渡している）
    expect(/[ぁ-んァ-ヶ一-龠]/.test(formatLocalized('en', note!))).toBe(false)
  })

  it('同じ通知は 1 度だけ、違う項目の通知は潰さない', () => {
    // 中身で比べないと、項目の違う `migrate.enumReset` が 1 件に潰れる。
    const r = migrateProfile({
      profileVersion: 4,
      series: '24.04',
      apt: { fallback: 'bogus-a' },
      behavior: { shutdown: 'bogus-b' },
    })
    const resets = r.notes.filter((n) => n.key === 'migrate.enumReset')
    expect(resets.length).toBe(2)
  })
})
