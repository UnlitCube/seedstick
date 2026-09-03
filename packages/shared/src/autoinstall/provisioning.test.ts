import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createDefaultProfile } from './defaults.js'
import { collectFirstBootCommands, collectLateCommands, collectPackages, generateUserData } from './generate.js'
import { SEED_MOUNT_PATH } from './generate-provisioning.js'
import { migrateProfile, summarizeProfile } from './migrate.js'
import {
  CUDA_REPO_DISTRO,
  cudaKeyringUrl,
  cudaPackages,
  detectArchiveFormat,
  isValidServiceName,
  renderServiceUnit,
  type AdditionalUser,
  type Deployment,
  type SystemdService,
} from './provisioning.js'
import { validateProfile } from './validate.js'
import type { AutoinstallProfile } from './model.js'

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'
const SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample deploy@example'

function profile(fn: (p: AutoinstallProfile) => AutoinstallProfile = (p) => p): AutoinstallProfile {
  const base = createDefaultProfile('24.04')
  return fn({ ...base, user: { ...base.user, passwordHash: HASH } })
}

function user(overrides: Partial<AdditionalUser> = {}): AdditionalUser {
  return {
    id: 'u1',
    username: 'deploy',
    realname: 'Deploy Bot',
    passwordHash: '',
    sudo: 'none',
    groups: [],
    shell: '/bin/bash',
    sshAuthorizedKeys: [],
    createHome: true,
    systemAccount: false,
    ...overrides,
  }
}

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 'd1',
    kind: 'archive',
    name: 'app.tar.gz',
    source: { kind: 'host-file', path: 'C:/tmp/app.tar.gz', sizeBytes: 1024 },
    targetPath: '/opt/myapp',
    owner: 'deploy',
    group: 'deploy',
    mode: '0644',
    archiveFormat: 'tar.gz',
    postCommand: '',
    chownRecursive: true,
    ...overrides,
  }
}

function service(overrides: Partial<SystemdService> = {}): SystemdService {
  return {
    id: 's1',
    name: 'myapp',
    description: 'My application',
    execStart: '/opt/myapp/bin/server',
    execStartPre: '',
    workingDirectory: '/opt/myapp',
    user: 'deploy',
    group: 'deploy',
    environment: ['NODE_ENV=production'],
    environmentFile: '',
    serviceType: 'simple',
    restart: 'on-failure',
    restartSec: 5,
    after: ['network-online.target'],
    wantedBy: 'multi-user.target',
    enabled: true,
    ...overrides,
  }
}

describe('追加ユーザー', () => {
  it('useradd と chpasswd -e を in-target で実行する', () => {
    const late = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: { ...p.postInstall, additionalUsers: [user({ passwordHash: HASH })] },
      })),
    )
    const joined = late.join('\n')
    expect(joined).toContain('id -u deploy >/dev/null 2>&1 || useradd')
    expect(joined).toContain('-m')
    expect(joined).toContain("-s /bin/bash")
    // ハッシュには $ が含まれるので、シェルに展開されないようクォートされていること
    expect(joined).toContain(String.raw`echo '\''deploy:` + HASH + String.raw`'\'' | chpasswd -e`)
  })

  it('パスワードが無ければアカウントをロックする', () => {
    const late = collectLateCommands(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, additionalUsers: [user()] } })),
    )
    expect(late.join('\n')).toContain('passwd -l deploy')
    expect(late.join('\n')).not.toContain('chpasswd')
  })

  it('sudo: nopasswd は sudoers.d に書き、password は sudo グループに入れる', () => {
    const nopass = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: { ...p.postInstall, additionalUsers: [user({ sudo: 'nopasswd' })] },
      })),
    ).join('\n')
    expect(nopass).toContain('/target/etc/sudoers.d/90-autoinstall-deploy')
    expect(nopass).toContain('chmod 0440')

    const withPass = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: { ...p.postInstall, additionalUsers: [user({ sudo: 'password' })] },
      })),
    ).join('\n')
    expect(withPass).toContain('usermod -aG sudo deploy')
    expect(withPass).not.toContain('sudoers.d')
  })

  it('SSH 鍵を authorized_keys に配置し権限を締める', () => {
    const late = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: { ...p.postInstall, additionalUsers: [user({ sshAuthorizedKeys: [SSH_KEY] })] },
      })),
    ).join('\n')
    expect(late).toContain('/home/deploy/.ssh')
    expect(late).toContain(SSH_KEY)
    expect(late).toContain('chmod 0700 /home/deploy/.ssh')
    expect(late).toContain('chmod 0600 /home/deploy/.ssh/authorized_keys')
    expect(late).toContain('chown -R deploy:deploy /home/deploy/.ssh')
  })

  it('システムアカウントは -r と /var/lib のホームになる', () => {
    const late = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: {
          ...p.postInstall,
          additionalUsers: [user({ systemAccount: true, sshAuthorizedKeys: [SSH_KEY] })],
        },
      })),
    ).join('\n')
    expect(late).toContain('useradd -r')
    expect(late).toContain('/var/lib/deploy/.ssh')
  })

  it('追加グループを -G で渡す', () => {
    const late = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: { ...p.postInstall, additionalUsers: [user({ groups: ['docker', 'adm'] })] },
      })),
    ).join('\n')
    // inTargetSh 経由なので内側の ' は '\'' にエスケープされる
    expect(late).toContain(String.raw`-G '\''docker,adm'\''`)
  })
})

