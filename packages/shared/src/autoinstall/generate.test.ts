import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createDefaultProfile } from './defaults.js'
import {
  buildAutoinstallObject,
  collectPackages,
  deepMerge,
  generateAutoinstallYaml,
  generateMetaData,
  generateUserData,
} from './generate.js'
import type { AutoinstallProfile } from './model.js'
import { validateProfile } from './validate.js'

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

function profile(overrides: (p: AutoinstallProfile) => AutoinstallProfile = (p) => p): AutoinstallProfile {
  const base = createDefaultProfile('24.04')
  return overrides({ ...base, user: { ...base.user, passwordHash: HASH } })
}

describe('buildAutoinstallObject', () => {
  it('既定プロファイルから必須キーが揃った autoinstall を作る', () => {
    const o = buildAutoinstallObject(profile())
    expect(o['version']).toBe(1)
    const identity = o['identity'] as Record<string, unknown>
    expect(identity['hostname']).toBe('ubuntu-server')
    expect(identity['realname']).toBe('Ubuntu User')
    expect(identity['username']).toBe('ubuntu')
    // password は「必ずクォートさせる」ため Scalar ノードにしてある
    expect(String((identity['password'] as { value: string }).value)).toBe(HASH)
    expect(o['shutdown']).toBe('reboot')
    expect(o['storage']).toEqual({ layout: { name: 'lvm', match: { size: 'largest' } } })
  })

  it('既定 (installer-default) では network キー自体を出力しない', () => {
    // subiquity の既定は eth*/en* で DHCPv4 を試し、アドレスを取れなかった NIC を無効化する。
    // 手書きの match より確実なのでキーを書かないのが正解。
    expect(buildAutoinstallObject(profile())['network']).toBeUndefined()
  })

  it('DHCP を明示すると match name en* + optional になる', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({ ...p, network: { mode: 'dhcp', target: { kind: 'any' }, optional: true } })),
    )
    expect(o['network']).toEqual({
      version: 2,
      ethernets: { 'any-ethernet': { match: { name: 'en*' }, dhcp4: true, optional: true } },
    })
  })

  it('storage の match: any は空マッピングになる', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        storage: { ...(p.storage as { mode: 'lvm' }), match: { kind: 'any' } } as typeof p.storage,
      })),
    )
    expect(o['storage']).toEqual({ layout: { name: 'lvm', match: {} } })
  })

  it('ptable を指定すると layout に出る', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        storage: { ...(p.storage as { mode: 'lvm' }), partitionTable: 'msdos' } as typeof p.storage,
      })),
    )
    expect((o['storage'] as { layout: Record<string, unknown> }).layout['ptable']).toBe('msdos')
  })

  it('sizing-policy と password は lvm 以外では出さない', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        storage: {
          mode: 'direct',
          match: { kind: 'largest' },
          useWholeDisk: true,
          encryptionPassphrase: 'secret-passphrase',
          disableSwap: false,
          partitionTable: 'default',
        },
      })),
    )
    const layout = (o['storage'] as { layout: Record<string, unknown> }).layout
    expect(layout['sizing-policy']).toBeUndefined()
    expect(layout['password']).toBeUndefined()
  })

  it('固定 IP は routes 形式で書き、非推奨の gateway4 を使わない', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        network: {
          mode: 'static',
          target: { kind: 'name', name: 'enp0s3' },
          address: '192.168.1.10/24',
          gateway: '192.168.1.1',
          nameservers: ['1.1.1.1', '8.8.8.8'],
          searchDomains: ['example.local'],
          optional: false,
        },
      })),
    )
    expect(o['network']).toEqual({
      version: 2,
      ethernets: {
        enp0s3: {
          dhcp4: false,
          addresses: ['192.168.1.10/24'],
          routes: [{ to: 'default', via: '192.168.1.1' }],
          nameservers: { addresses: ['1.1.1.1', '8.8.8.8'], search: ['example.local'] },
        },
      },
    })
    expect(JSON.stringify(o['network'])).not.toContain('gateway4')
  })

  it('22.04 では source / ubuntu-pro / kernel-crash-dumps を出さない', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        series: '22.04',
        software: { ...p.software, ubuntuProToken: 'C' + 'a'.repeat(25), kernelCrashDumps: true },
      })),
    )
    expect(o['source']).toBeUndefined()
    expect(o['kernel-crash-dumps']).toBeUndefined()
    expect(o['ubuntu-pro']).toBeUndefined()
    expect(o['ubuntu-advantage']).toEqual({ token: 'C' + 'a'.repeat(25) })
  })

  it('26.04 では ubuntu-pro と kernel-crash-dumps を出す', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        series: '26.04',
        software: { ...p.software, ubuntuProToken: 'C' + 'a'.repeat(25), kernelCrashDumps: false },
      })),
    )
    expect(o['ubuntu-pro']).toEqual({ token: 'C' + 'a'.repeat(25) })
    expect(o['kernel-crash-dumps']).toEqual({ enabled: false })
    expect(o['source']).toEqual({ id: 'ubuntu-server' })
  })

  it('プリセットのパッケージが packages にマージされ、重複しない', () => {
    const p = profile((x) => ({
      ...x,
      software: { ...x.software, packages: ['git', 'chrony'] },
      postInstall: { ...x.postInstall, presets: ['chrony-ntp', 'docker-ce'] },
    }))
    expect(collectPackages(p)).toEqual(['chrony', 'docker-compose-v2', 'docker.io', 'git'])
  })

  it('プリセットの late-commands が生成され、ユーザー名が埋まる', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        user: { ...p.user, username: 'ops' },
        postInstall: { ...p.postInstall, presets: ['sudo-nopasswd'] },
      })),
    )
    const late = o['late-commands'] as string[]
    expect(late[0]).toBe(
      "echo 'ops ALL=(ALL) NOPASSWD:ALL' > /target/etc/sudoers.d/90-autoinstall-ops",
    )
    expect(late[1]).toBe('chmod 0440 /target/etc/sudoers.d/90-autoinstall-ops')
  })

  it('追加ファイルは seed からコピーする late-commands になる', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        postInstall: {
          ...p.postInstall,
          files: [{ name: 'motd.txt', targetPath: '/etc/motd', mode: '0644', owner: 'root', content: 'hi' }],
        },
      })),
      { comments: 'none', seedMountPath: '/cdrom' },
    )
    const late = o['late-commands'] as string[]
    expect(late).toEqual([
      "mkdir -p '/target/etc'",
      "cp '/cdrom/motd.txt' '/target/etc/motd'",
      "chmod 0644 '/target/etc/motd'",
    ])
  })

  it("シングルクォートを含む late-command を安全にエスケープする", () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        user: { ...p.user, username: 'ops' },
        postInstall: {
          ...p.postInstall,
          files: [{ name: "it's.txt", targetPath: "/etc/it's", mode: '0644', owner: 'root', content: '' }],
        },
      })),
    )
    const late = o['late-commands'] as string[]
    expect(late.some((c) => c.includes(`'\\''`))).toBe(true)
  })

  it('上書き YAML が深くマージされる', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        advanced: { ...p.advanced, rawOverlayYaml: 'identity:\n  realname: Overridden\nkernel:\n  flavor: hwe\n' },
      })),
    )
    expect((o['identity'] as Record<string, unknown>)['realname']).toBe('Overridden')
    // マージなので username は残る
    expect((o['identity'] as Record<string, unknown>)['username']).toBe('ubuntu')
    expect(o['kernel']).toEqual({ flavor: 'hwe' })
  })

  it('生 storage YAML をそのまま使える', () => {
    const o = buildAutoinstallObject(
      profile((p) => ({
        ...p,
        storage: { mode: 'raw', yaml: 'config:\n  - type: disk\n    id: disk0\n    ptable: gpt\n' },
      })),
    )
    expect(o['storage']).toEqual({ config: [{ type: 'disk', id: 'disk0', ptable: 'gpt' }] })
  })
})

