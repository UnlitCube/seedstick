import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ja } from './ja.js'

// ---------------------------------------------------------------------------
// 辞書に「誰も引かないキー」を残さない
// ---------------------------------------------------------------------------
//
// 使われないキーは訳すだけ無駄になる（9 言語なら 9 倍）。しかも「その機能は
// あるはずだ」と読めてしまう。以前は 33 個がそうなっていた（`review.exportYaml` など、
// 実装されていない機能の訳文だけが残っていた）。
//
// **数え方**: ソース（テストと辞書そのものを除く）に `'キー'` / `"キー"` / `` `キー` `` の
// 形で現れるかを見る。`t(\`step.${id}\`)` のように**組み立てるキー**は文字列としては
// 現れないので、下の DYNAMIC に「どこで組み立てているか」と一緒に載せる。
//
// **見ていないもの**: 引いているコードが実際に到達できるか（死んだ分岐の中で引いていても
// 「使われている」と数える）。

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const SCAN_DIRS = ['packages', 'apps', 'scripts', '.e2e']
const SKIP_DIRS = new Set(['node_modules', 'out', 'release', 'dev', 'installer-resources'])
const DICT_FILE = /[\\/]packages[\\/]shared[\\/]src[\\/]i18n[\\/][A-Za-z-]+\.ts$/

/** 組み立てて引くキーの接頭辞。ここに無い組み立ては使われていないと数えられる。 */
const DYNAMIC: readonly { prefix: string; where: string }[] = []

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx|mts|mjs|js)$/.test(name)) continue
      if (/\.test\.(ts|tsx)$/.test(name)) continue
      if (DICT_FILE.test(full) && !full.endsWith(`${sep}index.ts`) && !full.endsWith(`${sep}locales.ts`)) continue
      out.push({ file: relative(REPO_ROOT, full).split(sep).join('/'), text: readFileSync(full, 'utf8') })
    }
  }
  for (const d of SCAN_DIRS) walk(join(REPO_ROOT, d))
  return out
}

describe('辞書のキーの使われ方', () => {
  const files = sources()
  const body = files.map((f) => f.text).join('\n')

  it('走査対象を実際に読めている（空だと何も検証しない）', () => {
    const names = files.map((f) => f.file)
    expect(names.length).toBeGreaterThan(100)
    expect(names).toContain('apps/desktop/src/renderer/src/App.tsx')
    expect(names).toContain('packages/shared/src/autoinstall/validate.ts')
    expect(names).toContain('apps/desktop/src/main/ipc.ts')
    // 辞書そのものは数えない（数えると全キーが「使われている」になる）
    expect(names).not.toContain('packages/shared/src/i18n/ja.ts')
    expect(names).not.toContain('packages/shared/src/i18n/en.ts')
    expect(names.filter((n) => /\.test\.tsx?$/.test(n))).toEqual([])
  })

  it('誰も引かないキーが無い（組み立てて引くものは DYNAMIC に）', () => {
    const unused = (Object.keys(ja) as string[]).filter(
      (k) =>
        !body.includes(`'${k}'`) &&
        !body.includes(`"${k}"`) &&
        !body.includes(`\`${k}\``) &&
        !DYNAMIC.some((d) => k.startsWith(d.prefix)),
    )
    expect(unused, '辞書から消すか、使っている場所を DYNAMIC に書いてください').toEqual([])
  })

  it('DYNAMIC に死んだ接頭辞が残っていない', () => {
    const dead = DYNAMIC.filter((d) => !(Object.keys(ja) as string[]).some((k) => k.startsWith(d.prefix)))
    expect(dead).toEqual([])
  })

  it('検査そのものが効く（使っていないキーを足したら落ちる）', () => {
    const fake = 'nope.neverUsedAnywhere'
    expect(body.includes(`'${fake}'`)).toBe(false)
    // 実在して使われているキーは見つかる
    expect(body.includes(`'common.next'`)).toBe(true)
  })
})
