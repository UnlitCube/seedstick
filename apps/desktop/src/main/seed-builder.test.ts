import { afterAll, describe, expect, it, vi } from 'vitest'
import { cleanupTempDirs, makeSparseFile } from './test-support/temp-files.js'
import {
  createDefaultProfile,
  formatLocalized,
  type AutoinstallProfile,
  type Deployment,
  type DeploymentSource,
  type ProvisionFile,
} from '@autoinstall/shared'

// seed-builder は監査記録にアプリ名を入れるので electron に依存する。
// main のモジュールは import する前にモックを置く必要がある。
vi.mock('electron', () => ({
  app: { getName: (): string => 'Seedstick', getVersion: (): string => '0.1.0' },
}))

const { buildSeedBundle, SeedBuildError, MAX_PAYLOAD_BYTES } = await import('./seed-builder.js')

function provisionFile(name: string): ProvisionFile {
  return { name, targetPath: `/tmp/${name}`, mode: '0644', owner: 'root', content: 'x' }
}

function deployment(name: string, source: DeploymentSource): Deployment {
  return {
    id: `id-${name}`,
    kind: 'archive',
    name,
    source,
    targetPath: '/opt/app',
    owner: 'root',
    group: 'root',
    mode: '0644',
    archiveFormat: 'tar.gz',
    postCommand: '',
    chownRecursive: false,
  }
}

function withFiles(files: readonly ProvisionFile[]): AutoinstallProfile {
  const p = createDefaultProfile()
  return { ...p, postInstall: { ...p.postInstall, files } }
}

function withDeployments(deployments: readonly Deployment[]): AutoinstallProfile {
  const p = createDefaultProfile()
  return { ...p, postInstall: { ...p.postInstall, deployments } }
}

async function build(profile: AutoinstallProfile): Promise<unknown> {
  return buildSeedBundle({
    profile,
    generateOptions: { comments: 'ja' },
    auditRecord: false,
    isoFileName: 'ubuntu-24.04.3-live-server-amd64.iso',
    isoFingerprint: 'deadbeef',
    minimumCidataSize: 64 * 1024 * 1024,
  })
}

/** 投げられた SeedBuildError を「型が細った状態で」取り出す。 */
async function catchSeedError(profile: AutoinstallProfile): Promise<InstanceType<typeof SeedBuildError>> {
  // `expect(...).rejects` に大きなオブジェクトを渡すと vitest が OOM するので自前で捕まえる。
  try {
    await build(profile)
  } catch (err) {
    if (err instanceof SeedBuildError) return err
    throw err
  }
  throw new Error('SeedBuildError が投げられなかった')
}

// 文言は main（と昇格ワーカー）では訳さず、キーのまま renderer へ運ぶ。
// ここで日本語の文面を `toContain` で固定すると、English に切り替えたときに
// 日本語が出る実装をテストが「正」として要求してしまう（落とし穴 56）。
describe('SeedBuildError は訳せる文言を運ぶ', () => {
  it('予約名（追加ファイル）はキーと名前を運ぶ', async () => {
    const err = await catchSeedError(withFiles([provisionFile('user-data')]))
    expect(err.text.key).toBe('seed.reservedNameFile')
    expect(err.text.params).toEqual({ name: 'user-data' })
    // 開発者向けの `message` は日本語のまま残す（ログとテストが読んでいる）
    expect(err.message).toContain('user-data')
  })

  it('予約名（アプリの展開）は展開用の別キーになる', async () => {
    const err = await catchSeedError(
      withDeployments([deployment('meta-data', { kind: 'inline', content: 'x' })]),
    )
    expect(err.text.key).toBe('seed.reservedNameDeployment')
    expect(err.text.params).toEqual({ name: 'meta-data' })
  })

  it('重複名は「重複」のキーになる（予約名と混ざらない）', async () => {
    const err = await catchSeedError(
      withFiles([provisionFile('app.conf'), provisionFile('APP.CONF')]),
    )
    expect(err.text.key).toBe('seed.duplicateNameFile')
    expect(err.text.params).toEqual({ name: 'APP.CONF' })
  })

  it('大きすぎるペイロードは整形済みのサイズを差し込みで運ぶ', async () => {
    // 2 GiB を実際に書くわけにはいかないので、大きさだけの疎ファイルを作る。
    // **`truncateSync` だけでは NTFS で疎にならず、本当に 2 GB 確保される。**
    // しかも以前は後始末が無く、実行のたびに残って 526 GB を食い潰した。
    // 作成も後始末も `test-support/temp-files.ts` に集約してある。
    const path = makeSparseFile('seed-payload-', 'huge.tar.gz', MAX_PAYLOAD_BYTES + 1)

    const err = await catchSeedError(
      withDeployments([
        deployment('app', { kind: 'host-file', path, sizeBytes: MAX_PAYLOAD_BYTES + 1 }),
      ]),
    )
    expect(err.text.key).toBe('seed.payloadTooLarge')
    // 単位付きの表記は main 側で整形して渡す（params は string | number しか運べない）
    expect(err.text.params).toEqual({ name: 'huge.tar.gz', size: '2.15 GB', limit: '2 GB' })
  })
})

describe('運ばれた LocalizedText は両方の言語で読める', () => {
  it('英語に切り替えると英文になる（日本語が残らない）', async () => {
    const err = await catchSeedError(withFiles([provisionFile('user-data')]))
    const en = formatLocalized('en', err.text)
    expect(en).toContain('user-data')
    expect(en).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
    expect(formatLocalized('ja', err.text)).toMatch(/[ぁ-んァ-ヶ一-龠]/u)
  })

  it('JSON を往復しても同じものになる（IPC / NDJSON を通る）', async () => {
    const err = await catchSeedError(withFiles([provisionFile('user-data')]))
    const round = JSON.parse(JSON.stringify(err.text)) as typeof err.text
    expect(round).toEqual(err.text)
    expect(formatLocalized('en', round)).toBe(formatLocalized('en', err.text))
  })
})

// 疎ファイルでも作ったディレクトリは残る。**必ず消す。**
afterAll(() => {
  cleanupTempDirs()
})
