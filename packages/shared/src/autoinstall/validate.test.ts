import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './defaults.js'
import { validateProfile } from './validate.js'
import { migrateProfile } from './migrate.js'
import type { AutoinstallProfile } from './model.js'

// 検証は「壊れた設定を止める」だけでなく、**手で編集された JSON でも例外を投げない**
// ことが要件。例外で抜けると GUI は理由の分からない空の確認画面と、
// 反応しない書き込みボタンだけを見せることになる。

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

function base(): AutoinstallProfile {
  const p = createDefaultProfile('24.04')
  return {
    ...p,
    basics: { ...p.basics, hostname: 'h1' },
    user: { ...p.user, username: 'opsuser', passwordHash: HASH },
  }
}

function errorsFor(p: AutoinstallProfile): string[] {
  return validateProfile(p).issues.filter((i) => i.severity === 'error').map((i) => i.field)
}

describe('壊れた入力でも例外を投げない', () => {
  it('storage.match のキーが欠けていても落ちない', () => {
    for (const m of [{ kind: 'serial' }, { kind: 'path' }, { kind: 'model' }]) {
      const p = { ...base(), storage: { ...base().storage, match: m } } as unknown as AutoinstallProfile
      expect(() => validateProfile(p)).not.toThrow()
      expect(errorsFor(p)).toContain('storage.match')
    }
  })

  it('知らないプリセット ID があっても落ちない', () => {
    const p = {
      ...base(),
      postInstall: { ...base().postInstall, presets: ['docker-ce', 'made-up-preset'] },
    } as unknown as AutoinstallProfile
    expect(() => validateProfile(p)).not.toThrow()
    expect(errorsFor(p)).toContain('postInstall.presets')
  })

  it('ホストプリセットのキーが欠けていても落ちない', () => {
    const p = {
      ...base(),
      runtimeValues: {
        hostname: 'kernel-arg',
        network: 'fixed',
        disk: 'fixed',
        offerInteractiveEntry: true,
        presets: [{ id: 'a', label: 'x' }],
      },
    } as unknown as AutoinstallProfile
    expect(() => validateProfile(p)).not.toThrow()
  })

  it('壊れた上書き YAML でも落ちない', () => {
    for (const yaml of ['{{{', 'a: [1, 2', '- 1\n- 2', 'plain string']) {
      const p = { ...base(), advanced: { ...base().advanced, rawOverlayYaml: yaml } }
      expect(() => validateProfile(p)).not.toThrow()
    }
  })

  it('migrate を通した壊れた JSON でも落ちない', () => {
    for (const bad of [null, [], 'x', 42, { profileVersion: 'nope' }, { storage: [] }, { user: 7 }]) {
      const r = migrateProfile(bad)
      expect(() => validateProfile(r.profile)).not.toThrow()
    }
  })
})

describe('気づきにくい壊れ方を止める', () => {
  it('NIC 名が空ならエラー', () => {
    const p: AutoinstallProfile = {
      ...base(),
      network: { mode: 'dhcp', target: { kind: 'name', name: '' }, optional: true },
    }
    expect(errorsFor(p)).toContain('network.target')
  })

  it('不正な MAC はエラー', () => {
    for (const mac of ['', 'aabbccddeeff', 'gg:bb:cc:dd:ee:ff', 'aa:bb:cc:dd:ee']) {
      const p: AutoinstallProfile = {
        ...base(),
        network: { mode: 'dhcp', target: { kind: 'mac', macaddress: mac }, optional: true },
      }
      expect(errorsFor(p)).toContain('network.target')
    }
  })

  it('正しい MAC と NIC 名は通る', () => {
    for (const target of [
      { kind: 'mac' as const, macaddress: 'aa:bb:cc:dd:ee:ff' },
      { kind: 'name' as const, name: 'enp0s3' },
    ]) {
      const p: AutoinstallProfile = { ...base(), network: { mode: 'dhcp', target, optional: true } }
      expect(errorsFor(p)).not.toContain('network.target')
    }
  })

  it('カスタムミラーで URL が空ならエラー', () => {
    const p: AutoinstallProfile = { ...base(), apt: { ...base().apt, mode: 'custom', primaryUri: '' } }
    expect(errorsFor(p)).toContain('apt.primaryUri')
  })

  it('上書き YAML が storage を書き換えたら警告する', () => {
    const p: AutoinstallProfile = {
      ...base(),
      advanced: { ...base().advanced, rawOverlayYaml: 'storage:\n  layout:\n    name: direct\n' },
    }
    const w = validateProfile(p).issues.filter((i) => i.field === 'advanced.rawOverlayYaml')
    expect(w).toHaveLength(1)
    expect(w[0]!.severity).toBe('warning')
  })

  it('無関係なキーの上書きには警告しない', () => {
    const p: AutoinstallProfile = {
      ...base(),
      advanced: { ...base().advanced, rawOverlayYaml: 'timezone: Etc/UTC\n' },
    }
    expect(validateProfile(p).issues.filter((i) => i.field === 'advanced.rawOverlayYaml')).toHaveLength(0)
  })
})

describe('正しい設定を誤って弾かない', () => {
  it('既定のプロファイルはエラーなし', () => {
    expect(errorsFor(base())).toEqual([])
  })

  it('閉じたネットワーク（ゲートウェイ・DNS なし）は通る', () => {
    const p: AutoinstallProfile = {
      ...base(),
      network: {
        mode: 'static',
        target: { kind: 'any' },
        address: '10.0.0.5/24',
        gateway: '',
        nameservers: [],
        searchDomains: [],
        optional: false,
      },
      storage: {
        ...(base().storage as Exclude<AutoinstallProfile['storage'], { mode: 'raw' }>),
        match: { kind: 'serial', serial: 'X1' },
      },
      runtimeValues: {
        hostname: 'kernel-arg',
        network: 'kernel-arg',
        disk: 'kernel-arg',
        offerInteractiveEntry: true,
        presets: [
          { id: 'p1', label: 'a', hostname: 'a', ipv4: '10.0.0.6/24', gateway: '', nameservers: '', disk: 'X2' },
        ],
      },
    }
    // 注意として出るのは構わないが、作れなくなってはいけない
    expect(errorsFor(p)).toEqual([])
  })
})
