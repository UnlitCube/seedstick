import { afterAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { cleanupTempDirs, makeSparseFile, makeTempDir } from './test-support/temp-files.js'
import { join } from 'node:path'
import {
  createDefaultProfile,
  en,
  formatLocalized,
  ja,
  localized,
  LOCALES,
  placeholdersOf,
  recognizeIso,
  type AutoinstallProfile,
  type Deployment,
  type DeploymentSource,
  type LocalizedText,
  type MsgKey,
  type ProvisionFile,
} from '@autoinstall/shared'

// ===========================================================================
// GUI へ渡る文言の番人（main 側の実行時の契約）
// ===========================================================================
//
// ソースの直書き（`localized(` の第 1 引数、`message:` / `label:` /
// `blockedReason:` の日本語リテラル、死んだ辞書キー）の走査は
// `packages/media/src/localized-guard.test.ts` が **main のソースもまとめて**
// 見ている。ここに置いているのは「実際に値を作らせて確かめる」ぶんだけ。
//
// media 側の契約（`classifyDevice` / `WriteOp.label` / `LayoutError` /
// `DeviceRejectedError`）も同じファイルにある。分けているのは依存の向きのため
// （media は desktop を import できない）。

vi.mock('electron', () => ({
  app: { getName: (): string => 'Autoinstall USB Creator', getVersion: (): string => '0.1.0' },
}))

const { buildSeedBundle, SeedBuildError, MAX_PAYLOAD_BYTES } = await import('./seed-builder.js')
const { invalidIsoText, openIso, unsupportedIsoText } = await import('./iso-service.js')

/** 日本語（かな・カナ・漢字）。 */
const JAPANESE = /[぀-ヿ一-鿿]/u

const dict = (locale: 'ja' | 'en'): Record<string, string | undefined> =>
  (locale === 'ja' ? ja : en) as unknown as Record<string, string | undefined>

/**
 * `LocalizedText` が両言語で読め、**キーが辞書に実在する**こと。
 *
 * 辞書に無いキーは `createTranslator` がキー名をそのまま返す。画面には
 * `seed.reservedNameFoo` のような英数字が出るので、「英語に日本語が残って
 * いないか」だけを見る検査は**素通りする**。実在をここで見るのはそのため。
 */
function expectRenders(text: LocalizedText, where: string): void {
  expect(typeof text, `${where}: LocalizedText ではない`).toBe('object')
  expect(typeof text.key, `${where}: key が文字列でない`).toBe('string')
  expect(dict('ja')[text.key], `${where}: ja に "${text.key}" が無い`).toBeTypeOf('string')
  expect(dict('en')[text.key], `${where}: en に "${text.key}" が無い`).toBeTypeOf('string')
  for (const locale of LOCALES) {
    const rendered = formatLocalized(locale, text)
    expect(rendered, `${where} (${locale}): キー名がそのまま出ている`).not.toBe(text.key)
    // 差し込み忘れは `{name}` が残る（interpolate は空文字に落とさない）
    expect(placeholdersOf(rendered), `${where} (${locale}): 差し込みが埋まっていない`).toEqual([])
  }
  // 差し込む値（ファイル名など）は日本語でありうるので、ひな型だけを見る
  expect(
    formatLocalized('en', localized(text.key)),
    `${where}: en のひな型に日本語が残っている`,
  ).not.toMatch(JAPANESE)
  // IPC を JSON で往復しても同じもの
  expect(JSON.parse(JSON.stringify(text)) as unknown, `${where}: JSON 往復で変わる`).toEqual(text)
}

const keysWithPrefix = (prefix: string): string[] =>
  Object.keys(ja)
    .filter((k) => k.startsWith(prefix))
    .sort()

// ---------------------------------------------------------------------------
// SeedBuildError — CIDATA の組み立てが止まるすべての形
// ---------------------------------------------------------------------------

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

/**
 * 2 GiB 超のペイロードを疎なファイルで作る（実際にバイトは書かない）。
 *
 * **`truncateSync` だけでは NTFS で疎にならない。** 作成と後始末は
 * `test-support/temp-files.ts` に集約してある（以前ここに書き写した版が
 * 後始末を持たず、%TEMP% に 526 GB を積み上げた）。
 */
function hugePayload(): DeploymentSource {
  const path = makeSparseFile('seed-guard-', 'huge.tar.gz', MAX_PAYLOAD_BYTES + 1)
  return { kind: 'host-file', path, sizeBytes: MAX_PAYLOAD_BYTES + 1 }
}

/**
 * 「この設定を渡すとこのキーで止まる」表。
 * 下の it が辞書の `seed.*` と完全に一致することまで見るので、
 * 失敗の種類を 1 つ足して表に書き忘れたら落ちる。
 */
const SEED_ERROR_CASES: Record<string, () => AutoinstallProfile> = {
  'seed.reservedNameFile': () => withFiles([provisionFile('user-data')]),
  'seed.reservedNameDeployment': () =>
    withDeployments([deployment('meta-data', { kind: 'inline', content: 'x' })]),
  'seed.duplicateNameFile': () =>
    withFiles([provisionFile('app.conf'), provisionFile('APP.CONF')]),
  'seed.duplicateNameDeployment': () =>
    withDeployments([
      deployment('app.tar.gz', { kind: 'inline', content: 'a' }),
      deployment('APP.TAR.GZ', { kind: 'inline', content: 'b' }),
    ]),
  'seed.payloadTooLarge': () => withDeployments([deployment('app', hugePayload())]),
}

async function seedErrorOf(profile: AutoinstallProfile): Promise<InstanceType<typeof SeedBuildError>> {
  // `expect(...).rejects` に大きなオブジェクトを渡すと vitest が OOM する（落とし穴 42）
  try {
    await buildSeedBundle({
      profile,
      generateOptions: { comments: 'ja' },
      auditRecord: false,
      isoFileName: 'ubuntu-24.04.3-live-server-amd64.iso',
      isoFingerprint: 'deadbeef',
      minimumCidataSize: 64 * 1024 * 1024,
    })
  } catch (err) {
    if (err instanceof SeedBuildError) return err
    throw err
  }
  throw new Error('SeedBuildError が投げられなかった')
}

describe('SeedBuildError の文言', () => {
  it('すべての失敗が訳せる形で、辞書に実在するキーを運ぶ', async () => {
    for (const [key, makeProfile] of Object.entries(SEED_ERROR_CASES)) {
      const err = await seedErrorOf(makeProfile())
      expect(err.text.key, `${key} の入力が別の分岐に落ちている`).toBe(key)
      expectRenders(err.text, `SeedBuildError ${key}`)
      // 開発者向けの `message` は日本語のまま残す（ログが読む）が、
      // LocalizedText を素で埋めていないこと
      expect(err.message, `${key} の message`).not.toContain('[object Object]')
      expect(err.message.length).toBeGreaterThan(0)
    }
  })

  it('辞書の seed.* を 1 つも取りこぼしていない', () => {
    expect(Object.keys(SEED_ERROR_CASES).sort()).toEqual(keysWithPrefix('seed.'))
  })
})

// ---------------------------------------------------------------------------
// ISO の拒否理由
// ---------------------------------------------------------------------------
//
// `openIso` が返しうる `LocalizedText` は 8 つ。うち 6 つはここで実際に作らせる。
// 残り 2 つ（`iso.rejectPermission` / `error.unknown`）は OS の権限や想定外の
// 失敗を再現する必要があり、**このテストでは実際には踏んでいない**。
// キーが辞書にあり両言語で読めることだけを確かめる（ソース走査のほうが
// 「そのキーが実在するか」を別途見ている）。

const ISO_DIR = makeTempDir('iso-guard-')

describe('ISO の拒否理由の文言', () => {
  it('実際に踏める拒否がすべて訳せる形で、辞書に実在するキーを運ぶ', async () => {
    const seen: string[] = []
    const collect = async (path: string, where: string): Promise<void> => {
      const r = await openIso(path)
      expect(r.ok, `${where}: 拒否されるはずの ISO が受け入れられた`).toBe(false)
      if (r.ok) return
      expectRenders(r.text, `openIso ${where}`)
      seen.push(r.text.key)
    }

    await collect(join(ISO_DIR, 'missing.iso'), 'not-found')
    await collect(ISO_DIR, 'not-a-file')

    const garbage = join(ISO_DIR, 'garbage.iso')
    // ISO9660 の PVD は LBA 16。それより小さいファイルは構造から拒否される
    writeFileSync(garbage, Buffer.alloc(4096, 0))
    await collect(garbage, 'not-iso9660')

    // ISO の構造を理由にした拒否は 5 つある。実 ISO を用意せずに踏めるのは
    // `not-iso9660` だけなので、残り 4 つは割り当て関数から作って確かめる。
    // 一律 `iso.unsupported` に潰すと Callout のタイトルと本文が同じになる。
    for (const reason of [
      'no-casper',
      'no-grub-cfg',
      'no-kernel-line',
      'grub-too-large',
    ] as const) {
      const t = invalidIsoText(reason)
      expectRenders(t, `invalidIsoText ${reason}`)
      seen.push(t.key)
    }

    // 認識できなかった ISO の 3 分岐（実 ISO を用意せずに踏む）
    const desktop = recognizeIso('Ubuntu 24.04.1 LTS amd64')
    const proxmox = recognizeIso('PVE')
    expect(desktop.kind).toBe('unsupported')
    expect(proxmox.kind).toBe('unsupported')
    if (desktop.kind === 'unsupported') {
      const t = unsupportedIsoText(desktop.reason, desktop.detail)
      expectRenders(t, 'unsupportedIsoText not-server')
      seen.push(t.key)
    }
    if (proxmox.kind === 'unsupported') {
      const t = unsupportedIsoText(proxmox.reason, proxmox.detail)
      expectRenders(t, 'unsupportedIsoText not-ubuntu')
      seen.push(t.key)
    }
    const unknownSeries = unsupportedIsoText('unknown-series', '30.04')
    expectRenders(unknownSeries, 'unsupportedIsoText unknown-series')
    seen.push(unknownSeries.key)

    expect([...new Set(seen)].sort()).toEqual([
      'iso.notServer',
      'iso.rejectGrubTooLarge',
      'iso.rejectNoCasper',
      'iso.rejectNoGrubCfg',
      'iso.rejectNoKernelLine',
      'iso.rejectNotAFile',
      'iso.rejectNotFound',
      'iso.rejectNotIso9660',
      'iso.rejectNotUbuntu',
      'iso.unknownSeries',
    ])
    // 総称のキー（`IsoStep.tsx` が Callout の**タイトル**に使う）が
    // 本文として届かないこと。届くとタイトルと本文が同じ文字列になる。
    expect(seen).not.toContain('iso.unsupported')
  })

  it('踏めていない 2 つも辞書にあり、両言語で読める（実際の経路は未検証）', () => {
    // 権限エラーと想定外の失敗は OS 依存で再現できない。ここで見ているのは
    // 「キーが辞書にある」ことだけで、**その経路が本当にこのキーを返すかは
    // 見ていない**（ソース走査が localized() の引数として実在を見ている）。
    for (const key of ['iso.rejectPermission', 'error.unknown'] as const) {
      expectRenders(localized(key satisfies MsgKey), `openIso ${key}`)
    }
  })
})

// 疎ファイルでも作ったディレクトリは残る。**必ず消す。**
afterAll(() => {
  cleanupTempDirs()
})
