import type { AutoinstallProfile } from './model.js'
import { shellQuote } from './presets.js'
import {
  ARCHIVE_REQUIREMENTS,
  cudaKeyringUrl,
  cudaPackages,
  renderServiceUnit,
  type AdditionalUser,
  type Deployment,
  type SystemdService,
} from './provisioning.js'

// プロビジョニング（追加ユーザー・アプリ展開・サービス・GPU）を
// late-commands と cloud-init の runcmd に落とす。
//
// 実行場所の使い分け:
//   late-commands  … インストーラ環境。新システムは /target。再起動前に完了する。
//                    ユーザー作成・ファイル配置・サービス登録など「小さくて確実」なもの。
//   user-data.runcmd … インストール先の初回起動時。ネットワークが上がった後。
//                    CUDA のような数 GB のダウンロードを伴うもの。

/**
 * 設定用パーティション (CIDATA) をマウントするパス。
 *
 * cloud-init は seed を読むときだけ一時マウントしてすぐアンマウントする
 * （`util.mount_cb` の実装がそうなっている）。したがって late-commands の時点では
 * どこにもマウントされていない。`/cdrom` は ISO9660 パーティションであって CIDATA ではない。
 */
export const SEED_MOUNT_PATH = '/run/autoinstall-seed'

/** CIDATA をマウントするコマンド。ラベルは大文字小文字の両方を試す。 */
export function seedMountCommands(): string[] {
  return [
    `mkdir -p ${SEED_MOUNT_PATH}`,
    // blkid が返すラベルの大小は環境差があるので両方試す
    `mount -L CIDATA ${SEED_MOUNT_PATH} || mount -L cidata ${SEED_MOUNT_PATH}`,
  ]
}

/** アンマウント。失敗してもインストール全体を落とさない。 */
export function seedUmountCommands(): string[] {
  return [`umount ${SEED_MOUNT_PATH} || true`]
}

/** 新システム側で実行するコマンド。 */
function inTarget(command: string): string {
  return `curtin in-target -- ${command}`
}

/** 新システム側で sh 経由で実行する（リダイレクトやパイプを使いたいとき）。 */
function inTargetSh(script: string): string {
  return `curtin in-target -- sh -c ${shellQuote(script)}`
}

// ---------------------------------------------------------------------------
// 追加ユーザー
// ---------------------------------------------------------------------------

export function additionalUserCommands(user: AdditionalUser): string[] {
  const cmds: string[] = []
  const name = user.username
  const opts: string[] = []
  if (user.systemAccount) opts.push('-r')
  opts.push(user.createHome ? '-m' : '-M')
  if (user.shell) opts.push('-s', user.shell)
  if (user.realname) opts.push('-c', shellQuote(user.realname))
  if (user.groups.length > 0) opts.push('-G', shellQuote(user.groups.join(',')))

  // 既にいる場合を考慮して `id` で存在確認する（useradd の失敗で install を落とさない）
  cmds.push(
    inTargetSh(`id -u ${name} >/dev/null 2>&1 || useradd ${opts.join(' ')} ${name}`),
  )

  if (user.passwordHash) {
    // chpasswd -e はハッシュをそのまま設定する。ハッシュに `$` が含まれるので必ずクォートする。
    cmds.push(inTargetSh(`echo '${name}:${user.passwordHash}' | chpasswd -e`))
  } else {
    // パスワード未設定はロック（空パスワードでログインできてしまうのを防ぐ）
    cmds.push(inTarget(`passwd -l ${name}`))
  }

  if (user.sudo === 'nopasswd') {
    cmds.push(
      `echo ${shellQuote(`${name} ALL=(ALL) NOPASSWD:ALL`)} > /target/etc/sudoers.d/90-autoinstall-${name}`,
      `chmod 0440 /target/etc/sudoers.d/90-autoinstall-${name}`,
    )
  } else if (user.sudo === 'password') {
    cmds.push(inTarget(`usermod -aG sudo ${name}`))
  }

  if (user.sshAuthorizedKeys.length > 0) {
    const home = user.systemAccount ? `/var/lib/${name}` : `/home/${name}`
    const keys = user.sshAuthorizedKeys.map((k) => k.trim()).filter(Boolean).join('\n')
    cmds.push(
      inTarget(`mkdir -p ${home}/.ssh`),
      inTargetSh(`cat > ${home}/.ssh/authorized_keys <<'AUTOINSTALL_EOF'\n${keys}\nAUTOINSTALL_EOF`),
      inTarget(`chmod 0700 ${home}/.ssh`),
      inTarget(`chmod 0600 ${home}/.ssh/authorized_keys`),
      inTarget(`chown -R ${name}:${name} ${home}/.ssh`),
    )
  }
  return cmds
}

// ---------------------------------------------------------------------------
// アプリの展開
// ---------------------------------------------------------------------------

/** 展開に必要な apt パッケージ（unzip / xz-utils など）。 */
export function deploymentPackages(deployments: readonly Deployment[]): string[] {
  const set = new Set<string>()
  for (const d of deployments) {
    if (d.kind !== 'archive') continue
    for (const p of ARCHIVE_REQUIREMENTS[d.archiveFormat]) set.add(p)
  }
  return [...set].sort()
}

