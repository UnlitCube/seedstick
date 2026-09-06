import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en, ja } from '@autoinstall/shared'

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

// ===========================================================================
// **`.e2e/*.mjs` が画面の文言を書き写していないか。**
//
// `full-run2.mjs` は `/起動メニューの残り容量: (\d+) bytes/` を探していて、
// 訳文が `t('runtime.grubFreeBytes')` を通るようになった瞬間に
// 「画面には出ているのにテストだけが落ちる」状態になった。
// 直したあとも `start-write.mjs` と `watch.mjs` は日本語を直書きしたままで、
// **CHANGELOG と HANDOFF だけが「ロケール非依存にした」と書いていた。**
//
// 前の巡は「ラベル用のリテラルと区別できず誤検出が 3〜7 件出るので入れない」と
// 判断していたが、それは**全部のリテラルを見ようとしたから**だった。
// **画面の文言が来る位置だけ**に絞ると、当時の 7 件を誤検出 0 で拾える。
//
// 見る位置（それ以外のリテラルは一切見ない）:
//   - `click(sel, 'テキスト')` / `centerOf(sel, 'テキスト')` の**第 2 引数**
//   - `fillByPlaceholder('…')` の**第 1 引数**（第 2 引数は打ち込む値なので対象外）
//   - `eval(...)` / `until(...)` の**第 1 引数**（ページ側で評価される式）
//   - **正規表現リテラル**（`/完了|失敗/` のように訳文を包み込む形）
//
// 見ない位置: `console.log()` / `check()` の第 1 引数 / `throw new Error()` /
// `until()` の第 3 引数（どれも画面と照合しないラベルなので書き写しではない）。
//
// **この番人が見張れないもの**（落とし穴 78。黙って広く見せない）:
//   - **英語の文言を直に書いた場合**は見つけられない（日本語かどうかで判定する）。
//     `d.click('main button', 'Start writing')` は素通りする
//   - `drive.mjs` は**対象外**。`d.t()` と言語判定そのものを実装している側で、
//     言語切り替えボタンのラベル（`English` / `日本語`。`App.tsx` が辞書を
//     通さずに出している）を直に持つしかない
//   - 「そのキーの訳文が本当にその画面に出るか」は見ない（GUI を起こすまで分からない）
// ===========================================================================

/**
 * 日本語（かな・カタカナ・漢字）を 1 文字でも含むか。
 * 範囲は Unicode プロパティで書く（落とし穴 44 と同じ理由。ソースを ASCII に保つ）。
 */
const HAS_JA = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

type Token = {
  kind: 'string' | 'template' | 'regex' | 'name' | 'punct'
  start: number
  value: string
}

/**
 * `.mjs` を粗く字句解析する。
 *
 * 完全な JS パーサではないが、必要なのは
 * 「リテラルの種類と位置」「括弧とカンマの入れ子」だけ。
 * コメントは読み飛ばすので、注意書きに書いた日本語は拾わない。
 */
function tokenize(src: string): Token[] {
  const out: Token[] = []
  const n = src.length
  let i = 0
  // 直前の意味のある文字。`/` が正規表現の始まりか除算かの判定に使う。
  let lastSig = ''
  while (i < n) {
    const c = src[i]!
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      continue
    }
    if (c === "'" || c === '"') {
      const start = i
      i += 1
      while (i < n && src[i] !== c) i += src[i] === '\\' ? 2 : 1
      i += 1
      out.push({ kind: 'string', start, value: src.slice(start + 1, i - 1) })
      lastSig = 'x'
      continue
    }
    if (c === '`') {
      const start = i
      i += 1
      let depth = 0
      while (i < n) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          depth += 1
          i += 2
          continue
        }
        if (depth > 0 && src[i] === '}') {
          depth -= 1
          i += 1
          continue
        }
        if (depth === 0 && src[i] === '`') break
        i += 1
      }
      i += 1
      out.push({ kind: 'template', start, value: src.slice(start + 1, i - 1) })
      lastSig = 'x'
      continue
    }
    if (c === '/') {
      // 直前が識別子・数値・閉じ括弧なら除算。それ以外なら正規表現。
      const isRegex = !/[A-Za-z0-9_$)\]]/.test(lastSig)
      if (isRegex) {
        const start = i
        i += 1
        let inClass = false
        let closed = false
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') {
            i += 2
            continue
          }
          if (src[i] === '[') inClass = true
          else if (src[i] === ']') inClass = false
          else if (src[i] === '/' && !inClass) {
            closed = true
            break
          }
          i += 1
        }
        if (closed) {
          i += 1
          while (i < n && /[gimsuyd]/.test(src[i]!)) i += 1
          out.push({ kind: 'regex', start, value: src.slice(start, i) })
          lastSig = 'x'
          continue
        }
        i = start + 1
        lastSig = '/'
        continue
      }
      i += 1
      lastSig = '/'
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i
      while (i < n && /[A-Za-z0-9_$]/.test(src[i]!)) i += 1
      out.push({ kind: 'name', start, value: src.slice(start, i) })
      lastSig = 'x'
      continue
    }
    if ('()[]{},'.includes(c)) {
      out.push({ kind: 'punct', start: i, value: c })
      lastSig = c
      i += 1
      continue
    }
    if (!/\s/.test(c)) lastSig = c
    i += 1
  }
  return out
}

