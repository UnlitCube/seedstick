// インストール後のプロビジョニング（追加ユーザー・アプリ展開・systemd サービス・GPU）。
// autoinstall の標準キーだけでは表現できないので、late-commands と cloud-init の
// user-data に落として実現する。

import type { UbuntuSeries } from './model.js'

// ---------------------------------------------------------------------------
// 追加ユーザー
// ---------------------------------------------------------------------------

export type SudoMode = 'none' | 'password' | 'nopasswd'

/**
 * 管理者ユーザー（autoinstall の `identity`）とは別に作るユーザー。
 * インストーラが作るのは identity の 1 人だけなので、ここは late-commands の
 * `useradd` で作る（cloud-init の `users:` を使うと identity と競合しうる）。
 */
export interface AdditionalUser {
  readonly id: string
  readonly username: string
  readonly realname: string
  /** crypt(3) ハッシュ。空ならパスワードログイン不可（鍵のみ、または純粋なサービス用）。 */
  readonly passwordHash: string
  readonly sudo: SudoMode
  /** 追加で所属させるグループ（存在しないグループは作らない） */
  readonly groups: readonly string[]
  readonly shell: string
  readonly sshAuthorizedKeys: readonly string[]
  /** ホームディレクトリを作る。サービス専用アカウントなら false でもよい。 */
  readonly createHome: boolean
  /** システムアカウント (`useradd -r`)。UID が 1000 未満になり、ログイン用途ではなくなる。 */
  readonly systemAccount: boolean
}

export const SHELL_CHOICES = [
  { value: '/bin/bash', labelJa: 'bash（標準）', labelEn: 'bash (default)' },
  { value: '/bin/sh', labelJa: 'sh', labelEn: 'sh' },
  { value: '/usr/sbin/nologin', labelJa: 'ログイン不可（サービス用）', labelEn: 'No login (for services)' },
] as const

// ---------------------------------------------------------------------------
// アプリの展開
// ---------------------------------------------------------------------------

export type ArchiveFormat = 'tar.gz' | 'tar.xz' | 'tar.bz2' | 'tar' | 'zip'

/** 展開に必要な追加パッケージ（live 環境に無いものだけ） */
export const ARCHIVE_REQUIREMENTS: Record<ArchiveFormat, readonly string[]> = {
  'tar.gz': [],
  'tar.xz': ['xz-utils'],
  'tar.bz2': ['bzip2'],
  tar: [],
  zip: ['unzip'],
}

export function detectArchiveFormat(fileName: string): ArchiveFormat | null {
  const n = fileName.toLowerCase()
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) return 'tar.gz'
  if (n.endsWith('.tar.xz') || n.endsWith('.txz')) return 'tar.xz'
  if (n.endsWith('.tar.bz2') || n.endsWith('.tbz2')) return 'tar.bz2'
  if (n.endsWith('.tar')) return 'tar'
  if (n.endsWith('.zip')) return 'zip'
  return null
}

export type DeploymentSource =
  /** GUI で直接入力したテキスト */
  | { readonly kind: 'inline'; readonly content: string }
  /** ホスト上のファイル。書き込み時に main が読んで CIDATA に載せる。 */
  | { readonly kind: 'host-file'; readonly path: string; readonly sizeBytes: number }
  /** インストール先の初回起動時に URL から取得する（USB 容量を使わない） */
  | { readonly kind: 'url'; readonly url: string; readonly sha256: string }

/** USB に同梱、または初回起動時に取得して、インストール先へ展開するもの。 */
export interface Deployment {
  readonly id: string
  /** `file` は 1 ファイルをそのまま配置、`archive` は展開する */
  readonly kind: 'file' | 'archive'
  /** CIDATA 上のファイル名。URL 取得の場合は一時ファイル名として使う。 */
  readonly name: string
  readonly source: DeploymentSource
  /** `file` なら配置先の絶対パス、`archive` なら展開先ディレクトリ */
  readonly targetPath: string
  readonly owner: string
  readonly group: string
  /** `file` のパーミッション（8 進数） */
  readonly mode: string
  /** `archive` の形式 */
  readonly archiveFormat: ArchiveFormat
  /** 展開後に targetPath で実行するコマンド（空なら何もしない） */
  readonly postCommand: string
  /** 展開先を丸ごと owner:group にする */
  readonly chownRecursive: boolean
}

// ---------------------------------------------------------------------------
// systemd サービス
// ---------------------------------------------------------------------------

export type ServiceType = 'simple' | 'exec' | 'forking' | 'oneshot' | 'notify'
export type RestartPolicy = 'no' | 'on-failure' | 'always'

/** インストール先に登録する systemd ユニット。 */
export interface SystemdService {
  readonly id: string
  /** `.service` を除いた名前（例 `myapp`） */
  readonly name: string
  readonly description: string
  readonly execStart: string
  readonly execStartPre: string
  readonly workingDirectory: string
  readonly user: string
  readonly group: string
  /** `KEY=VALUE` の並び */
  readonly environment: readonly string[]
  readonly environmentFile: string
  readonly serviceType: ServiceType
  readonly restart: RestartPolicy
  readonly restartSec: number
  /** `After=` に入れるユニット */
  readonly after: readonly string[]
  readonly wantedBy: string
  /** インストール時に `systemctl enable` するか */
  readonly enabled: boolean
}

