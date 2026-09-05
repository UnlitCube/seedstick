import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ja } from '@autoinstall/shared'

// ---------------------------------------------------------------------------
// **`.e2e/` の入力欄は placeholder の文言で探している。文言が変わると空振りする。**
//
// `full-run.mjs` は `fillByPlaceholder('192.168.1.50/24', …)` を探していたが、
// `NetworkStep.tsx` の実物は `192.168.1.10/24` で、**一度も一致していなかった**。
// しかも `.catch(() => {})` で握り潰していたので、固定 IP を一切入れないまま
// 「ネットワークを設定できた」と緑になっていた。
// 「テストが壊れているのに緑」は、このリポジトリが何度も出している壊れ方
// （落とし穴 56 / 57 と同じ根）なので、機械で見張る。
//
// `fillByPlaceholder` は `[placeholder="…"]` を組み立てる CSS 属性セレクタなので、
// **前方一致でも部分一致でもなく完全一致**。1 文字違えば必ず落ちる。
//
// **ここに置いてある理由**: 中身は renderer のソースを *テキストとして* 読むだけだが、
// `node:fs` が要る。renderer の tsconfig は `types: ["vite/client"]` で Node の型を
// 持たない（CLAUDE.md の規約。`renderer/src/lib/i18n.test.ts` は同じ理由で
// `node:fs` を避けている）ので、Node 側の tsconfig が見る `src/main/` に置く。
// renderer のコードは **import しない**（読むのはファイルの中身だけ）。
//
// 見ているのは「文言が実在するか」だけで、「その画面に到達できるか」は見ない
// （それは GUI を起こさないと分からない）。安い方の検査。
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const E2E_DIR = join(REPO_ROOT, '.e2e')
const RENDERER_DIR = join(REPO_ROOT, 'apps/desktop/src/renderer/src')

function rendererFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(RENDERER_DIR, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue
    out.push(readFileSync(join(entry.parentPath, entry.name), 'utf8'))
  }
  return out
}

/**
 * `placeholder=` の値になりうる文字列を集める。
 *
 * 3 つの書き方があり、**どれか 1 つだけを見ると誤検出する**
 * （`placeholder="…"` だけを見ていて、`placeholder={'…'}` の
 * `full-run2.mjs` の webhook を「実在しない」と誤判定した）。
 *
 *   1. `placeholder="ubuntu-server"`
 *   2. `placeholder={'https://hooks.example.com/install'}` / 三項演算子で 2 つ以上
 *   3. `placeholder={t('write.confirmWord')}` — 実物は訳文なので `ja` から引く
 */
function placeholderTexts(): Set<string> {
  const found = new Set<string>()
  const dict = ja as Record<string, string>
  for (const src of rendererFiles()) {
    for (const m of src.matchAll(/placeholder=/g)) {
      const start = m.index + m[0].length
      let region: string
      if (src[start] === '{') {
        // 対応する `}` まで（三項演算子・複数行を丸ごと拾う）。
        let depth = 0
        let i = start
        for (; i < src.length; i += 1) {
          if (src[i] === '{') depth += 1
          else if (src[i] === '}') {
            depth -= 1
            if (depth === 0) break
          }
        }
        region = src.slice(start, i + 1)
      } else {
        region = src.slice(start, src.indexOf('\n', start))
      }
      for (const lit of region.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
        const value = lit[1] ?? lit[2] ?? ''
        found.add(value)
        // `t('key')` は訳文が実物になる。
        const translated = dict[value]
        if (typeof translated === 'string') found.add(translated)
      }
    }
  }
  return found
}

/** `.e2e/*.mjs` が探している placeholder（`drive.mjs` の定義そのものは除く）。 */
function requestedPlaceholders(): { file: string; value: string }[] {
  const found: { file: string; value: string }[] = []
  for (const entry of readdirSync(E2E_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs') || entry.name === 'drive.mjs') continue
    const src = readFileSync(join(E2E_DIR, entry.name), 'utf8')
    for (const m of src.matchAll(/fillByPlaceholder\(\s*'([^']+)'/g)) {
      found.push({ file: entry.name, value: m[1]! })
    }
  }
  return found
}

describe('.e2e/ が探す placeholder は renderer に実在する', () => {
  it('走査対象を実際に読めている（空の検査になっていない）', () => {
    // これが無いと、パスを間違えた瞬間に「0 件を検査して緑」になる。
    const requested = requestedPlaceholders()
    expect(requested.length, '.e2e/ の fillByPlaceholder を 1 件も読めていない').toBeGreaterThan(8)
    expect(requested.map((r) => r.file)).toContain('full-run.mjs')
    expect(requested.map((r) => r.file)).toContain('full-run2.mjs')

    const texts = placeholderTexts()
    expect(texts.size, 'renderer の placeholder を読めていない').toBeGreaterThan(30)
    // 3 つの書き方をそれぞれ 1 つずつ踏む（読めているのは片方だけ、を防ぐ）。
    expect(texts, '`placeholder="…"` を読めていない').toContain('192.168.1.10/24')
    expect(texts, "`placeholder={'…'}` を読めていない").toContain(
      'https://hooks.example.com/install',
    )
    expect(texts, '`placeholder={t(…)}` の訳文を引けていない').toContain(ja['write.confirmWord'])
  })

  it('探している placeholder がすべて renderer 側に存在する', () => {
    const texts = placeholderTexts()
    const missing = requestedPlaceholders().filter((r) => !texts.has(r.value))
    expect(
      missing.map((m) => `${m.file}: ${m.value}`),
      '.e2e/ が実在しない placeholder を探している（完全一致なので必ず空振りする）',
    ).toEqual([])
  })

  it('空振りを握り潰していない（`fillByPlaceholder(...).catch(() => {})` を書かない）', () => {
    // 握り潰すと、探し先が消えても緑のままになる。上の検査ごと無意味になる。
    const out: string[] = []
    for (const entry of readdirSync(E2E_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
      const src = readFileSync(join(E2E_DIR, entry.name), 'utf8')
      for (const m of src.matchAll(/fillByPlaceholder\([^\n]*\.catch\(\s*\(\s*\)\s*=>/g)) {
        out.push(`${entry.name}: ${m[0]}`)
      }
    }
    expect(out, 'fillByPlaceholder の失敗を握り潰している').toEqual([])
  })
})
