import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import Ajv2020, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { createDefaultProfile } from './defaults.js'
import { buildAutoinstallObject, generateUserData } from './generate.js'
import type { AutoinstallProfile, UbuntuSeries } from './model.js'
import type { AdditionalUser, Deployment, SystemdService } from './provisioning.js'

// subiquity 公式の autoinstall-schema.json で、生成した設定が実際に受理されるかを確かめる。
// スキーマは各リリースのタグから取得したもの（docs/research/schema/）。
// 「YAML として解析できる」よりずっと強い保証で、キー名や型の間違いをここで捕まえられる。

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/research/schema')

const SCHEMA_FILES: Record<UbuntuSeries, string> = {
  '22.04': 'autoinstall-schema.22.04.2.json',
  '24.04': 'autoinstall-schema.24.04.4.json',
  '25.10': 'autoinstall-schema.25.10.json',
  '26.04': 'autoinstall-schema.26.04.1.json',
}

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'
const SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample admin@example'

function validatorFor(series: UbuntuSeries): (data: unknown) => ErrorObject[] | null {
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8')) as object
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  return (data: unknown) => (validate(data) ? null : (validate.errors ?? []))
}

function describeErrors(errors: ErrorObject[] | null): string {
  if (!errors) return ''
  return errors.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join('\n')
}

/**
 * `buildAutoinstallObject` はクォートを強制するために yaml の Scalar ノードを混ぜる。
 * スキーマ検証にかけるときは素の値に戻す（YAML に書き出せば同じものになる）。
 */
function toPlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if ('value' in value && Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    return (value as { value: unknown }).value
  }
  if (Array.isArray(value)) return value.map(toPlain)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]))
}

function base(series: UbuntuSeries): AutoinstallProfile {
  const p = createDefaultProfile(series)
  return {
    ...p,
    basics: { ...p.basics, hostname: 'schema-host' },
    user: { ...p.user, passwordHash: HASH },
  }
}

const additionalUser: AdditionalUser = {
  id: 'u1',
  username: 'deploy',
  realname: 'Deploy',
  passwordHash: HASH,
  sudo: 'nopasswd',
  groups: ['docker'],
  shell: '/bin/bash',
  sshAuthorizedKeys: [SSH_KEY],
  createHome: true,
  systemAccount: false,
}

const deployment: Deployment = {
  id: 'd1',
  kind: 'archive',
  name: 'app.tar.gz',
  source: { kind: 'host-file', path: '/tmp/app.tar.gz', sizeBytes: 10 },
  targetPath: '/opt/app',
  owner: 'deploy',
  group: 'deploy',
  mode: '0644',
  archiveFormat: 'tar.gz',
  postCommand: 'ls',
  chownRecursive: true,
}

const service: SystemdService = {
  id: 's1',
  name: 'app',
  description: 'App',
  execStart: '/opt/app/run',
  execStartPre: '',
  workingDirectory: '/opt/app',
  user: 'deploy',
  group: 'deploy',
  environment: ['A=1'],
  environmentFile: '',
  serviceType: 'simple',
  restart: 'always',
  restartSec: 3,
  after: ['network-online.target'],
  wantedBy: 'multi-user.target',
  enabled: true,
}

/** 全機能を盛り込んだプロファイル。ここが通ればまず落ちない。 */
function everything(series: UbuntuSeries): AutoinstallProfile {
  const p = base(series)
  return {
    ...p,
    basics: { ...p.basics, locale: 'ja_JP.UTF-8', timezone: 'Asia/Tokyo' },
    user: { ...p.user, groups: { mode: 'append', groups: ['docker', 'adm'] } },
    ssh: { installServer: true, authorizedKeys: [SSH_KEY], allowPasswordAuth: false },
    network: {
      mode: 'static',
      target: { kind: 'name', name: 'enp0s3' },
      address: '192.168.1.10/24',
      gateway: '192.168.1.1',
      nameservers: ['1.1.1.1'],
      searchDomains: ['example.local'],
      optional: true,
    },
    storage: {
      mode: 'lvm',
      match: { kind: 'serial', serial: 'CT*' },
      useWholeDisk: true,
      encryptionPassphrase: 'passphrase-1234',
      swap: { mode: 'size', size: '4G' },
      partitionTable: 'gpt',
      resetPartition: { enabled: true, size: '12G' },
    },
    software: {
      ...p.software,
      packages: ['vim', 'curl'],
      snaps: [{ name: 'microk8s', channel: '1.30/stable', classic: true }],
      updates: 'all',
      installDrivers: true,
      kernelCrashDumps: series === '25.10' || series === '26.04' ? true : null,
      ubuntuProToken: `C${'a'.repeat(25)}`,
      gpu: { ...p.software.gpu, enabled: series !== '25.10' },
      kernel: { mode: 'flavor', flavor: 'hwe' },
      searchDrivers: true,
      codecs: true,
      oem: 'no',
    },
    apt: {
      mode: 'custom',
      countryCode: 'JP',
      primaryUri: 'http://jp.archive.ubuntu.com/ubuntu',
      proxy: 'http://proxy.local:3142',
      disableComponents: ['multiverse'],
      sources: [
        { id: 'a', name: 'ppa.list', source: 'ppa:ansible/ansible', key: '' },
        {
          id: 'b',
          name: 'vendor.list',
          source: 'deb https://example.com/apt stable main',
          key: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----',
        },
      ],
      preserveSourcesList: false,
      fallback: 'offline-install',
    },
    postInstall: {
      presets: ['chrony-ntp', 'docker-ce', 'ufw-allow-ssh'],
      lateCommands: ['curtin in-target -- echo hi'],
      firstBootCommands: ['echo first-boot'],
      files: [{ name: 'motd', targetPath: '/etc/motd', mode: '0644', owner: 'root', content: 'hi' }],
      additionalUsers: [additionalUser],
      deployments: [deployment],
      services: [service],
      aptFullUpgrade: true,
      errorCommands: ['echo failed'],
      collectLogsOnError: true,
      debconfSelections: 'ufw ufw/enable boolean true',
    },
    activeDirectory: { enabled: true, adminName: 'admin', domainName: 'ad.example.com' },
    behavior: {
      ...p.behavior,
      shutdown: 'poweroff',
      refreshInstaller: true,
      refreshInstallerChannel: 'stable/ubuntu-24.04',
      reporting: { kind: 'webhook', endpoint: 'https://example.com/hook' },
      interactiveAll: false,
      interactiveSections: [],
    },
  }
}

