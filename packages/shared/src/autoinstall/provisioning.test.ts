import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { createDefaultProfile } from './defaults.js'
import { collectFirstBootCommands, collectLateCommands, collectPackages, generateUserData } from './generate.js'
import { SEED_MOUNT_PATH, deploymentFirstBootCommands } from './generate-provisioning.js'
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
    // ユーザー名もシェルも自由入力なので必ずクォートされていること
    // （inTargetSh が全体を再度クォートするので、内側の ' は '\'' になる）
    expect(joined).toContain(String.raw`id -u '\''deploy'\'' >/dev/null 2>&1 || useradd`)
    expect(joined).toContain('-m')
    expect(joined).toContain(String.raw`-s '\''/bin/bash'\''`)
    // ハッシュには $ が含まれるので、シェルに展開されないようクォートされていること
    expect(joined).toContain(String.raw`echo '\''deploy:` + HASH + String.raw`'\'' | chpasswd -e`)
  })

  it('パスワードが無ければアカウントをロックする', () => {
    const late = collectLateCommands(
      profile((p) => ({ ...p, postInstall: { ...p.postInstall, additionalUsers: [user()] } })),
    )
    expect(late.join('\n')).toContain("passwd -l 'deploy'")
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
    expect(withPass).toContain("usermod -aG sudo 'deploy'")
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
    expect(late).toContain("chmod 0700 '/home/deploy/.ssh'")
    expect(late).toContain("chmod 0600 '/home/deploy/.ssh/authorized_keys'")
    expect(late).toContain("chown -R 'deploy':'deploy' '/home/deploy/.ssh'")
    // ヒアドキュメントは使わない（終端子を書かれると残りが root のコマンドになる）
    expect(late).not.toContain('AUTOINSTALL_EOF')
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
    // 展開先はクォートする（空白を含むパスでインストール全体が失敗するため）
    expect(late).toContain("curtin in-target -- mkdir -p '/opt/myapp'")
    expect(late).toContain('tar -xzf')
    expect(late).toContain(String.raw`-C '\''/opt/myapp'\''`)
    // 退避したファイルは片付ける
    expect(late).toContain("rm -f '/target/var/tmp/autoinstall-app.tar.gz'")
    expect(late).toContain("chown -R deploy:deploy '/opt/myapp'")
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
    // targetPath は自由入力なので必ずクォートされていること
    expect(late).toContain("chown deploy:deploy '/etc/myapp/app.conf'")
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
    // ヒアドキュメントは使わない（ユニットの中身に終端子を書かれると
    // 残りが in-target の root シェルのコマンドとして実行できてしまう）
    expect(late).not.toContain('AUTOINSTALL_EOF')
    expect(late).toContain(String.raw`printf '\''%s'\''`)
    expect(late).toContain("chmod 0644 '/etc/systemd/system/myapp.service'")
    expect(late).toContain("systemctl enable 'myapp.service'")
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
    const cmds = collectFirstBootCommands(gpuProfile())
    const gpu = cmds.filter((c) => c.includes('cuda-keyring'))
    // cloud-init の runcmd は各エントリを別々に実行し set -e も && も付けないので、
    // 失敗が後続を止めるよう 1 エントリの `sh -e -c` にまとめてある（落とし穴 28）
    expect(gpu).toHaveLength(1)
    expect(gpu[0]!.startsWith('sh -e -c ')).toBe(true)
    const first = gpu[0]!
    expect(first).toContain('cuda-keyring_1.1-1_all.deb')
    expect(first).toContain('dpkg -i /var/tmp/cuda-keyring.deb')
    expect(first).toContain('apt-get update')
    // パッケージ名は 1 つずつクォートする（toolkit は自由入力のピン留めを許す）
    expect(first).toContain(String.raw`apt-get install -y '\''nvidia-open'\'' '\''cuda-toolkit'\''`)
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
    // 1 エントリにまとめてあるので、まとめたスクリプトの末尾で確認する
    const gpu = first.filter((c) => c.includes('cuda-keyring'))
    expect(gpu).toHaveLength(1)
    expect(gpu[0]!.trimEnd().endsWith(String.raw`systemctl reboot'`)).toBe(true)
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
    // GPU の導入は 1 エントリの `sh -e -c` にまとめてある（落とし穴 28）。
    // 「エントリ数が多いこと」は健全性の指標ではないので、中身で確認する。
    const runcmd = parsed.autoinstall['user-data'].runcmd
    expect(runcmd.length).toBeGreaterThanOrEqual(1)
    const gpuEntries = runcmd.filter((c) => c.includes('cuda-keyring'))
    expect(gpuEntries).toHaveLength(1)
    expect(gpuEntries[0]!.startsWith('sh -e -c ')).toBe(true)
    // 複数行のファイル内容（systemd ユニット・authorized_keys）が YAML を壊していないこと。
    // ヒアドキュメントはやめたので printf で書き出している。
    expect(
      parsed.autoinstall['late-commands'].some((c) => c.includes(String.raw`printf '\''%s'\''`)),
    ).toBe(true)
    expect(parsed.autoinstall['late-commands'].some((c) => c.includes('AUTOINSTALL_EOF'))).toBe(
      false,
    )
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
  it('v1 のプロファイルを最新形式に移行し、新セクションを既定で埋める', () => {
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
    expect(p.profileVersion).toBe(4)
    expect(p.series).toBe('22.04')
    expect(p.basics.hostname).toBe('old-host')
    expect(p.user.username).toBe('old')
    expect(p.software.packages).toEqual(['vim'])
    expect(p.postInstall.presets).toEqual(['chrony-ntp'])
    // 新セクションは既定
    expect(p.postInstall.additionalUsers).toEqual([])
    expect(p.postInstall.services).toEqual([])
    expect(p.software.gpu.enabled).toBe(false)
    expect(p.runtimeValues.hostname).toBe('fixed')
    expect(notes.some((n) => n.key === 'migrate.fromV1')).toBe(true)
  })

  it('壊れた JSON でも既定プロファイルを返す', () => {
    expect(migrateProfile(null).profile.series).toBe('24.04')
    expect(migrateProfile('nonsense').notes.length).toBeGreaterThan(0)
    expect(migrateProfile([]).profile.user.username).toBe('ubuntu')
  })

  it('未対応バージョンは既定に戻して知らせる', () => {
    const { profile: p, notes } = migrateProfile({ profileVersion: 4, series: '18.04' })
    expect(p.series).toBe('24.04')
    expect(notes.some((n) => n.key === 'migrate.unsupportedSeries')).toBe(true)
  })

  it('新しいバージョンで保存されたファイルは注意を出す', () => {
    const { notes } = migrateProfile({ profileVersion: 99, series: '24.04' })
    expect(notes.some((n) => n.key === 'migrate.fromNewer')).toBe(true)
  })

  it('network の mode が変わっていれば丸ごと採用する', () => {
    const { profile: p } = migrateProfile({
      profileVersion: 4,
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
    const { profile: p } = migrateProfile({ profileVersion: 4, network: { mode: 'bogus' } })
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

// 回帰: cloud-init の runcmd は各エントリを別々に実行し、set -e も && も付けない
// （util.shellify が 1 行ずつ並べるだけ）。SHA-256 の検証を独立したエントリにすると、
// 合わなくても mv / tar が走り、しかも最後のコマンドの終了コードが 0 なので
// cloud-init は成功として記録する。URL 取得ペイロードの唯一の改ざん検知が無効だった。
describe('URL 取得ペイロードの改ざん検知（実際に sh で実行）', () => {
  function urlDeployment(sha256: string, url: string, targetPath: string): Deployment {
    return {
      id: 'd1',
      kind: 'file',
      name: 'payload.bin',
      source: { kind: 'url', url, sha256 },
      targetPath,
      owner: 'root',
      group: 'root',
      mode: '0644',
      archiveFormat: 'tar.gz',
      postCommand: '',
      chownRecursive: false,
    }
  }

  const slash = (p: string): string => p.split('\\').join('/')

  /**
   * 生成されたコマンドをそのまま sh で実行する。
   * curl は file:// を扱えるので、ダウンロードの行も本物のまま通せる。
   */
  function run(body: string, sha256: string): { code: number; installed: string | null } {
    const dir = mkdtempSync(join(tmpdir(), 'ai-deploy-'))
    try {
      const src = join(dir, 'remote.bin')
      writeFileSync(src, body, 'utf8')
      const target = join(dir, 'installed.bin')
      const d = urlDeployment(sha256, `file:///${slash(src)}`, slash(target))
      const cmds = deploymentFirstBootCommands(d)
      // 1 エントリにまとまっていること自体が要件（分かれていると set -e が効かない）
      expect(cmds).toHaveLength(1)
      // 一時ファイルはテスト用のディレクトリへ向ける
      const cmd = cmds[0]!.split('/var/tmp/autoinstall-payload.bin').join(
        slash(join(dir, 'tmp.bin')),
      )
      let code = 0
      try {
        execFileSync('sh', ['-c', cmd], { stdio: 'pipe' })
      } catch (e) {
        code = (e as { status?: number }).status ?? 1
      }
      return { code, installed: existsSync(target) ? readFileSync(target, 'utf8') : null }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('ハッシュが合わなければ配置されず、非ゼロで終わる', () => {
    const good = createHash('sha256').update('GOOD PAYLOAD').digest('hex')
    const r = run('TAMPERED PAYLOAD', good)
    expect(r.code).not.toBe(0)
    expect(r.installed).toBeNull()
  })

  it('ハッシュが合えば配置され、0 で終わる', () => {
    const body = 'GOOD PAYLOAD'
    const good = createHash('sha256').update(body).digest('hex')
    const r = run(body, good)
    expect(r.code).toBe(0)
    expect(r.installed).toBe(body)
  })
})

// ---------------------------------------------------------------------------
// 所有者とグループ（3 巡目で直した経路。回帰テストが無かった）
// ---------------------------------------------------------------------------

describe('展開の所有者とグループ', () => {
  /** USB 同梱（late-commands）と URL 取得（runcmd）の両方を取り出す。 */
  function commandsFor(d: Deployment): { late: string; firstBoot: string } {
    const p = profile((x) => ({
      ...x,
      postInstall: { ...x.postInstall, deployments: [d] },
    }))
    return {
      late: collectLateCommands(p).join('\n'),
      firstBoot: collectFirstBootCommands(p).join('\n'),
    }
  }

  it('USB 同梱の単一ファイルでも group が反映される', () => {
    // 3 巡目までは URL 経路だけ chgrp していて、USB 同梱の file 経路は
    // group を黙って捨てていた。UI は「owner:group」と表示するので気づけない。
    const { late } = commandsFor(
      deployment({
        kind: 'file',
        name: 'app.conf',
        targetPath: '/etc/app.conf',
        owner: 'root',
        group: 'staff',
        source: { kind: 'host-file', path: 'C:/app.conf', sizeBytes: 10 },
      }),
    )
    expect(late).toContain("chgrp staff '/etc/app.conf'")
  })

  it('owner を指定したら owner:group で chown する', () => {
    const { late } = commandsFor(
      deployment({
        kind: 'file',
        name: 'app.conf',
        targetPath: '/etc/app.conf',
        owner: 'deploy',
        group: 'staff',
        source: { kind: 'host-file', path: 'C:/app.conf', sizeBytes: 10 },
      }),
    )
    expect(late).toContain("chown deploy:staff '/etc/app.conf'")
  })

  it('group が空なら owner:owner にする', () => {
    const { late } = commandsFor(
      deployment({
        kind: 'file',
        name: 'app.conf',
        targetPath: '/etc/app.conf',
        owner: 'deploy',
        group: '',
        source: { kind: 'host-file', path: 'C:/app.conf', sizeBytes: 10 },
      }),
    )
    expect(late).toContain("chown deploy:deploy '/etc/app.conf'")
  })

  it('所有者が root のままなら chown も chgrp も出さない', () => {
    const { late } = commandsFor(
      deployment({
        kind: 'file',
        name: 'app.conf',
        targetPath: '/etc/app.conf',
        owner: 'root',
        group: '',
        source: { kind: 'host-file', path: 'C:/app.conf', sizeBytes: 10 },
      }),
    )
    expect(late).not.toContain('chown')
    expect(late).not.toContain('chgrp')
  })

  it('アーカイブは chownRecursive が false なら owner を反映しない', () => {
    // UI は「owner:group」を表示するのに、chownRecursive が false だと
    // 何も出ない。表示と出力が食い違う（今は仕様として固定する）。
    const off = commandsFor(deployment({ chownRecursive: false, owner: 'deploy', group: 'staff' }))
    expect(off.late).not.toContain('chown')
    const on = commandsFor(deployment({ chownRecursive: true, owner: 'deploy', group: 'staff' }))
    expect(on.late).toContain("chown -R deploy:staff '/opt/myapp'")
  })

  it('URL 取得でも同じ扱いになる（late と runcmd で食い違わない）', () => {
    const { firstBoot } = commandsFor(
      deployment({
        kind: 'file',
        name: 'app.conf',
        targetPath: '/etc/app.conf',
        owner: 'root',
        group: 'staff',
        source: { kind: 'url', url: 'https://example.com/app.conf', sha256: 'a'.repeat(64) },
      }),
    )
    // runcmd は 1 エントリの `sh -e -c` に包むので、内側の ' は '\\'' になる
    expect(firstBoot).toContain(String.raw`chgrp staff '\''/etc/app.conf'\''`)
  })
})

// ---------------------------------------------------------------------------
// シェル注入（4 巡目の監査で実際に成立していたもの）
// ---------------------------------------------------------------------------
//
// 生成したコマンドを **実際に sh で実行**して、注入が起きないことを確かめる。
// 「クォートされた文字列を含むか」を目で見る assertion は、
// クォートの入れ子を間違えたときに一緒に間違えるので、実行して確かめる。
describe('シェル注入', () => {
  /** in-target を「その場で実行する」スタブにして、生成コマンドを実際に走らせる。 */
  function runAll(cmds: readonly string[]): { syntaxErrors: string[]; leaked: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'inject-'))
    const bin = join(dir, 'bin')
    try {
      writeFileSync(join(bin + '.sh'), '')
      rmSync(join(bin + '.sh'))
    } catch {
      /* ignore */
    }
    try {
      execFileSync('sh', ['-c', `mkdir -p ${JSON.stringify(bin)}`])
      // `curtin in-target -- <cmd...>` の 2 語を落として残りを実行するスタブ
      writeFileSync(join(bin, 'curtin'), '#!/bin/sh\nshift 2\nexec "$@"\n')
      execFileSync('sh', ['-c', `chmod +x ${JSON.stringify(join(bin, 'curtin'))}`])
      const env = { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` }
      const syntaxErrors: string[] = []
      for (const c of cmds) {
        try {
          execFileSync('sh', ['-n', '-c', c], { env, stdio: 'pipe' })
        } catch {
          syntaxErrors.push(c)
        }
        try {
          // 正規のコマンドは /target が無いので失敗してよい。見たいのは注入の成否だけ。
          execFileSync('sh', ['-c', c], { env, stdio: 'pipe', timeout: 10_000 })
        } catch {
          /* ignore */
        }
      }
      const leaked = readdirSync(dir).filter((n) => n !== 'bin')
      return { syntaxErrors, leaked }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** 注入の目印を作るペイロード。作られたら注入が成立している。 */
  function payload(dir: string, name: string): string {
    return `${dir}/${name}`
  }

  it('追加ユーザーの shell / パスワードハッシュ / SSH 鍵から root コマンドを実行できない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inject-mark-')).replaceAll('\\', '/')
    try {
      const u = user({
        // useradd -s にそのまま連結されていた
        shell: `/bin/sh; touch ${payload(dir, 'SHELL')}; #`,
        // looksLikeCryptHash は接頭辞しか見ないので ' を含むハッシュが検証を通る。
        // 手書きの '…' で囲っていたためクォートを抜けられた（落とし穴 13 の退行）
        passwordHash: `$6$x'; touch ${payload(dir, 'HASH')}; echo '`,
        // ヒアドキュメントの終端子をコメント欄に書くと以降が root のコマンドになった
        sshAuthorizedKeys: [`${SSH_KEY}\nAUTOINSTALL_EOF\ntouch ${payload(dir, 'KEY')}`],
      })
      const cmds = collectLateCommands(
        profile((x) => ({ ...x, postInstall: { ...x.postInstall, additionalUsers: [u] } })),
      )
      const r = runAll(cmds)
      expect(r.syntaxErrors).toEqual([])
      expect(readdirSync(dir)).toEqual([])
      expect(r.leaked).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('展開先のパスから root コマンドを実行できない（空白入りのパスでも壊れない）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inject-mark-')).replaceAll('\\', '/')
    try {
      const d = deployment({
        kind: 'file',
        targetPath: `/opt/a b; touch ${payload(dir, 'TARGET')}; x`,
        owner: 'deploy',
        group: 'staff',
        source: { kind: 'host-file', path: 'C:/payload/app.bin', sizeBytes: 1 },
      })
      const cmds = collectLateCommands(
        profile((x) => ({ ...x, postInstall: { ...x.postInstall, deployments: [d] } })),
      )
      const r = runAll(cmds)
      expect(r.syntaxErrors).toEqual([])
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('systemd ユニットの中身から root コマンドを実行できない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inject-mark-')).replaceAll('\\', '/')
    try {
      const svc = service({
        environment: [`A=1\nAUTOINSTALL_EOF\ntouch ${payload(dir, 'UNIT')}`],
      })
      const cmds = collectLateCommands(
        profile((x) => ({ ...x, postInstall: { ...x.postInstall, services: [svc] } })),
      )
      const r = runAll(cmds)
      expect(r.syntaxErrors).toEqual([])
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('CUDA のツールキット名から root コマンドを実行できず、検証でも弾かれる', () => {
    const evil = 'cuda-toolkit; touch /tmp/should-not-happen'
    const p = profile((x) => ({
      ...x,
      software: {
        ...x.software,
        gpu: { ...x.software.gpu, enabled: true, driver: 'open', toolkit: evil },
      },
    }))
    // 生成側: パッケージ名が 1 つずつクォートされる
    const first = collectFirstBootCommands(p).join('\n')
    expect(first).toContain(String.raw`'\''cuda-toolkit; touch /tmp/should-not-happen'\''`)
    // 検証側: apt のパッケージ名として不正なので error になる
    const issues = validateProfile(p).issues.filter((i) => i.severity === 'error')
    expect(issues.some((i) => i.field === 'software.gpu.toolkit')).toBe(true)
  })
})
