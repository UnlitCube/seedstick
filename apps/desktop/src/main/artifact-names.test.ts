import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// **成果物の名前を、electron-builder 自身の関数で計算して突き合わせる。**
//
// `artifactName` の `${arch}` は**拡張子によって書き換わる**
// （builder-util の getArtifactArchName: x64 は AppImage / rpm で `x86_64`、
// deb / snap で `amd64`）。設定の文字列を目で見ただけでは分からないので、
// `-linux-${arch}` と書いた deb は `-linux-amd64.deb` になり、
// release.yml の `test -f "...-linux-x64.deb"` が落ちて **Release が 1 つも出ない**
// ところだった（落とし穴 158。監査で見つかった。CI はまだ一度もこの経路を通っていない）。
//
// 見るもの:
//   1. 名前が `[0-9A-Za-z._-]` だけ（GitHub は空白をドットに変える。落とし穴 152）
//   2. 2 つの設定（本体 / インストーラ）を合わせて名前が重ならない（落とし穴 131）
//   3. release.yml が `test -f` で探す名前が、実際に作られる名前の中にある
//   4. サイトのダウンロードボタン（docs-site/assets.mjs）が、作られる名前に 1 対 1 で当たる
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

const require = createRequire(join(REPO_ROOT, 'apps/desktop/package.json'))
const builderUtil = require('builder-util') as {
  getArtifactArchName(arch: number, ext: string): string
  Arch: Record<string, number>
}

const VERSION = (JSON.parse(read('apps/desktop/package.json')) as { version: string }).version

interface TargetEntry {
  readonly target: string
  readonly arch?: readonly string[]
}
interface PlatformConfig {
  readonly target?: readonly (string | TargetEntry)[]
  readonly artifactName?: string
}
type BuilderConfig = Record<string, unknown> & {
  readonly artifactName?: string
  readonly win?: PlatformConfig
  readonly mac?: PlatformConfig
  readonly linux?: PlatformConfig
}

/** target 名 → その target 固有の設定のキー（artifactName を上書きできる場所）と拡張子 */
const TARGETS: Record<string, { readonly key: string | null; readonly ext: string }> = {
  portable: { key: 'portable', ext: 'exe' },
  nsis: { key: 'nsis', ext: 'exe' },
  dmg: { key: 'dmg', ext: 'dmg' },
  zip: { key: null, ext: 'zip' },
  AppImage: { key: 'appImage', ext: 'AppImage' },
  deb: { key: 'deb', ext: 'deb' },
}

interface Artifact {
  readonly config: string
  readonly target: string
  readonly arch: string
  readonly name: string
}

function artifactsOf(file: string): Artifact[] {
  const cfg = JSON.parse(read(file)) as BuilderConfig
  const out: Artifact[] = []
  for (const platform of ['win', 'mac', 'linux'] as const) {
    const p = cfg[platform]
    if (!p?.target) continue
    for (const t of p.target) {
      const target = typeof t === 'string' ? t : t.target
      const archs = typeof t === 'string' ? ['x64'] : (t.arch ?? ['x64'])
      const spec = TARGETS[target]
      if (!spec) throw new Error(`この表に無い target: ${target}（${file}）`)
      const own = spec.key === null ? undefined : (cfg[spec.key] as { artifactName?: string } | undefined)
      const pattern = own?.artifactName ?? p.artifactName ?? cfg.artifactName
      if (!pattern) throw new Error(`artifactName が無い: ${file} ${target}`)
      for (const arch of archs) {
        const archName = builderUtil.getArtifactArchName(builderUtil.Arch[arch]!, spec.ext)
        const name = pattern
          .replaceAll('${version}', VERSION)
          .replaceAll('${arch}', archName)
          .replaceAll('${ext}', spec.ext)
        out.push({ config: file, target, arch, name })
      }
    }
  }
  return out
}

const ARTIFACTS = [
  ...artifactsOf('apps/desktop/electron-builder.json'),
  ...artifactsOf('apps/desktop/electron-builder.installer.json'),
]
/** Release に載せるもの（本体の portable は win-unpacked から作るので載る。インストーラは Setup.exe だけ）。 */
const NAMES = ARTIFACTS.map((a) => a.name)

describe('成果物の名前', () => {
  it('計算できている（空振りしていない）', () => {
    expect(ARTIFACTS.length).toBeGreaterThanOrEqual(7)
  })

  it('GitHub が書き換えない文字だけでできている（落とし穴 152）', () => {
    for (const n of NAMES) expect(n, n).toMatch(/^[0-9A-Za-z._-]+$/)
  })

  it('2 つの設定を合わせて重ならない（落とし穴 131）', () => {
    expect(new Set(NAMES).size).toBe(NAMES.length)
  })

  it('release.yml が探す名前が、実際に作られる（落とし穴 158）', () => {
    const yml = read('.github/workflows/release.yml')
    const expected: string[] = []
    for (const m of yml.matchAll(/test -f "(Seedstick-\$v-[^"]+)"/g)) {
      const raw = m[1]!.replace('$v', VERSION)
      // mac は `$a` に x64 / arm64 が入るループ
      if (raw.includes('$a')) for (const a of ['x64', 'arm64']) expected.push(raw.replace('$a', a))
      else expected.push(raw)
    }
    expect(expected.length).toBeGreaterThanOrEqual(7)
    for (const e of expected) expect(NAMES, `release.yml が探す ${e}`).toContain(e)
  })

  it('サイトのダウンロードボタンが作られる名前に 1 対 1 で当たる', async () => {
    const mod = (await import(pathToFileURL(join(REPO_ROOT, 'docs-site/assets.mjs')).href)) as {
      ASSET_PATTERNS: Record<string, RegExp>
    }
    const patterns = Object.entries(mod.ASSET_PATTERNS).filter(([k]) => k !== 'sums')
    for (const [key, re] of patterns) {
      const hits = NAMES.filter((n) => re.test(n))
      expect(hits, `${key} ${re}`).toHaveLength(1)
    }
    // 逆向き: どのボタンにも当たらない成果物があれば、サイトから落とせない
    for (const n of NAMES) {
      expect(
        patterns.some(([, re]) => re.test(n)),
        `${n} に当たるボタンが無い`,
      ).toBe(true)
    }
  })
})
