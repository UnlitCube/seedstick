import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { app } from 'electron'
import { basename } from 'node:path'
import {
  generateAutoinstallYaml,
  generateMetaData,
  generateUserData,
  validateProfile,
  type AutoinstallProfile,
  type GenerateOptions,
} from '@autoinstall/shared'
import { ALIGNMENT_BYTES, DEFAULT_CIDATA_SIZE_BYTES } from '@autoinstall/media'

// CIDATA パーティションに載せるファイル一式を組み立てる。
// ここが「GUI で作った設定」と「USB に実際に書かれる内容」の接続点。

export interface SeedFile {
  readonly name: string
  readonly content: Buffer
}

export interface SeedBundle {
  readonly files: readonly SeedFile[]
  /** ペイロードが入るように調整した CIDATA のサイズ（512 の倍数） */
  readonly cidataSizeBytes: number
  /** 元ファイルが見つからなかったペイロード（UI で知らせる） */
  readonly missingSources: readonly string[]
}

/** FAT32 の 1 ファイル上限は 4 GiB - 1。安全側に 2 GiB で切る。 */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024 * 1024

export class SeedBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedBuildError'
  }
}

/**
 * CIDATA の必要サイズを決める。
 * ペイロードの合計 + FAT のメタデータ + 余裕を見て 1 MiB 単位に切り上げる。
 */
export function requiredCidataSize(payloadBytes: number, minimum = DEFAULT_CIDATA_SIZE_BYTES): number {
  // FAT のメタデータとクラスタ端数のため 1.15 倍 + 8 MiB を見込む
  const needed = Math.ceil(payloadBytes * 1.15) + 8 * 1024 * 1024
  const size = Math.max(minimum, needed)
  return Math.ceil(size / ALIGNMENT_BYTES) * ALIGNMENT_BYTES
}

export interface BuildSeedOptions {
  readonly profile: AutoinstallProfile
  readonly generateOptions: GenerateOptions
  /** 監査記録を入れるか */
  readonly auditRecord: boolean
  /** ISO の識別情報（監査記録に入れる） */
  readonly isoFileName: string
  readonly isoFingerprint: string
  /** 設定で決めた CIDATA の最小サイズ */
  readonly minimumCidataSize: number
}

export async function buildSeedBundle(options: BuildSeedOptions): Promise<SeedBundle> {
  const { profile } = options
  const files: SeedFile[] = []
  const missingSources: string[] = []

  const userData = generateUserData(profile, options.generateOptions)
  const metaData = generateMetaData(`autoinstall-${profile.basics.hostname || 'ubuntu'}`)
  const autoinstallYaml = generateAutoinstallYaml(profile, options.generateOptions)

  files.push(
    { name: 'user-data', content: Buffer.from(userData, 'utf8') },
    { name: 'meta-data', content: Buffer.from(metaData, 'utf8') },
    // 人が読む用の控え。cloud-init はこのファイルを見ない。
    { name: 'autoinstall.yaml.txt', content: Buffer.from(autoinstallYaml, 'utf8') },
  )

  // GUI で直接書いたファイル
  for (const f of profile.postInstall.files) {
    files.push({ name: f.name, content: Buffer.from(f.content, 'utf8') })
  }

  // アプリの展開（ホスト上のファイルを読み込んで同梱する）
  for (const d of profile.postInstall.deployments) {
    if (d.source.kind === 'url') continue // 初回起動時にダウンロードするので同梱しない
    if (d.source.kind === 'inline') {
      files.push({ name: d.name, content: Buffer.from(d.source.content, 'utf8') })
      continue
    }
    try {
      const content = await readFile(d.source.path)
      if (content.length > MAX_PAYLOAD_BYTES) {
        throw new SeedBuildError(
          `${basename(d.source.path)} は ${(content.length / 1e9).toFixed(2)} GB あり、USB の設定用パーティションに載せられません（上限 2 GB）。URL からのダウンロードに切り替えてください。`,
        )
      }
      files.push({ name: d.name, content })
    } catch (err) {
      if (err instanceof SeedBuildError) throw err
      missingSources.push(d.source.path)
    }
  }

  if (options.auditRecord) {
    files.push({
      name: 'autoinstall-usb.json',
      content: Buffer.from(`${JSON.stringify(buildAuditRecord(options, userData), null, 2)}\n`, 'utf8'),
    })
  }

  const payloadBytes = files.reduce((n, f) => n + f.content.length, 0)
  return {
    files,
    cidataSizeBytes: requiredCidataSize(payloadBytes, options.minimumCidataSize),
    missingSources,
  }
}

/** 監査用の作成記録。パスワードは含めず、設定のハッシュだけを残す。 */
function buildAuditRecord(options: BuildSeedOptions, userData: string): Record<string, unknown> {
  const { profile } = options
  const validation = validateProfile(profile)
  return {
    tool: `${app.getName()} ${app.getVersion()}`,
    createdAt: new Date().toISOString(),
    isoFile: options.isoFileName,
    isoFingerprint: options.isoFingerprint,
    ubuntuSeries: profile.series,
    profileName: profile.meta.name,
    hostname: profile.basics.hostname,
    username: profile.user.username,
    additionalUsers: profile.postInstall.additionalUsers.map((u) => u.username),
    services: profile.postInstall.services.map((s) => s.name),
    deployments: profile.postInstall.deployments.map((d) => ({
      name: d.name,
      target: d.targetPath,
      source: d.source.kind,
    })),
    gpu: profile.software.gpu.enabled
      ? { driver: profile.software.gpu.driver, toolkit: profile.software.gpu.toolkit }
      : null,
    profileSha256: createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
    userDataSha256: createHash('sha256').update(userData).digest('hex'),
    unattended: profile.behavior.interactiveSections.length === 0,
    validationOk: validation.ok,
  }
}