describe('アプリの展開', () => {
  it('CIDATA をマウントしてから展開し、最後にアンマウントする', () => {
    const late = collectLateCommands(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, deployments: [deployment()] } })),
    )
    expect(late[0]).toBe(`mkdir -p ${SEED_MOUNT_PATH}`)
    expect(late[1]).toContain('mount -L CIDATA')
    expect(late.at(-1)).toBe(`umount ${SEED_MOUNT_PATH} || true`)
  })

  it('アーカイブは /target 内へ退避してから in-target で展開する', () => {
    const late = collectLateCommands(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, deployments: [deployment()] } })),
    ).join('\n')
    expect(late).toContain(`cp '${SEED_MOUNT_PATH}/app.tar.gz' '/target/var/tmp/autoinstall-app.tar.gz'`)
    expect(late).toContain('curtin in-target -- mkdir -p /opt/myapp')
    expect(late).toContain('tar -xzf')
    expect(late).toContain(String.raw`-C '\''/opt/myapp'\''`)
    // 退避したファイルは片付ける
    expect(late).toContain("rm -f '/target/var/tmp/autoinstall-app.tar.gz'")
    expect(late).toContain('chown -R deploy:deploy /opt/myapp')
  })

  it.each([
    ['tar.gz' as const, 'tar -xzf'],
    ['tar.xz' as const, 'tar -xJf'],
    ['tar.bz2' as const, 'tar -xjf'],
    ['tar' as const, 'tar -xf'],
    ['zip' as const, 'unzip -o'],
  ])('%s は %s で展開する', (format, expected) => {
    const late = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: { ...p.postInstall, deployments: [deployment({ archiveFormat: format })] },
      })),
    ).join('\n')
    expect(late).toContain(expected)
  })

  it('展開に必要なパッケージが packages に入る', () => {
    const pkgs = collectPackages(
      profile((p) => ({
        ...p,
        postInstall: {
          ...p.postInstall,
          deployments: [
            deployment({ archiveFormat: 'zip', name: 'a.zip' }),
            deployment({ id: 'd2', archiveFormat: 'tar.xz', name: 'b.tar.xz' }),
          ],
        },
      })),
    )
    expect(pkgs).toContain('unzip')
    expect(pkgs).toContain('xz-utils')
  })

  it('展開後コマンドは展開先ディレクトリで実行する', () => {
    const late = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: {
          ...p.postInstall,
          deployments: [deployment({ postCommand: 'npm ci --omit=dev' })],
        },
      })),
    ).join('\n')
    // sh -c に渡すので二重にクォートされる（内側の ' は '\'' にエスケープされる）
    expect(late).toContain(String.raw`sh -c 'cd '\''/opt/myapp'\'' && npm ci --omit=dev'`)
  })

  it('単一ファイルはコピーして権限を設定する', () => {
    const late = collectLateCommands(
      profile((p) => ({
        ...p,
        postInstall: {
          ...p.postInstall,
          deployments: [
            deployment({
              kind: 'file',
              name: 'app.conf',
              targetPath: '/etc/myapp/app.conf',
              mode: '0640',
              owner: 'deploy',
            }),
          ],
        },
      })),
    ).join('\n')
    expect(late).toContain("mkdir -p '/target/etc/myapp'")
    expect(late).toContain(`cp '${SEED_MOUNT_PATH}/app.conf' '/target/etc/myapp/app.conf'`)
    expect(late).toContain("chmod 0640 '/target/etc/myapp/app.conf'")
    expect(late).toContain('chown deploy:deploy /etc/myapp/app.conf')
  })

  it('URL 取得は late-commands ではなく初回起動時に行う', () => {
    const p = profile((x) => ({
      ...x,
      postInstall: {
        ...x.postInstall,
        deployments: [
          deployment({
            source: { kind: 'url', url: 'https://example.com/app.tar.gz', sha256: 'a'.repeat(64) },
          }),
        ],
      },
    }))
    // seed のマウントは不要
    expect(collectLateCommands(p).join('\n')).not.toContain(SEED_MOUNT_PATH)
    const first = collectFirstBootCommands(p).join('\n')
    expect(first).toContain('curl -fsSL --retry 3')
    expect(first).toContain('https://example.com/app.tar.gz')
    expect(first).toContain('sha256sum -c -')
    expect(collectPackages(p)).toContain('curl')
  })

  it('展開が無ければ CIDATA をマウントしない', () => {
    expect(collectLateCommands(profile()).join('\n')).not.toContain(SEED_MOUNT_PATH)
  })

  it('拡張子からアーカイブ形式を判定する', () => {
    expect(detectArchiveFormat('app.tar.gz')).toBe('tar.gz')
    expect(detectArchiveFormat('app.tgz')).toBe('tar.gz')
    expect(detectArchiveFormat('app.TAR.XZ')).toBe('tar.xz')
    expect(detectArchiveFormat('app.zip')).toBe('zip')
    expect(detectArchiveFormat('app.bin')).toBeNull()
  })
})

