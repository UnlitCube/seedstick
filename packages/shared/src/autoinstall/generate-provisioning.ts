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

/**
 * 内容をファイルへ書き出すコマンド。**ヒアドキュメントは使わない。**
 *
 * `<<'AUTOINSTALL_EOF' … AUTOINSTALL_EOF` は、内容の中に終端子と同じ行があると
 * そこで閉じてしまう。SSH 公開鍵のコメント欄も systemd ユニットの追加行も自由入力なので、
 * `AUTOINSTALL_EOF` という行を書くだけで残りが in-target の root シェルの
 * コマンドとして実行できた（実際に再現した）。
 *
 * `printf '%s'` に shellQuote した内容を渡せば、内容がどんなバイト列でも
 * シェルの構文としては 1 個の引数にしかならない。`echo` ではなく `printf` なのは、
 * `echo` がバックスラッシュを解釈する実装（dash の組み込み）があるため。
 */
function writeFileCommand(path: string, content: string): string {
  return `printf '%s' ${shellQuote(content)} > ${shellQuote(path)}`
}

// ---------------------------------------------------------------------------
// 追加ユーザー
// ---------------------------------------------------------------------------

export function additionalUserCommands(user: AdditionalUser): string[] {
  const cmds: string[] = []
  const name = user.username
  const q = shellQuote(name)
  const opts: string[] = []
  if (user.systemAccount) opts.push('-r')
  opts.push(user.createHome ? '-m' : '-M')
  // shell も realname も groups も自由入力。検証を通していても生成側で必ずクォートする
  // （検証と生成のどちらか一方だけに頼らない）。
  if (user.shell) opts.push('-s', shellQuote(user.shell))
  if (user.realname) opts.push('-c', shellQuote(user.realname))
  if (user.groups.length > 0) opts.push('-G', shellQuote(user.groups.join(',')))

  // 既にいる場合を考慮して `id` で存在確認する（useradd の失敗で install を落とさない）
  cmds.push(inTargetSh(`id -u ${q} >/dev/null 2>&1 || useradd ${opts.join(' ')} ${q}`))

  if (user.passwordHash) {
    // chpasswd -e はハッシュをそのまま設定する。
    // 手書きの `'…'` で囲うと、ハッシュに `'` が 1 個あるだけでクォートを抜けられる。
    // looksLikeCryptHash は接頭辞しか見ないので検証も通っていた（落とし穴 13 の退行）。
    cmds.push(inTargetSh(`echo ${shellQuote(`${name}:${user.passwordHash}`)} | chpasswd -e`))
  } else {
    // パスワード未設定はロック（空パスワードでログインできてしまうのを防ぐ）
    cmds.push(inTarget(`passwd -l ${q}`))
  }

  if (user.sudo === 'nopasswd') {
    const sudoersPath = `/target/etc/sudoers.d/90-autoinstall-${name}`
    cmds.push(
      writeFileCommand(sudoersPath, `${name} ALL=(ALL) NOPASSWD:ALL` + '\n'),
      `chmod 0440 ${shellQuote(sudoersPath)}`,
    )
  } else if (user.sudo === 'password') {
    cmds.push(inTarget(`usermod -aG sudo ${q}`))
  }

  if (user.sshAuthorizedKeys.length > 0) {
    const home = user.systemAccount ? `/var/lib/${name}` : `/home/${name}`
    const sshDir = `${home}/.ssh`
    const keyFile = `${sshDir}/authorized_keys`
    const keys = user.sshAuthorizedKeys.map((k) => k.trim()).filter(Boolean).join('\n')
    cmds.push(
      inTarget(`mkdir -p ${shellQuote(sshDir)}`),
      inTargetSh(writeFileCommand(keyFile, keys + '\n')),
      inTarget(`chmod 0700 ${shellQuote(sshDir)}`),
      inTarget(`chmod 0600 ${shellQuote(keyFile)}`),
      inTarget(`chown -R ${q}:${q} ${shellQuote(sshDir)}`),
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
    // 手で編集された JSON には知らない形式が入りうる。ここで例外を投げると
    // GUI が「理由の分からない空の確認画面」になる（落とし穴 23）。
    // 読み飛ばして、検証でエラーとして伝える。
    const required = ARCHIVE_REQUIREMENTS[d.archiveFormat] as readonly string[] | undefined
    if (!required) continue
    for (const pkg of required) set.add(pkg)
  }
  return [...set].sort()
}

function extractCommand(d: Deployment, sourcePath: string, targetInTarget: string): string {
  switch (d.archiveFormat) {
    // 既定は tar.gz。知らない形式でも例外を投げない（検証がエラーを出す）。
    default:
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

/** 展開 / 配置で実際に適用される所有者。何も変えないなら null。 */
export interface DeploymentOwnership {
  /** 空なら所有者は root のまま（`chgrp` だけを出す） */
  readonly owner: string
  readonly group: string
  /** 中身（展開されたファイル）まで変えるか（`chown -R`） */
  readonly recursive: boolean
}

/**
 * `owner` / `group` / `chownRecursive` から「実際に何が起きるか」を決める。
 *
 * **表示と出力を 1 か所から作るための関数。** GUI は展開の一覧と編集画面で
 * owner / group を常に出しているのに、以前はアーカイブの `chownRecursive` が
 * false だと `chown` を 1 つも出さず、設定が完全に死んでいた
 * （「設定したのに効かない」。しかも検証は `chown` が出る前提で
 * 「所有者が実在しない」と警告していたので、警告のほうも嘘になっていた）。
 *
 * いまは **`chownRecursive` は「中身まで」の意味**に統一してある:
 *   - off … 展開先ディレクトリそのものを `owner:group` にする
 *           （中身はアーカイブが持っている所有者のまま）
 *   - on  … `-R` で中身も含めて変える
 * `kind: 'file'` は 1 ファイルなので再帰の余地が無く、常に非再帰。
 *
 * renderer はこの関数の戻り値を要約に出す。分岐を書き写すと必ず食い違うので、
 * **表示側で条件を再実装しないこと。**
 */
export function deploymentOwnership(d: Deployment): DeploymentOwnership | null {
  // 手で編集された JSON では文字列とは限らない（落とし穴 23）。
  const owner = typeof d.owner === 'string' ? d.owner : ''
  const group = typeof d.group === 'string' ? d.group : ''
  const recursive = d.kind === 'archive' && d.chownRecursive === true
  if (owner && owner !== 'root') return { owner, group: group || owner, recursive }
  // 所有者は root のままでグループだけ変えたい設定も成立する
  if (group && group !== 'root') return { owner: '', group, recursive }
  return null
}

/**
 * 所有者を変えるコマンド。パスは自由入力（`startsWith('/')` しか検証していない）なので
 * 必ずクォートする。owner / group は検証が `^[a-z_][a-z0-9_-]{0,31}$` に限っている。
 */
function chownCommand(o: DeploymentOwnership, targetPath: string): string {
  const r = o.recursive ? ' -R' : ''
  return o.owner
    ? `chown${r} ${o.owner}:${o.group} ${shellQuote(targetPath)}`
    : `chgrp${r} ${o.group} ${shellQuote(targetPath)}`
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
    // targetPath は `startsWith('/')` しか検証していない自由入力なので必ずクォートする
    // （`chownCommand` の中でクォートしている）。ここは 3 巡目のクォート修正から漏れており、
    // `/opt/my app` のような普通のパスでも late-command が失敗し、
    // `;` や `$( )` では root の任意コマンド実行になっていた。
    const own = deploymentOwnership(d)
    if (own) cmds.push(inTarget(chownCommand(own, d.targetPath)))
    return cmds
  }

  // アーカイブは新システムのツール (tar/unzip) を使う。
  // seed をマウントしたパスは /target の外なので、いったん /target 内へコピーしてから展開する。
  const staged = `/target/var/tmp/autoinstall-${d.name}`
  cmds.push(
    `mkdir -p /target/var/tmp`,
    `cp ${shellQuote(seedFile)} ${shellQuote(staged)}`,
    inTarget(`mkdir -p ${shellQuote(d.targetPath)}`),
    inTargetSh(extractCommand(d, `/var/tmp/autoinstall-${d.name}`, d.targetPath)),
    `rm -f ${shellQuote(staged)}`,
  )
  // `chownRecursive` が false でも展開先そのものは owner:group にする（`deploymentOwnership`）。
  const own = deploymentOwnership(d)
  if (own) cmds.push(inTarget(chownCommand(own, d.targetPath)))
  if (d.postCommand.trim()) {
    cmds.push(inTargetSh(`cd ${shellQuote(d.targetPath)} && ${d.postCommand.trim()}`))
  }
  return cmds
}

/**
 * URL 取得のペイロードを初回起動時に展開する runcmd。
 *
 * **1 エントリにまとめて `sh -e` で走らせる。**
 * cloud-init の cc_runcmd は各エントリを別々のスクリプトとして実行し、
 * `set -e` も `&&` も付けない（util.shellify が 1 行ずつ並べるだけ）。
 * そのため検証を独立したエントリにすると、SHA-256 が合わなくても
 * 後続の mv / tar がそのまま走り、しかも最後のコマンドの終了コードが 0 なので
 * cloud-init は成功として記録する。改ざん検知が完全に無効になる。
 */
export function deploymentFirstBootCommands(d: Deployment): string[] {
  if (d.source.kind !== 'url') return []
  const tmp = `/var/tmp/autoinstall-${d.name}`
  const steps: string[] = [
    `curl -fsSL --retry 3 -o ${shellQuote(tmp)} ${shellQuote(d.source.url)}`,
  ]
  if (d.source.sha256) {
    // ここで落ちれば `sh -e` が以降を実行しない
    steps.push(`echo ${shellQuote(`${d.source.sha256}  ${tmp}`)} | sha256sum -c -`)
  }
  if (d.kind === 'file') {
    steps.push(
      `mkdir -p ${shellQuote(parentDir(d.targetPath))}`,
      `mv ${shellQuote(tmp)} ${shellQuote(d.targetPath)}`,
      `chmod ${d.mode} ${shellQuote(d.targetPath)}`,
    )
    const own = deploymentOwnership(d)
    if (own) steps.push(chownCommand(own, d.targetPath))
  } else {
    steps.push(
      `mkdir -p ${shellQuote(d.targetPath)}`,
      extractCommand(d, tmp, d.targetPath),
      `rm -f ${shellQuote(tmp)}`,
    )
    // late 経路（deploymentCommands）と同じ規則。`chownRecursive` が false でも
    // 展開先そのものは owner:group にする。
    const own = deploymentOwnership(d)
    if (own) steps.push(chownCommand(own, d.targetPath))
    if (d.postCommand.trim()) {
      steps.push(`cd ${shellQuote(d.targetPath)}`, d.postCommand.trim())
    }
  }
  // `sh -e` なのでどれか 1 つでも失敗すれば以降は走らず、
  // cloud-init も非ゼロ終了として記録する。
  return [`sh -e -c ${shellQuote(steps.join('\n'))}`]
}

// ---------------------------------------------------------------------------
// systemd サービス
// ---------------------------------------------------------------------------

export function serviceCommands(svc: SystemdService): string[] {
  const unitPath = `/etc/systemd/system/${svc.name}.service`
  const cmds = [
    // ヒアドキュメントは使わない。ユニットの各行は自由入力なので、
    // `AUTOINSTALL_EOF` という行を書かれるとそこで終端し、以降が root のコマンドになる。
    inTargetSh(writeFileCommand(unitPath, renderServiceUnit(svc))),
    inTarget(`chmod 0644 ${shellQuote(unitPath)}`),
  ]
  if (svc.enabled) {
    // インストーラ環境では systemd が動いていないので、リンクを直接作る `enable` を使う。
    // `systemctl enable` は in-target でも offline モードで動作する。
    cmds.push(inTarget(`systemctl enable ${shellQuote(`${svc.name}.service`)}`))
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
    // toolkit は `cuda-toolkit-13-3` のようなピン留めを許す自由文字列なので、
    // パッケージ名を 1 つずつクォートする（`x; …` で root の任意コマンドが動いていた）。
    `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs.map(shellQuote).join(' ')}`,
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

  // **1 エントリにまとめて `sh -e` で走らせる。**
  // cloud-init の cc_runcmd は各エントリを別々に実行し、`set -e` も `&&` も付けない。
  // 別エントリのままだと keyring の取得に失敗しても apt-get が走り、
  // 最後のコマンドが 0 で終われば cloud-init は成功として記録する（落とし穴 28）。
  // 途中で失敗したときは `systemctl reboot` に到達しないので、
  // 「再起動していないマシン＋cloud-init のエラー」として失敗が見える形で残る。
  return [`sh -e -c ${shellQuote(cmds.join('\n'))}`]
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
  // 展開ツール (unzip / bzip2 / xz-utils) は URL 取得のものにも要る。
  // 初回起動時に apt が使えるとは限らないので、インストール時に入れておく。
  for (const p of deploymentPackages(postInstall.deployments)) packages.add(p)

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
