import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { app } from 'electron'
import { basename } from 'node:path'
import {
  generateAutoinstallYaml,
  generateMetaData,
  generateUserData,
  validateProfile,
  localized,
  type AutoinstallProfile,
  type GenerateOptions,
  type LocalizedText,
  isUnattendedProfile,
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
  /**
   * 画面に出す文言。main も CIDATA の組み立ても利用者の言語を知らないので、
   * **訳さずに運び、renderer が訳す**。
   *
   * `message`（日本語）は開発者向けの診断としてそのまま残す。ログとテストが読んでいる。
   */
  readonly text: LocalizedText

  constructor(message: string, text: LocalizedText) {
    super(message)
    this.name = 'SeedBuildError'
    this.text = text
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

  // 組み込みの名前は上書きさせない。`user-data` という名前の追加ファイルを許すと、
  // cloud-init が読む設定そのものが差し替わる（パスワードハッシュを含む）。
  //
  // 監査記録は後から push するので、この時点ではまだ files に無い。
  // 予約名に入れ忘れると重複検査を素通りし、同じ LFN を 2 つ持つ壊れた FAT ができる。
  // 設定の ON/OFF で結果が変わらないよう、auditRecord の値によらず常に予約する。
  const reserved = new Set([...files.map((f) => f.name.toLowerCase()), AUDIT_RECORD_NAME])
  const used = new Set(reserved)
  // 第 2 引数は**カテゴリの判別子**であって文言ではない。日本語の語句を受け取ると
  // `LocalizedText` の params には載せられない（params は string | number だけで、
  // 訳文を入れ子にできない）ので、カテゴリごとに別のキーを引く。
  const claim = (name: string, what: 'file' | 'deployment'): void => {
    const key = name.toLowerCase()
    const whatJa = what === 'file' ? '追加ファイル' : 'アプリの展開'
    if (reserved.has(key)) {
      throw new SeedBuildError(
        `${whatJa} の名前 "${name}" は設定用パーティションの予約名です。別の名前にしてください。`,
        localized(what === 'file' ? 'seed.reservedNameFile' : 'seed.reservedNameDeployment', { name }),
      )
    }
    if (used.has(key)) {
      // FAT は短縮名を ~1/~2 でずらすが LFN は同じままなので、
      // 同名エントリが 2 つある壊れたファイルシステムになる。
      throw new SeedBuildError(
        `${whatJa} の名前 "${name}" が重複しています。設定用パーティションには同じ名前を 2 つ置けません。`,
        localized(what === 'file' ? 'seed.duplicateNameFile' : 'seed.duplicateNameDeployment', { name }),
      )
    }
    used.add(key)
  }

  // GUI で直接書いたファイル
  for (const f of profile.postInstall.files) {
    claim(f.name, 'file')
    files.push({ name: f.name, content: Buffer.from(f.content, 'utf8') })
  }

  // アプリの展開（ホスト上のファイルを読み込んで同梱する）
  for (const d of profile.postInstall.deployments) {
    if (d.source.kind === 'url') continue // 初回起動時にダウンロードするので同梱しない
    claim(d.name, 'deployment')
    if (d.source.kind === 'inline') {
      files.push({ name: d.name, content: Buffer.from(d.source.content, 'utf8') })
      continue
    }
    try {
      // サイズは読む前に見る。Node の readFile は 2 GiB を超えると
      // ERR_FS_FILE_TOO_LARGE を投げるので、読んでから長さを見る書き方だと
      // このエラーが下の catch に落ち、「ファイルが見つかりません」に化けていた。
      const info = await stat(d.source.path)
      if (info.size > MAX_PAYLOAD_BYTES) {
        // 数値の整形は main 側で済ませる。`LocalizedText` の params は string | number だけで、
        // 「単位付きの表記」まで運べない（renderer の formatBytes は main から使えない）。
        const name = basename(d.source.path)
        const size = `${(info.size / 1e9).toFixed(2)} GB`
        const limit = `${Math.round(MAX_PAYLOAD_BYTES / 1024 ** 3)} GB`
        throw new SeedBuildError(
          `${name} は ${size} あり、USB の設定用パーティションに載せられません（上限 ${limit}）。URL からのダウンロードに切り替えてください。`,
          localized('seed.payloadTooLarge', { name, size, limit }),
        )
      }
      const content = await readFile(d.source.path)
      files.push({ name: d.name, content })
    } catch (err) {
      if (err instanceof SeedBuildError) throw err
      missingSources.push(d.source.path)
    }
  }

  if (options.auditRecord) {
    files.push({
      name: AUDIT_RECORD_NAME,
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

/**
 * 監査記録のファイル名。**予約名**として扱う（追加ファイルや展開に同じ名前を許さない）。
 * 小文字で持つ（FAT の名前比較は大小を区別しない）。
 */
const AUDIT_RECORD_NAME = 'autoinstall-usb.json'

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
    // GUI の表示と同じ判定を使う。設定だけを見ると、シリーズ差や
    // 上書き YAML 経由で入った interactive-sections / active-directory を見落とす。
    unattended: isUnattendedProfile(profile, options.generateOptions),
    validationOk: validation.ok,
  }
}