function extractCommand(d: Deployment, sourcePath: string, targetInTarget: string): string {
  switch (d.archiveFormat) {
    case 'tar.gz':
      return `tar -xzf ${shellQuote(sourcePath)} -C ${shellQuote(targetInTarget)}`
    case 'tar.xz':
      return `tar -xJf ${shellQuote(sourcePath)} -C ${shellQuote(targetInTarget)}`
    case 'tar.bz2':
      return `tar -xjf ${shellQuote(sourcePath)} -C ${shellQuote(targetInTarget)}`
    case 'tar':
      return `tar -xf ${shellQuote(sourcePath)} -C ${shellQuote(targetInTarget)}`
    case 'zip':
      return `unzip -o ${shellQuote(sourcePath)} -d ${shellQuote(targetInTarget)}`
  }
}

function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/** USB 同梱のペイロードを新システムへ展開する late-commands。 */
export function deploymentCommands(d: Deployment): string[] {
  if (d.source.kind === 'url') return [] // URL 取得は初回起動時に行う
  const cmds: string[] = []
  const seedFile = `${SEED_MOUNT_PATH}/${d.name}`

  if (d.kind === 'file') {
    const dest = `/target${d.targetPath}`
    cmds.push(
      `mkdir -p ${shellQuote(parentDir(dest))}`,
      `cp ${shellQuote(seedFile)} ${shellQuote(dest)}`,
      `chmod ${d.mode} ${shellQuote(dest)}`,
    )
    if (d.owner && d.owner !== 'root') {
      cmds.push(inTarget(`chown ${d.owner}:${d.group || d.owner} ${d.targetPath}`))
    }
    return cmds
  }

  // アーカイブは新システムのツール (tar/unzip) を使う。
  // seed をマウントしたパスは /target の外なので、いったん /target 内へコピーしてから展開する。
  const staged = `/target/var/tmp/autoinstall-${d.name}`
  cmds.push(
    `mkdir -p /target/var/tmp`,
    `cp ${shellQuote(seedFile)} ${shellQuote(staged)}`,
    inTarget(`mkdir -p ${d.targetPath}`),
    inTargetSh(extractCommand(d, `/var/tmp/autoinstall-${d.name}`, d.targetPath)),
    `rm -f ${shellQuote(staged)}`,
  )
  if (d.chownRecursive && d.owner && d.owner !== 'root') {
    cmds.push(inTarget(`chown -R ${d.owner}:${d.group || d.owner} ${d.targetPath}`))
  }
  if (d.postCommand.trim()) {
    cmds.push(inTargetSh(`cd ${shellQuote(d.targetPath)} && ${d.postCommand.trim()}`))
  }
  return cmds
}

/** URL 取得のペイロードを初回起動時に展開する runcmd。 */
export function deploymentFirstBootCommands(d: Deployment): string[] {
  if (d.source.kind !== 'url') return []
  const tmp = `/var/tmp/autoinstall-${d.name}`
  const cmds: string[] = [
    `curl -fsSL --retry 3 -o ${shellQuote(tmp)} ${shellQuote(d.source.url)}`,
  ]
  if (d.source.sha256) {
    // ハッシュが合わなければ以降を実行しない（`&&` ではなく set -e 相当にするため 1 行にまとめる）
    cmds.push(
      `sh -c ${shellQuote(`echo '${d.source.sha256}  ${tmp}' | sha256sum -c -`)}`,
    )
  }
  if (d.kind === 'file') {
    cmds.push(
      `mkdir -p ${shellQuote(parentDir(d.targetPath))}`,
      `mv ${shellQuote(tmp)} ${shellQuote(d.targetPath)}`,
      `chmod ${d.mode} ${shellQuote(d.targetPath)}`,
    )
    if (d.owner && d.owner !== 'root') {
      cmds.push(`chown ${d.owner}:${d.group || d.owner} ${shellQuote(d.targetPath)}`)
    }
  } else {
    cmds.push(
      `mkdir -p ${shellQuote(d.targetPath)}`,
      `sh -c ${shellQuote(extractCommand(d, tmp, d.targetPath))}`,
      `rm -f ${shellQuote(tmp)}`,
    )
    if (d.chownRecursive && d.owner && d.owner !== 'root') {
      cmds.push(`chown -R ${d.owner}:${d.group || d.owner} ${shellQuote(d.targetPath)}`)
    }
    if (d.postCommand.trim()) {
      cmds.push(`sh -c ${shellQuote(`cd ${d.targetPath} && ${d.postCommand.trim()}`)}`)
    }
  }
  return cmds
}

// ---------------------------------------------------------------------------
// systemd サービス
// ---------------------------------------------------------------------------