describe('systemd サービス', () => {
  it('ユニットファイルの内容が systemd の書式になる', () => {
    const unit = renderServiceUnit(service())
    expect(unit).toContain('[Unit]')
    expect(unit).toContain('Description=My application')
    expect(unit).toContain('After=network-online.target')
    // After=network-online.target には Wants も必要（systemd の作法）
    expect(unit).toContain('Wants=network-online.target')
    expect(unit).toContain('[Service]')
    expect(unit).toContain('Type=simple')
    expect(unit).toContain('User=deploy')
    expect(unit).toContain('WorkingDirectory=/opt/myapp')
    expect(unit).toContain('Environment=NODE_ENV=production')
    expect(unit).toContain('ExecStart=/opt/myapp/bin/server')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('RestartSec=5')
    expect(unit).toContain('[Install]')
    expect(unit).toContain('WantedBy=multi-user.target')
  })

  it('Restart=no のときは RestartSec を出さない', () => {
    const unit = renderServiceUnit(service({ restart: 'no' }))
    expect(unit).not.toContain('Restart=')
    expect(unit).not.toContain('RestartSec')
  })

  it('ユニットを配置して enable する', () => {
    const late = collectLateCommands(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, services: [service()] } })),
    ).join('\n')
    expect(late).toContain('/etc/systemd/system/myapp.service')
    expect(late).toContain('AUTOINSTALL_EOF')
    expect(late).toContain('chmod 0644 /etc/systemd/system/myapp.service')
    expect(late).toContain('systemctl enable myapp.service')
  })

  it('enabled: false なら enable しない', () => {
    const late = collectLateCommands(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, services: [service({ enabled: false })] } })),
    ).join('\n')
    expect(late).toContain('/etc/systemd/system/myapp.service')
    expect(late).not.toContain('systemctl enable')
  })

  it('サービス名の検証', () => {
    expect(isValidServiceName('myapp')).toBe(true)
    expect(isValidServiceName('my-app_1')).toBe(true)
    expect(isValidServiceName('myapp.service')).toBe(false)
    expect(isValidServiceName('my app')).toBe(false)
    expect(isValidServiceName('')).toBe(false)
  })
})