const SERVICE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.@-]*$/

export function isValidServiceName(name: string): boolean {
  return SERVICE_NAME_RE.test(name) && !name.endsWith('.service')
}

/** systemd ユニットファイルの内容を組み立てる。 */
export function renderServiceUnit(svc: SystemdService): string {
  const lines: string[] = ['[Unit]']
  if (svc.description) lines.push(`Description=${svc.description}`)
  for (const a of svc.after) lines.push(`After=${a}`)
  // network-online.target は After だけでは不十分で Wants も要る（systemd の作法）
  if (svc.after.includes('network-online.target')) lines.push('Wants=network-online.target')

  lines.push('', '[Service]', `Type=${svc.serviceType}`)
  if (svc.user) lines.push(`User=${svc.user}`)
  if (svc.group) lines.push(`Group=${svc.group}`)
  if (svc.workingDirectory) lines.push(`WorkingDirectory=${svc.workingDirectory}`)
  if (svc.environmentFile) lines.push(`EnvironmentFile=${svc.environmentFile}`)
  for (const e of svc.environment) if (e.trim()) lines.push(`Environment=${e.trim()}`)
  if (svc.execStartPre) lines.push(`ExecStartPre=${svc.execStartPre}`)
  lines.push(`ExecStart=${svc.execStart}`)
  if (svc.restart !== 'no') {
    lines.push(`Restart=${svc.restart}`, `RestartSec=${svc.restartSec}`)
  }

  lines.push('', '[Install]', `WantedBy=${svc.wantedBy}`, '')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// GPU / CUDA
// ---------------------------------------------------------------------------

export type CudaDriverChoice = 'none' | 'open' | 'proprietary'

export interface GpuConfig {
  readonly enabled: boolean
  /**
   * ドライバの入れ方。
   * `open` は NVIDIA のオープンカーネルモジュール（Turing 以降で推奨）、
   * `proprietary` は従来のクローズドドライバ（Maxwell〜Volta の古い GPU 向け）。
   */
  readonly driver: CudaDriverChoice
  /** `none` / `latest`（`cuda-toolkit`）/ `cuda-toolkit-13-3` のようなピン留め */
  readonly toolkit: string
  /** `/etc/profile.d` に PATH と LD_LIBRARY_PATH を設定する */
  readonly setupPath: boolean
  /** Docker から GPU を使えるようにする（nvidia-container-toolkit） */
  readonly containerToolkit: boolean
}

/**
 * NVIDIA の CUDA リポジトリが存在する Ubuntu シリーズ。
 * 2026-09-03 時点で `ubuntu2510` は 404（リポジトリ自体が無い）。
 */
export const CUDA_REPO_DISTRO: Record<UbuntuSeries, string | null> = {
  '22.04': 'ubuntu2204',
  '24.04': 'ubuntu2404',
  '25.10': null,
  '26.04': 'ubuntu2604',
}

/** リポジトリに存在することを確認済みのツールキット。新しい順。 */
export const CUDA_TOOLKIT_CHOICES = [
  { value: 'latest', labelJa: '最新版 (cuda-toolkit)', labelEn: 'Latest (cuda-toolkit)' },
  { value: 'cuda-toolkit-13-3', labelJa: 'CUDA 13.3', labelEn: 'CUDA 13.3' },
  { value: 'cuda-toolkit-13-2', labelJa: 'CUDA 13.2', labelEn: 'CUDA 13.2' },
  { value: 'cuda-toolkit-13-1', labelJa: 'CUDA 13.1', labelEn: 'CUDA 13.1' },
  { value: 'cuda-toolkit-13-0', labelJa: 'CUDA 13.0', labelEn: 'CUDA 13.0' },
  { value: 'cuda-toolkit-12-9', labelJa: 'CUDA 12.9', labelEn: 'CUDA 12.9' },
  { value: 'cuda-toolkit-12-8', labelJa: 'CUDA 12.8', labelEn: 'CUDA 12.8' },
  { value: 'cuda-toolkit-12-6', labelJa: 'CUDA 12.6', labelEn: 'CUDA 12.6' },
  { value: 'none', labelJa: 'ツールキットを入れない（ドライバのみ）', labelEn: 'Driver only' },
] as const

/** CUDA のインストールに必要な apt パッケージ名を組み立てる。 */
export function cudaPackages(gpu: GpuConfig): string[] {
  const pkgs: string[] = []
  if (gpu.driver === 'open') pkgs.push('nvidia-open')
  else if (gpu.driver === 'proprietary') pkgs.push('cuda-drivers')
  if (gpu.toolkit === 'latest') pkgs.push('cuda-toolkit')
  else if (gpu.toolkit !== 'none') pkgs.push(gpu.toolkit)
  if (gpu.containerToolkit) pkgs.push('nvidia-container-toolkit')
  return pkgs
}

export const CUDA_KEYRING_VERSION = '1.1-1'

/** NVIDIA の keyring deb の URL。 */
export function cudaKeyringUrl(series: UbuntuSeries): string | null {
  const distro = CUDA_REPO_DISTRO[series]
  if (!distro) return null
  return `https://developer.download.nvidia.com/compute/cuda/repos/${distro}/x86_64/cuda-keyring_${CUDA_KEYRING_VERSION}_all.deb`
}