const SERIES: UbuntuSeries[] = ['22.04', '24.04', '25.10', '26.04']

describe.each(SERIES)('公式スキーマ検証 (%s)', (series) => {
  const validate = validatorFor(series)

  it('既定プロファイルの生成結果がスキーマを通る', () => {
    const errors = validate(toPlain(buildAutoinstallObject(base(series), { comments: 'none' })))
    expect(describeErrors(errors)).toBe('')
  })

  it('全機能を盛り込んだ生成結果がスキーマを通る', () => {
    const errors = validate(toPlain(buildAutoinstallObject(everything(series), { comments: 'none' })))
    expect(describeErrors(errors)).toBe('')
  })

  it('YAML に書き出して読み戻したものもスキーマを通る', () => {
    // Scalar ノードや複数行文字列を経由しても壊れないことの確認
    const text = generateUserData(everything(series), { comments: 'ja' })
    const parsed = parse(text) as { autoinstall: unknown }
    expect(describeErrors(validate(parsed.autoinstall))).toBe('')
  })

  it('実行時に値を決める設定でも、置換前の状態がそのまま妥当', () => {
    // early-commands の実行前にスキーマ検証が走る
    // （subiquity の load_autoinstall_config(only_early=True) が validate_autoinstall を呼ぶ）。
    // かつては YAML にプレースホルダを埋めていたが、PyYAML が引用符を付け直すため
    // テキスト置換では正しく戻せなかった。今は既定値をそのまま書き、
    // early-commands が YAML を読み書きして差し替える。
    const p: AutoinstallProfile = {
      ...everything(series),
      runtimeValues: {
        hostname: 'kernel-arg',
        network: 'kernel-arg',
        disk: 'kernel-arg',
        presets: [],
        offerInteractiveEntry: true,
      },
    }
    const built = toPlain(buildAutoinstallObject(p, { comments: 'none' })) as Record<string, unknown>
    // プレースホルダは 1 つも残らない（early-commands のスクリプト本体を除く）
    const withoutEarly = { ...built }
    delete withoutEarly['early-commands']
    expect(JSON.stringify(withoutEarly)).not.toMatch(/@@AI_/)
    // 既定値がそのまま入っているので、引数なしで起動しても有効な設定になる
    expect((built['identity'] as { hostname: string }).hostname).toBe('schema-host')
    expect(describeErrors(validate(built))).toBe('')
  })

  it('対話セクションを指定してもスキーマを通る', () => {
    const p: AutoinstallProfile = {
      ...base(series),
      runtimeValues: {
        hostname: 'interactive',
        network: 'interactive',
        disk: 'interactive',
        presets: [],
        offerInteractiveEntry: false,
      },
    }
    expect(describeErrors(validate(toPlain(buildAutoinstallObject(p, { comments: 'none' }))))).toBe('')
  })

  it('interactive-sections: ["*"] もスキーマを通る', () => {
    const p: AutoinstallProfile = {
      ...base(series),
      behavior: { ...base(series).behavior, interactiveAll: true },
    }
    expect(describeErrors(validate(toPlain(buildAutoinstallObject(p, { comments: 'none' }))))).toBe('')
  })

  it('curtin の生 storage 設定もスキーマを通る', () => {
    const p: AutoinstallProfile = {
      ...base(series),
      storage: {
        mode: 'raw',
        yaml: 'config:\n  - {type: disk, id: disk0, ptable: gpt, match: {size: largest}}\n',
      },
    }
    expect(describeErrors(validate(toPlain(buildAutoinstallObject(p, { comments: 'none' }))))).toBe('')
  })

  it('スキーマが実際に不正を弾くこと（検証が機能している証明）', () => {
    // version は 1 のみ。2 を入れれば必ず落ちるはず。
    const bad = { ...(toPlain(buildAutoinstallObject(base(series), { comments: 'none' })) as object), version: 2 }
    expect(validate(bad)).not.toBeNull()
  })
})