describe('apt full-upgrade', () => {
  it('in-target で update → full-upgrade → autoremove を実行する', () => {
    const late = collectLateCommands(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, aptFullUpgrade: true } })),
    )
    const joined = late.join('\n')
    expect(joined).toContain('curtin in-target -- apt-get update')
    expect(joined).toContain('apt-get -y full-upgrade')
    expect(joined).toContain('autoremove --purge')
    expect(joined).toContain('DEBIAN_FRONTEND=noninteractive')
  })
})

describe('GPU / CUDA', () => {
  const gpuProfile = (overrides: Partial<AutoinstallProfile['software']['gpu']> = {}) =>
    profile((p) => ({
      ...p,
      software: { ...p.software, gpu: { ...p.software.gpu, enabled: true, ...overrides } },
    }))

  it('keyring URL がシリーズごとに正しい', () => {
    expect(cudaKeyringUrl('22.04')).toContain('/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb')
    expect(cudaKeyringUrl('24.04')).toContain('/repos/ubuntu2404/')
    expect(cudaKeyringUrl('26.04')).toContain('/repos/ubuntu2604/')
    // NVIDIA は 25.10 向けのリポジトリを公開していない（実測で 404）
    expect(cudaKeyringUrl('25.10')).toBeNull()
    expect(CUDA_REPO_DISTRO['25.10']).toBeNull()
  })

  it('ドライバの選択がパッケージ名に反映される', () => {
    const base = { enabled: true, setupPath: true, containerToolkit: false, toolkit: 'none' }
    expect(cudaPackages({ ...base, driver: 'open' })).toEqual(['nvidia-open'])
    expect(cudaPackages({ ...base, driver: 'proprietary' })).toEqual(['cuda-drivers'])
    expect(cudaPackages({ ...base, driver: 'none' })).toEqual([])
  })

  it('ツールキットの選択がパッケージ名に反映される', () => {
    const base = { enabled: true, setupPath: true, containerToolkit: false, driver: 'none' as const }
    expect(cudaPackages({ ...base, toolkit: 'latest' })).toEqual(['cuda-toolkit'])
    expect(cudaPackages({ ...base, toolkit: 'cuda-toolkit-13-3' })).toEqual(['cuda-toolkit-13-3'])
    expect(cudaPackages({ ...base, toolkit: 'none' })).toEqual([])
  })

  it('初回起動時に keyring を入れてから apt install する', () => {
    const first = collectFirstBootCommands(gpuProfile()).join('\n')
    expect(first).toContain('cuda-keyring_1.1-1_all.deb')
    expect(first).toContain('dpkg -i /var/tmp/cuda-keyring.deb')
    expect(first).toContain('apt-get update')
    expect(first).toContain('apt-get install -y nvidia-open cuda-toolkit')
    // keyring を入れる前に apt install してはいけない
    expect(first.indexOf('dpkg -i')).toBeLessThan(first.indexOf('apt-get install'))
  })

  it('PATH の設定を /etc/profile.d に書く', () => {
    const first = collectFirstBootCommands(gpuProfile({ setupPath: true })).join('\n')
    expect(first).toContain('/etc/profile.d/cuda.sh')
    expect(first).toContain('/usr/local/cuda/bin')
    expect(first).toContain('/usr/local/cuda/lib64')
  })

  it('ドライバを入れる場合は最後に再起動する', () => {
    const first = collectFirstBootCommands(gpuProfile({ driver: 'open' }))
    expect(first.at(-1)).toBe('systemctl reboot')
  })

  it('ドライバ無し（ツールキットのみ）なら再起動しない', () => {
    const first = collectFirstBootCommands(gpuProfile({ driver: 'none', toolkit: 'latest' }))
    expect(first.join('\n')).not.toContain('systemctl reboot')
  })

  it('container-toolkit を選ぶとリポジトリ追加と nvidia-ctk 設定が入る', () => {
    const first = collectFirstBootCommands(gpuProfile({ containerToolkit: true })).join('\n')
    expect(first).toContain('nvidia-container-toolkit-keyring.gpg')
    expect(first).toContain('nvidia-container-toolkit')
    expect(first).toContain('nvidia-ctk runtime configure --runtime=docker')
  })

  it('25.10 では検証エラーになる', () => {
    const p = profile((x) => ({
      ...x,
      series: '25.10',
      software: { ...x.software, gpu: { ...x.software.gpu, enabled: true } },
    }))
    const r = validateProfile(p)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'software.gpu' && i.severity === 'error')).toBe(true)
  })

  it('GPU が無効なら runcmd に何も出ない', () => {
    expect(collectFirstBootCommands(profile())).toEqual([])
  })
})