export function serviceCommands(svc: SystemdService): string[] {
  const unitPath = `/etc/systemd/system/${svc.name}.service`
  const cmds = [
    // ヒアドキュメントで書く。ユニットの内容に `$` が含まれても展開されないよう 'EOF' をクォートする。
    inTargetSh(`cat > ${unitPath} <<'AUTOINSTALL_EOF'\n${renderServiceUnit(svc)}AUTOINSTALL_EOF`),
    inTarget(`chmod 0644 ${unitPath}`),
  ]
  if (svc.enabled) {
    // インストーラ環境では systemd が動いていないので、リンクを直接作る `enable` を使う。
    // `systemctl enable` は in-target でも offline モードで動作する。
    cmds.push(inTarget(`systemctl enable ${svc.name}.service`))
  }
  return cmds
}

// ---------------------------------------------------------------------------
// GPU / CUDA
// ---------------------------------------------------------------------------

/**
 * CUDA を初回起動時に導入する runcmd。
 * インストール中ではなく初回起動時にするのは、数 GB のダウンロードが発生し、
 * インストーラの画面では進捗が見えず「固まった」ように見えるため。
 */
export function gpuFirstBootCommands(profile: AutoinstallProfile): string[] {
  const gpu = profile.software.gpu
  if (!gpu.enabled) return []
  const keyring = cudaKeyringUrl(profile.series)
  const pkgs = cudaPackages(gpu)
  if (!keyring || pkgs.length === 0) return []

  const cmds: string[] = [
    `curl -fsSL --retry 3 -o /var/tmp/cuda-keyring.deb ${shellQuote(keyring)}`,
    'dpkg -i /var/tmp/cuda-keyring.deb',
    'rm -f /var/tmp/cuda-keyring.deb',
  ]
  if (gpu.containerToolkit) {
    // container-toolkit は CUDA リポジトリとは別のリポジトリにある
    cmds.push(
      `sh -c ${shellQuote(
        "curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg",
      )}`,
      `sh -c ${shellQuote(
        "curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' > /etc/apt/sources.list.d/nvidia-container-toolkit.list",
      )}`,
    )
  }
  cmds.push(
    'apt-get update',
    `sh -c ${shellQuote(`DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs.join(' ')}`)}`,
  )
  if (gpu.setupPath) {
    // /usr/local/cuda は最新版へのシンボリックリンク。バージョンを固定しないで済む。
    cmds.push(
      `sh -c ${shellQuote(
        "printf '%s\\n' 'export PATH=/usr/local/cuda/bin:$PATH' 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH' > /etc/profile.d/cuda.sh",
      )}`,
      'chmod 0644 /etc/profile.d/cuda.sh',
    )
  }
  if (gpu.containerToolkit) {
    cmds.push('nvidia-ctk runtime configure --runtime=docker', 'systemctl restart docker')
  }
  // ドライバを入れたらカーネルモジュールを読み込むために再起動が必要
  if (gpu.driver !== 'none') cmds.push('systemctl reboot')
  return cmds
}

// ---------------------------------------------------------------------------
// 全体の組み立て
// ---------------------------------------------------------------------------

export interface ProvisioningCommands {
  /** late-commands に追加するコマンド */
  readonly late: readonly string[]
  /** user-data.runcmd に追加するコマンド */
  readonly firstBoot: readonly string[]
  /** 追加で必要になる apt パッケージ */
  readonly packages: readonly string[]
  /** CIDATA のマウントが必要か */
  readonly needsSeedMount: boolean
}

/** プロファイルからプロビジョニング用のコマンド群を組み立てる。 */
export function buildProvisioningCommands(profile: AutoinstallProfile): ProvisioningCommands {
  const { postInstall } = profile
  const late: string[] = []
  const firstBoot: string[] = []
  const packages = new Set<string>()

  // 追加ユーザー（サービスがそのユーザーで動く可能性があるので最初に作る）
  for (const u of postInstall.additionalUsers) late.push(...additionalUserCommands(u))

  // USB 同梱のペイロード展開
  const seedDeployments = postInstall.deployments.filter((d) => d.source.kind !== 'url')
  for (const d of seedDeployments) late.push(...deploymentCommands(d))
  for (const p of deploymentPackages(seedDeployments)) packages.add(p)

  // サービス登録（展開したアプリを起動する想定なので展開の後）
  for (const s of postInstall.services) late.push(...serviceCommands(s))

  // apt full-upgrade は追加パッケージのインストール後に走らせる
  if (postInstall.aptFullUpgrade) {
    late.push(
      inTarget('apt-get update'),
      inTargetSh('DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade'),
      inTargetSh('DEBIAN_FRONTEND=noninteractive apt-get -y autoremove --purge'),
    )
  }

  // URL 取得のペイロードは初回起動時
  const urlDeployments = postInstall.deployments.filter((d) => d.source.kind === 'url')
  for (const d of urlDeployments) firstBoot.push(...deploymentFirstBootCommands(d))
  if (urlDeployments.length > 0) packages.add('curl')

  // GPU は最後（再起動を伴うため）
  const gpuCmds = gpuFirstBootCommands(profile)
  if (gpuCmds.length > 0) {
    packages.add('curl')
    if (profile.software.gpu.containerToolkit) packages.add('gnupg')
    firstBoot.push(...gpuCmds)
  }

  const needsSeedMount = seedDeployments.length > 0 || postInstall.files.length > 0
  return { late, firstBoot, packages: [...packages].sort(), needsSeedMount }
}