describe('generateUserData', () => {
  it('#cloud-config で始まり autoinstall キーを持つ', () => {
    const text = generateUserData(profile())
    expect(text.startsWith('#cloud-config\n')).toBe(true)
    const parsed = parse(text) as Record<string, unknown>
    expect(parsed['autoinstall']).toBeDefined()
    expect((parsed['autoinstall'] as Record<string, unknown>)['version']).toBe(1)
  })

  it('日本語コメントが付き、YAML として解析できる', () => {
    const text = generateUserData(profile(), { comments: 'ja' })
    expect(text).toContain('# インストール後の')
    expect(() => parse(text)).not.toThrow()
  })

  it('comments: none ならコメント無しでも同じ内容になる', () => {
    const withComments = parse(generateUserData(profile(), { comments: 'ja' }))
    const without = parse(generateUserData(profile(), { comments: 'none' }))
    expect(withComments).toEqual(without)
  })

  it('パスワードハッシュが $ を含んでも正しく往復する', () => {
    const parsed = parse(generateUserData(profile())) as {
      autoinstall: { identity: { password: string } }
    }
    expect(parsed.autoinstall.identity.password).toBe(HASH)
  })

  it('パスワードハッシュは必ず二重引用符で囲まれる', () => {
    // autoinstall リファレンスの明示的な推奨。YAML 的に不要でも従う。
    expect(generateUserData(profile())).toContain(`password: "${HASH}"`)
    expect(generateAutoinstallYaml(profile())).toContain(`password: "${HASH}"`)
  })

  it('コメントはキーの前に置かれ、キーと値の間に挟まらない', () => {
    const text = generateUserData(profile(), { comments: 'ja' })
    // 「# ...」の直後の行が値だけ、という壊れた見た目になっていないこと
    expect(text).toContain('  # autoinstall 設定の形式バージョン。現在は 1 のみ。\n  version: 1\n')
    expect(text).not.toMatch(/version:\n\s*#/)
  })

  it('同じプロファイルからは常に同じ YAML が出る（決定的）', () => {
    expect(generateUserData(profile())).toBe(generateUserData(profile()))
  })
})

describe('generateAutoinstallYaml', () => {
  it('cloud-config でラップしない単体形式を出す', () => {
    const text = generateAutoinstallYaml(profile())
    expect(text.startsWith('#cloud-config')).toBe(false)
    const parsed = parse(text) as Record<string, unknown>
    expect(parsed['version']).toBe(1)
    expect(parsed['identity']).toBeDefined()
  })
})

describe('generateMetaData', () => {
  it('instance-id を含む', () => {
    expect(generateMetaData('autoinstall-abc')).toBe('instance-id: autoinstall-abc\n')
  })
})

describe('deepMerge', () => {
  it('ネストしたマップを再帰的にマージし、配列は置き換える', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, d: [1, 2] }, { a: { c: 3 }, d: [9] })).toEqual({
      a: { b: 1, c: 3 },
      d: [9],
    })
  })
})