type Literal = Token & { callee: string | null; arg: number }

/** 各リテラルが「どの呼び出しの第何引数か」を求める。 */
function literals(src: string): Literal[] {
  const toks = tokenize(src)
  const stack: { callee: string | null; arg: number; kind: string }[] = []
  const out: Literal[] = []
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!
    if (t.kind === 'punct') {
      if (t.value === '(') {
        const prev = toks[k - 1]
        stack.push({ callee: prev?.kind === 'name' ? prev.value : null, arg: 0, kind: '(' })
      } else if (t.value === '[' || t.value === '{') {
        // 配列・オブジェクトの中のカンマで引数番号が進まないように、枠を積む。
        stack.push({ callee: null, arg: 0, kind: t.value })
      } else if (t.value === ')' || t.value === ']' || t.value === '}') {
        stack.pop()
      } else if (t.value === ',') {
        const top = stack[stack.length - 1]
        if (top) top.arg += 1
      }
      continue
    }
    if (t.kind === 'name') continue
    const top = stack[stack.length - 1]
    const inCall = top?.kind === '('
    out.push({ ...t, callee: inCall ? top.callee : null, arg: inCall ? top.arg : -1 })
  }
  return out
}

/** 画面の文言が来る引数の番号（0 始まり）。ここ「だけ」を見る。 */
const SCREEN_TEXT_ARG: Record<string, number> = {
  click: 1,
  centerOf: 1,
  fillByPlaceholder: 0,
  eval: 0,
  until: 0,
}

/** 書き写しの位置かどうか（テストの中でも同じ判定を使う）。 */
function isCopiedScreenText(lit: Literal): boolean {
  if (!HAS_JA.test(lit.value)) return false
  if (lit.kind === 'regex') return true
  return lit.callee !== null && SCREEN_TEXT_ARG[lit.callee] === lit.arg
}

function e2eSources(skipDrive = true): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  for (const entry of readdirSync(E2E_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
    if (skipDrive && entry.name === 'drive.mjs') continue
    out.push({ file: entry.name, src: readFileSync(join(E2E_DIR, entry.name), 'utf8') })
  }
  return out
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length
}

/** 画面の文言を書き写している位置を挙げる。 */
function copiedScreenText(): string[] {
  const out: string[] = []
  for (const { file, src } of e2eSources()) {
    for (const lit of literals(src)) {
      if (!isCopiedScreenText(lit)) continue
      const why = lit.kind === 'regex' ? '正規表現に訳文' : `${lit.callee}() の第 ${lit.arg + 1} 引数`
      out.push(
        `${file}:${lineOf(src, lit.start)} [${why}] ${lit.value.replace(/\s+/g, ' ').slice(0, 60)}`,
      )
    }
  }
  return out
}

describe('.e2e/ が画面の文言を書き写していない', () => {
  it('走査が空振りしていない（ファイルもリテラルも読めている）', () => {
    // 走査パスやトークナイザが壊れると「0 件を検査して緑」になる。落とし穴 57。
    const sources = e2eSources()
    const names = sources.map((s) => s.file)
    expect(names).toContain('full-run.mjs')
    expect(names).toContain('full-run2.mjs')
    expect(names).toContain('start-write.mjs')
    expect(names).toContain('watch.mjs')
    expect(names, 'drive.mjs は対象外のはず').not.toContain('drive.mjs')

    const all = sources.flatMap((s) => literals(s.src))
    expect(all.length, 'リテラルを 1 つも読めていない').toBeGreaterThan(50)
    // 「見る位置」を実際に切り出せていること（3 種類それぞれ 1 つ以上）。
    expect(all.some((l) => l.callee === 'click' && l.arg === 1)).toBe(true)
    expect(all.some((l) => l.callee === 'fillByPlaceholder' && l.arg === 0)).toBe(true)
    expect(all.some((l) => l.kind === 'regex')).toBe(true)
  })

  it('見ない位置（ラベルや console.log）は誤検出しない', () => {
    // 誤検出を出す番人は、例外表で黙らせることになって最後には誰も読まなくなる。
    // 「拾ってはいけないもの」を実際の書き方で踏ませる。
    const sample = [
      "console.log('ネットワーク入力欄:', 1)",
      "check('固定 IP を入力できる', true, '詳細はこちら')",
      "await d.until('return true', 40000, 'ISO 認識')",
      "await d.click('nav button', d.t('step.iso'))",
      "await d.fillByPlaceholder(d.t('write.confirmWord'), '消去')",
      "if (!p) throw new Error('確認モーダルが押せません')",
      '// コメントの日本語（書き込みを開始）は拾わない',
      'const ratio = a / b / c',
    ].join('\n')
    expect(
      literals(sample).filter(isCopiedScreenText).map((l) => l.value),
      '書き写しでないものを拾っている',
    ).toEqual([])
  })

  it('見る位置（画面と照合する引数）は必ず拾う', () => {
    // 上の「誤検出しない」だけなら、何も拾わない番人でも緑になる。
    const sample = [
      "await d.click('nav button', '書き込み')",
      "await d.fillByPlaceholder('消去', '消去')",
      'await d.eval("return document.body.innerText.includes(\'書き込みを開始\')")',
      'const done = /完了|失敗/.test(t)',
    ].join('\n')
    expect(
      literals(sample).filter(isCopiedScreenText).length,
      '書き写しを取りこぼしている',
    ).toBe(4)
  })

  it('画面の文言を書き写している箇所が無い', () => {
    expect(
      copiedScreenText(),
      '.e2e/ が画面の文言を直接書いている（英語表示にすると静かに空振りする）。d.t(キー) で辞書から引くこと',
    ).toEqual([])
  })
})