describe('生成された YAML の整合性', () => {
  it('プロビジョニングを盛り込んでも YAML として解析できる', () => {
    const p = profile((x) => ({
      ...x,
      postInstall: {
        ...x.postInstall,
        additionalUsers: [user({ passwordHash: HASH, sshAuthorizedKeys: [SSH_KEY], sudo: 'nopasswd' })],
        deployments: [deployment({ postCommand: 'npm ci' })],
        services: [service()],
        aptFullUpgrade: true,
      },
      software: { ...x.software, gpu: { ...x.software.gpu, enabled: true } },
    }))
    const text = generateUserData(p)
    const parsed = parse(text) as {
      autoinstall: { 'late-commands': string[]; 'user-data': { runcmd: string[] } }
    }
    expect(parsed.autoinstall['late-commands'].length).toBeGreaterThan(10)
    expect(parsed.autoinstall['user-data'].runcmd.length).toBeGreaterThan(3)
    // ヒアドキュメントの改行が YAML を壊していないこと
    expect(parsed.autoinstall['late-commands'].some((c) => c.includes('AUTOINSTALL_EOF'))).toBe(true)
  })

  it('検証を通る', () => {
    const p = profile((x) => ({
      ...x,
      postInstall: {
        ...x.postInstall,
        additionalUsers: [user({ passwordHash: HASH })],
        deployments: [deployment()],
        services: [service()],
      },
    }))
    const r = validateProfile(p)
    expect(r.ok, r.issues.map((i) => i.messageJa).join(' / ')).toBe(true)
  })

  it('存在しないユーザーでサービスを動かすと警告する', () => {
    const r = validateProfile(
      profile((x) => ({
        ...x,
        postInstall: { ...x.postInstall, services: [service({ user: 'ghost' })] },
      })),
    )
    expect(r.issues.some((i) => i.field.endsWith('.user') && i.severity === 'warning')).toBe(true)
  })

  it('ユーザー名の重複をエラーにする', () => {
    const r = validateProfile(
      profile((x) => ({
        ...x,
        postInstall: { ...x.postInstall, additionalUsers: [user({ username: 'ubuntu' })] },
      })),
    )
    expect(r.ok).toBe(false)
  })

  it('サービス名の重複をエラーにする', () => {
    const r = validateProfile(
      profile((x) => ({
        ...x,
        postInstall: { ...x.postInstall, services: [service(), service({ id: 's2' })] },
      })),
    )
    expect(r.ok).toBe(false)
  })
})