describe('validateProfile', () => {
  it('既定プロファイル + ハッシュなら合格する', () => {
    const r = validateProfile(profile())
    expect(r.ok).toBe(true)
  })

  it('パスワードが平文ならエラー', () => {
    const r = validateProfile(profile((p) => ({ ...p, user: { ...p.user, passwordHash: 'ubuntu' } })))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'user.passwordHash' && i.severity === 'error')).toBe(true)
  })

  it('SSH ハードニング + 鍵なしはロックアウトとしてエラー', () => {
    const r = validateProfile(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, presets: ['ssh-harden'] } })),
    )
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'ssh.authorizedKeys')).toBe(true)
  })

  it('パスワード認証禁止 + 鍵なしもエラー', () => {
    const r = validateProfile(
      profile((p) => ({ ...p, ssh: { ...p.ssh, allowPasswordAuth: false } })),
    )
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'ssh.allowPasswordAuth')).toBe(true)
  })

  it('予約ユーザー名を拒否する', () => {
    const r = validateProfile(profile((p) => ({ ...p, user: { ...p.user, username: 'root' } })))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'user.username')).toBe(true)
  })

  it('不正なホスト名を拒否する', () => {
    const r = validateProfile(profile((p) => ({ ...p, basics: { ...p.basics, hostname: '-bad-' } })))
    expect(r.ok).toBe(false)
  })

  it('固定 IP のサブネット表記漏れを検出する', () => {
    const r = validateProfile(
      profile((p) => ({
        ...p,
        network: {
          mode: 'static',
          target: { kind: 'any' },
          address: '192.168.1.10',
          gateway: '192.168.1.1',
          nameservers: ['1.1.1.1'],
          searchDomains: [],
          optional: false,
        },
      })),
    )
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'network.address')).toBe(true)
  })

  it('壊れた SSH 鍵を検出する', () => {
    const r = validateProfile(
      profile((p) => ({ ...p, ssh: { ...p.ssh, authorizedKeys: ['not a key'] } })),
    )
    expect(r.ok).toBe(false)
  })

  it('正しい SSH 鍵は通す', () => {
    const r = validateProfile(
      profile((p) => ({
        ...p,
        ssh: { ...p.ssh, authorizedKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample user@host'] },
      })),
    )
    expect(r.ok).toBe(true)
  })

  it('カーネル引数の危険な文字を拒否する', () => {
    const r = validateProfile(
      profile((p) => ({ ...p, advanced: { ...p.advanced, extraKernelArgs: 'foo; rm -rf /' } })),
    )
    expect(r.ok).toBe(false)
  })

  it('上書き YAML の構文エラーを検出する', () => {
    const r = validateProfile(
      profile((p) => ({ ...p, advanced: { ...p.advanced, rawOverlayYaml: 'a:\n  - b\n c: [' } })),
    )
    expect(r.ok).toBe(false)
  })
})