// ===========================================================================
// **`.e2e/` が `d.t()` で引くキーは実在するか。**
//
// `drive.mjs` の `t()` は辞書に無いキーで例外を投げるが、
// **GUI を起こすまで分からない**（`.e2e` は CI に載らない）。
// キー名の打ち間違いは、ここで落とすのが一番安い。
// ja だけでなく **en にも**在ることを見る（en が欠けると英語表示でだけ落ちる）。
//
// **キーを変数に入れて `d.t(k)` で回すと、この番人は見られない。**
// `.e2e` 側はキーを `d.t('…')` の形で書くこと（`watch.mjs` にその注意を書いた）。
// ===========================================================================

/**
 * `.e2e/*.mjs` が `d.t('…')` で引いているキー。
 *
 * 正規表現ではなく上の字句解析を使う。**コメントに書いた `d.t('…')` の説明を
 * 拾ってしまい、実在しないキーとして落ちた**（実際にここで踏んだ）。
 */
function requestedKeys(): { file: string; key: string }[] {
  const out: { file: string; key: string }[] = []
  for (const { file, src } of e2eSources()) {
    for (const lit of literals(src)) {
      if (lit.kind === 'string' && lit.callee === 't' && lit.arg === 0) out.push({ file, key: lit.value })
    }
  }
  return out
}

describe('.e2e/ が d.t() で引くキーは ja / en の両方に実在する', () => {
  it('走査対象が空でない（10 個以上のキーを読めている）', () => {
    const keys = requestedKeys()
    expect(keys.length, '.e2e/ の d.t() を 1 件も読めていない').toBeGreaterThanOrEqual(10)
    // 1 ファイルだけ読めていて緑、を防ぐ。
    expect(new Set(keys.map((k) => k.file)).size, '1 ファイルしか読めていない').toBeGreaterThan(1)
    expect(keys.map((k) => k.file)).toContain('watch.mjs')
  })

  it('引いているキーがすべて辞書にある', () => {
    const jaDict = ja as Record<string, string>
    const enDict = en as Record<string, string>
    const missing = requestedKeys()
      .filter(({ key }) => typeof jaDict[key] !== 'string' || typeof enDict[key] !== 'string')
      .map(({ file, key }) => `${file}: ${key}`)
    expect(
      missing,
      '.e2e/ が辞書に無いキーを引いている（実行すると d.t() が例外を投げる）',
    ).toEqual([])
  })
})

// ===========================================================================
// **`drive.mjs` の `openDisclosure` が頼っている目印が、実物とずれていないか。**
//
// `components/disclosure-e2e-marker.test.tsx` は同じ手順を **TypeScript で
// 書き写している**だけなので、`drive.mjs` を壊してもあちらは緑のままになる
// （あちらが固定しているのは `<Disclosure>` 側の契約）。
// ここでは**両方のソースをテキストとして読み**、目印の名前が一致することを見る。
// これで少なくとも「片方だけ改名した」は落ちる。
//
// **見張れないもの**: 手順そのもの（閉じているものだけ押す・開けなかったら例外）は
// 見ない。`drive.mjs` は CDP を握っていて、ここからは実行できない。
// ===========================================================================

describe('drive.mjs の折りたたみの目印は実物と一致する', () => {
  const driveSrc = readFileSync(join(E2E_DIR, 'drive.mjs'), 'utf8')
  const uiSrc = readFileSync(join(RENDERER_DIR, 'components/ui.tsx'), 'utf8')

  it('走査対象を読めている', () => {
    expect(driveSrc).toContain('openDisclosure')
    expect(uiSrc).toContain('export function Disclosure')
  })

  it('属性名 data-disclosure が両側にある', () => {
    expect(uiSrc, '<Disclosure> が目印を出していない').toContain('data-disclosure=""')
    expect(driveSrc, 'drive.mjs が目印で探していない').toContain('[data-disclosure]')
  })

  it('開閉の判定に使う aria-expanded が両側にある', () => {
    expect(uiSrc, '<Disclosure> が aria-expanded を出していない').toContain('aria-expanded={open}')
    expect(driveSrc, 'drive.mjs が aria-expanded を見ていない').toContain('aria-expanded')
  })
})