describe('プロファイルの読み込み・移行', () => {
  it('v1 のプロファイルを v2 に移行し、新セクションを既定で埋める', () => {
    const v1 = {
      profileVersion: 1,
      meta: { name: 'old', createdAt: '2026-01-01T00:00:00.000Z', toolVersion: 'x/0.0.1' },
      series: '22.04',
      basics: { locale: 'ja_JP.UTF-8', keyboard: { layout: 'jp', variant: '', toggle: null }, timezone: 'Asia/Tokyo', hostname: 'old-host' },
      user: { realname: 'Old', username: 'old', passwordHash: HASH, sudoNoPassword: true },
      ssh: { installServer: true, authorizedKeys: [SSH_KEY], allowPasswordAuth: false },
      network: { mode: 'installer-default' },
      storage: { mode: 'lvm', match: { kind: 'largest' }, useWholeDisk: true, encryptionPassphrase: '', disableSwap: false, partitionTable: 'default' },
      software: { sourceId: 'ubuntu-server', packages: ['vim'], snaps: [], updates: 'all', installDrivers: false, kernelCrashDumps: null, ubuntuProToken: '' },
      apt: { mode: 'default', countryCode: '', primaryUri: '', proxy: '', disableComponents: [] },
      postInstall: { presets: ['chrony-ntp'], lateCommands: [], firstBootCommands: [], files: [] },
      behavior: { interactiveSections: [], shutdown: 'reboot', refreshInstaller: false, reportToConsole: true },
      advanced: { rawOverlayYaml: '', extraKernelArgs: '' },
    }
    const { profile: p, notes } = migrateProfile(v1)
    expect(p.profileVersion).toBe(2)
    expect(p.series).toBe('22.04')
    expect(p.basics.hostname).toBe('old-host')
    expect(p.user.username).toBe('old')
    expect(p.software.packages).toEqual(['vim'])
    expect(p.postInstall.presets).toEqual(['chrony-ntp'])
    // 新セクションは既定
    expect(p.postInstall.additionalUsers).toEqual([])
    expect(p.postInstall.services).toEqual([])
    expect(p.software.gpu.enabled).toBe(false)
    expect(notes.some((n) => n.includes('古い形式'))).toBe(true)
  })

  it('壊れた JSON でも既定プロファイルを返す', () => {
    expect(migrateProfile(null).profile.series).toBe('24.04')
    expect(migrateProfile('nonsense').notes.length).toBeGreaterThan(0)
    expect(migrateProfile([]).profile.user.username).toBe('ubuntu')
  })

  it('未対応バージョンは既定に戻して知らせる', () => {
    const { profile: p, notes } = migrateProfile({ profileVersion: 2, series: '18.04' })
    expect(p.series).toBe('24.04')
    expect(notes.some((n) => n.includes('対応していない Ubuntu バージョン'))).toBe(true)
  })

  it('新しいバージョンで保存されたファイルは注意を出す', () => {
    const { notes } = migrateProfile({ profileVersion: 99, series: '24.04' })
    expect(notes.some((n) => n.includes('新しいバージョン'))).toBe(true)
  })

  it('network の mode が変わっていれば丸ごと採用する', () => {
    const { profile: p } = migrateProfile({
      profileVersion: 2,
      network: {
        mode: 'static',
        target: { kind: 'any' },
        address: '10.0.0.5/24',
        gateway: '10.0.0.1',
        nameservers: ['1.1.1.1'],
        searchDomains: [],
        optional: false,
      },
    })
    expect(p.network.mode).toBe('static')
    expect(p.network.mode === 'static' && p.network.address).toBe('10.0.0.5/24')
  })

  it('未知の mode は既定に戻す', () => {
    const { profile: p } = migrateProfile({ profileVersion: 2, network: { mode: 'bogus' } })
    expect(p.network.mode).toBe('installer-default')
  })

  it('要約に設定内容のバッジ情報が入る', () => {
    const p = profile((x) => ({
      ...x,
      postInstall: {
        ...x.postInstall,
        additionalUsers: [user(), user({ id: 'u2', username: 'ops' })],
        services: [service()],
      },
      software: { ...x.software, gpu: { ...x.software.gpu, enabled: true } },
    }))
    const s = summarizeProfile('abc', '2026-09-03T00:00:00.000Z', p)
    expect(s.id).toBe('abc')
    expect(s.highlights.additionalUsers).toBe(2)
    expect(s.highlights.services).toBe(1)
    expect(s.highlights.gpu).toBe(true)
    expect(s.highlights.staticIp).toBe(false)
  })
})
