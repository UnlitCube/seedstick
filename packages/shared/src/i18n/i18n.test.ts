import { describe, expect, it } from 'vitest'
import * as shared from '../index.js'
import {
  createTranslator,
  en,
  formatLocalized,
  interpolate,
  ja,
  localized,
  LOCALES,
  placeholdersOf,
  resolveLocale,
  type MsgKey,
} from './index.js'

describe('i18n', () => {
  it('ja と en のキーが完全に一致する', () => {
    // 型でも保証しているが、実行時にも確認しておく（satisfies を外した事故を検出する）
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort())
  })

  it('空の訳文が無い', () => {
    for (const locale of LOCALES) {
      const dict = locale === 'ja' ? ja : en
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim().length, `${locale}.${k} が空`).toBeGreaterThan(0)
      }
    }
  })

  it('英語の辞書に日本語が混入していない', () => {
    // 製品名など意図的な例外は無い想定
    for (const [k, v] of Object.entries(en)) {
      expect(/[ぁ-んァ-ヶ一-龠]/.test(v), `en.${k} に日本語が残っている: ${v}`).toBe(false)
    }
  })

  it('英語の辞書に全角の約物が混入していない', () => {
    // かな・漢字を英訳しても、括弧と句読点だけ全角のまま残る取りこぼしが起きる。
    // 上の検査は「ぁ-ん」等しか見ないので素通りする。
    // U+3000-303F: 、。「」〜 など / U+FF00-FFEF: （）！？： と半角カナ。
    // ソースを ASCII に保つため \u エスケープで書く（落とし穴 44）。
    const FULLWIDTH = /[\u3000-\u303F\uFF00-\uFFEF]/
    for (const [k, v] of Object.entries(en)) {
      const hit = v.match(FULLWIDTH)
      expect(
        hit,
        `en.${k} に全角の約物が残っている: ${JSON.stringify(hit?.[0])} in ${v}`,
      ).toBeNull()
    }
  })

  it('翻訳関数がロケールごとに正しい文字列を返す', () => {
    expect(createTranslator('ja')('common.next')).toBe('次へ')
    expect(createTranslator('en')('common.next')).toBe('Next')
  })

  it('未知のキーはキー名を返す（画面が空白にならない）', () => {
    expect(createTranslator('ja')('nope.not.a.key' as MsgKey)).toBe('nope.not.a.key')
  })

  it('OS ロケールから言語を決める', () => {
    expect(resolveLocale('ja-JP')).toBe('ja')
    expect(resolveLocale('ja')).toBe('ja')
    expect(resolveLocale('en-US')).toBe('en')
    expect(resolveLocale(undefined)).toBe('en')
    expect(resolveLocale('de-DE')).toBe('en')
  })

  it('危険な操作の文言に警告が含まれている', () => {
    // 誤操作でディスクを消す事故を防ぐため、確認文には必ず「消去」「erased」が入る
    expect(ja['write.confirmBody']).toMatch(/消去/)
    expect(en['write.confirmBody']).toMatch(/erased/i)
    expect(ja['storage.warning']).toMatch(/消去/)
  })
})

describe('差し込み', () => {
  it('{name} を値で置き換える', () => {
    expect(interpolate('{size} 以上必要です', { size: '3.2 GB' })).toBe('3.2 GB 以上必要です')
    expect(interpolate('{a} と {b}', { a: 1, b: 2 })).toBe('1 と 2')
  })

  it('同じ名前が複数あってもすべて置き換える', () => {
    expect(interpolate('{n} 台中 {n} 台', { n: 3 })).toBe('3 台中 3 台')
  })

  it('値を渡し忘れたらプレースホルダを残す（空文字に落とすと気づけない）', () => {
    expect(interpolate('{size} 以上必要です', {})).toBe('{size} 以上必要です')
    expect(interpolate('{size} 以上必要です')).toBe('{size} 以上必要です')
  })

  it('値の中の {other} を再帰的に展開しない', () => {
    // 展開すると、利用者が入力したホスト名に {password} と書くだけで
    // 別の差し込み値を引き出せる。1 回だけ置き換える。
    expect(interpolate('{a}', { a: '{b}', b: 'secret' })).toBe('{b}')
  })

  it('プレースホルダを含むキーは ja と en で名前の集合が一致する', () => {
    for (const key of Object.keys(ja) as MsgKey[]) {
      expect(placeholdersOf(en[key]), `${key} の差し込み名が ja と en で違う`).toEqual(
        placeholdersOf(ja[key]),
      )
    }
  })

  it('翻訳関数が差し込みを行う', () => {
    const t = createTranslator('ja')
    expect(t('common.next')).toBe('次へ')
  })
})

describe('LocalizedText', () => {
  it('formatLocalized が差し込みを行う', () => {
    const text = localized('write.tooSmallBody', { size: '8.0 GB', required: '16.0 GB' })
    expect(formatLocalized('ja', text)).toBe('このデバイスは 8.0 GB ですが、16.0 GB 以上が必要です。')
    expect(formatLocalized('en', text)).toBe(
      'This device holds 8.0 GB, but 16.0 GB or more is required.',
    )
  })

  it('formatLocalized は params 無しでも訳せる', () => {
    expect(formatLocalized('ja', localized('common.next'))).toBe('次へ')
    expect(formatLocalized('en', localized('common.next'))).toBe('Next')
  })

  it('params を渡さないときは params キーを生やさない', () => {
    // `{key, params: undefined}` は JSON 往復で `{key}` になり、
    // 送った側と受け取った側で toEqual が食い違う。
    const text = localized('common.next')
    expect(Object.keys(text)).toEqual(['key'])
    expect('params' in text).toBe(false)
    expect(JSON.stringify(text)).toBe('{"key":"common.next"}')
  })

  it('JSON を往復しても同じものになる（IPC と NDJSON を通るため）', () => {
    for (const text of [
      localized('common.next'),
      localized('device.blockedTooSmall', { min: '4.0 GB' }),
      localized('write.errorWorkerExited', { code: 1 }),
      localized('layout.diskTooSmall', {
        isoSize: '3.3 GB',
        cidataSize: '64 MB',
        required: '3.4 GB',
        deviceSize: '2.0 GB',
      }),
    ]) {
      const roundTripped = JSON.parse(JSON.stringify(text))
      expect(roundTripped).toEqual(text)
      // 往復後も同じ文字列に訳せること（数値が文字列になっても訳文は変わらない）
      expect(formatLocalized('ja', roundTripped)).toBe(formatLocalized('ja', text))
      expect(formatLocalized('en', roundTripped)).toBe(formatLocalized('en', text))
    }
  })

  it('LocalizedText は関数・Symbol・undefined を持たない', () => {
    const text = localized('write.payloadMissing', { files: '/tmp/a.tar.gz' })
    const seen: unknown[] = []
    JSON.stringify(text, (_k, v) => {
      seen.push(v)
      return v
    })
    for (const v of seen) {
      expect(typeof v === 'function' || typeof v === 'symbol' || v === undefined).toBe(false)
    }
  })
})

describe('入れ子の差し込み', () => {
  it('値の LocalizedText をその言語で訳して差し込む', () => {
    // 外側（どのデバイスか）と内側（なぜか）は別々の場所で作られる。
    // 内側まで訳せないと、英語の画面に日本語が出るか、理由が消える。
    const text = localized('device.rejectedNotWritable', {
      path: '\\.\PhysicalDrive1',
      reason: localized('device.blockedSystemDisk'),
    })
    expect(formatLocalized('ja', text)).toContain(ja['device.blockedSystemDisk'])
    expect(formatLocalized('en', text)).toContain(en['device.blockedSystemDisk'])
    // 混ざらないこと（英語の文に日本語が残らない）
    expect(/[ぁ-んァ-ヶ一-龠]/.test(formatLocalized('en', text))).toBe(false)
  })

  it('入れ子の中の差し込みも効く', () => {
    const inner = localized('device.blockedTooSmall', { min: '4 GB' })
    const out = formatLocalized('en', localized('device.rejectedNotWritable', { path: 'p', reason: inner }))
    expect(out).toContain('4 GB')
    expect(out).not.toContain('{min}')
  })

  it('locale を渡さない interpolate は入れ子を訳さず、プレースホルダを残す', () => {
    // ここで日本語の既定に落とすと、英語の画面に日本語が出たうえで
    // 「正常に見える」。訳せないことが見えるほうがよい。
    const out = interpolate('{a}', { a: localized('common.next') })
    expect(out).toBe('{a}')
  })

  it('深すぎる入れ子は展開を打ち切る（JSON から任意の深さが届く）', () => {
    let text = localized('common.next')
    for (let i = 0; i < 12; i++) text = localized('device.rejectedNotWritable', { path: 'p', reason: text })
    // 例外を投げず、スタックも溢れない
    const out = formatLocalized('ja', text)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('{reason}')
  })

  it('壊れた入れ子（key が無い / null / 配列）でも落ちない', () => {
    // **壊れた `params` は「プレースホルダを持つ実在のキー」で試す。**
    // 辞書に無いキーを使うと訳文がキー名そのもの（プレースホルダ 0 個）になり、
    // 置換のコールバックが一度も呼ばれないので、**何を渡しても緑になる**。
    // 実際にそう書いていて、`params: null` の TypeError を見逃していた。
    const broken = [
      {},
      null,
      [],
      { key: 42 },
      { key: 'device.blockedTooSmall', params: null },
      { key: 'device.blockedTooSmall', params: [] },
      { key: 'device.blockedTooSmall', params: { min: null } },
    ]
    for (const b of broken) {
      const out = formatLocalized('ja', {
        key: 'device.rejectedNotWritable',
        params: { path: 'p', reason: b as never },
      })
      expect(typeof out, JSON.stringify(b)).toBe('string')
      expect(out.length, JSON.stringify(b)).toBeGreaterThan(0)
    }
  })

  it('params そのものが null / 配列でも落ちない', () => {
    // トップレベルも同じ（`interpolate` は IPC から来た値を直接受ける）。
    expect(interpolate('{min} 以上', null as never)).toBe('{min} 以上')
    expect(interpolate('{min} 以上', [] as never)).toBe('{min} 以上')
    expect(formatLocalized('ja', { key: 'device.blockedTooSmall', params: null as never })).toContain(
      '{min}',
    )
  })

  it('入れ子は JSON を往復しても同じものになる', () => {
    const text = localized('device.rejectedNotWritable', {
      path: 'p',
      reason: localized('device.blockedSystemDisk'),
    })
    expect(JSON.parse(JSON.stringify(text))).toEqual(text)
    expect(formatLocalized('en', JSON.parse(JSON.stringify(text)))).toBe(formatLocalized('en', text))
  })
})

// ---------------------------------------------------------------------------
// 想定外の文字体系（ハングル・キリル・タイ文字…）の混入
// ---------------------------------------------------------------------------
//
// 実際に `KEYBOARDS` の日本語ラベルが「韓国語 (104키)」になっていた。
// `키` は韓国語の「キー」で、日本語のラベルとしては誤り（正しくは `104キー`）。
// 上の 2 つの検査はどちらもこれを見ない:
//   - 「英語の辞書に日本語が混入していない」は en しか見ないし、かな・漢字しか見ない。
//   - 「全角の約物」も en しか見ないし、U+3000-303F / U+FF00-FFEF しか見ない。
// 目で読むまで気づけなかったので、機械に見させる。
//
// **ja に英字が混ざるのは正常**（製品名・コマンド・パッケージ名・`C.UTF-8`）なので、
// 英字は禁止しない。許すのは「その言語の文に自然に出る文字体系」だけにして、
// それ以外の体系は 1 文字でも落とす。ソースを ASCII に保つため、範囲は
// コードポイントではなく Unicode プロパティで書く（落とし穴 44）。
//
// 判定用の正規表現に `/g` は付けない（`lastIndex` が進んで純関数でなくなる。落とし穴 63）。

/** 日本語の文に出てよい文字体系。Common / Inherited は約物・記号・数字。 */
const UNEXPECTED_IN_JA =
  /[^\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u
/** 英語の文に出てよい文字体系。 */
const UNEXPECTED_IN_EN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

/** 見つかった 1 文字を「文字 (U+XXXX)」の形で返す。無ければ null。 */
function unexpectedChar(text: string, unexpected: RegExp): string | null {
  const hit = unexpected.exec(text)
  if (hit === null) return null
  const cp = hit[0].codePointAt(0) ?? 0
  return `${hit[0]} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`
}

interface LabelPair {
  /** どこにあったか（`KEYBOARDS[7].labelJa` の形）。 */
  readonly where: string
  readonly ja: string
  /** 相方。文字列でなければ `undefined`（対になっていない）。 */
  readonly en: string | undefined
}

/**
 * `@autoinstall/shared` が公開する値を歩いて、`*Ja` / `*En` の対を全部集める。
 *
 * ファイル名を並べないのは、**新しく足した対を検査から漏らさない**ため。
 * `presets.ts` だけを見る検査にすると、`provisioning.ts` / `advanced.ts` に
 * 同じ形が増えたときに黙って素通りする（落とし穴 73）。
 *
 * ここで拾えないのは「実行時に組み立てる」もの
 * （`validate.ts` の `messageJa` / `ipc.ts` の `messageJa`）。それらは
 * 静的な値として存在しないので、この検査の範囲外。
 */
function collectLabelPairs(): LabelPair[] {
  const found: LabelPair[] = []
  const seen = new WeakSet<object>()
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 8 || typeof value !== 'object' || value === null) return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`, depth + 1))
      return
    }
    const record = value as Record<string, unknown>
    for (const [key, v] of Object.entries(record)) {
      const base = /^(.+)Ja$/.exec(key)?.[1]
      if (base !== undefined && typeof v === 'string') {
        const counterpart = record[`${base}En`]
        found.push({
          where: `${path}.${key}`,
          ja: v,
          en: typeof counterpart === 'string' ? counterpart : undefined,
        })
      }
      visit(v, `${path}.${key}`, depth + 1)
    }
  }
  for (const [name, value] of Object.entries(shared)) visit(value, name, 0)
  return found
}

describe('想定外の文字体系', () => {
  const pairs = collectLabelPairs()

  it('*Ja / *En の対を実際に集められている（0 件だと何も検証しないので確認する）', () => {
    // 走査が空振りしたまま緑になるのを防ぐ。件数は presets(63) + provisioning(12) +
    // advanced(7) の実測。増える分には構わないので下限だけを見る。
    expect(pairs.length).toBeGreaterThan(60)
    const where = pairs.map((p) => p.where)
    expect(where).toContain('KEYBOARDS[7].labelJa')
    expect(where).toContain('POST_INSTALL_PRESETS[0].titleJa')
    expect(where).toContain('POST_INSTALL_PRESETS[0].descriptionJa')
    expect(where).toContain('SHELL_CHOICES[0].labelJa')
    expect(where).toContain('KERNEL_FLAVORS[0].labelJa')
  })

  it('*Ja には必ず文字列の *En が対になっている', () => {
    expect(pairs.filter((p) => p.en === undefined).map((p) => p.where)).toEqual([])
  })

  it('日本語のラベルに想定外の文字体系が混ざっていない', () => {
    const bad = pairs
      .map((p) => ({ where: p.where, text: p.ja, hit: unexpectedChar(p.ja, UNEXPECTED_IN_JA) }))
      .filter((b) => b.hit !== null)
      .map((b) => `${b.where}: ${b.hit} in ${b.text}`)
    expect(bad, 'ハングル・キリル・タイ文字などが日本語のラベルに混ざっています').toEqual([])
  })

  it('英語のラベルに想定外の文字体系が混ざっていない', () => {
    const bad = pairs
      .filter((p) => p.en !== undefined)
      .map((p) => ({ where: p.where, text: p.en!, hit: unexpectedChar(p.en!, UNEXPECTED_IN_EN) }))
      .filter((b) => b.hit !== null)
      .map((b) => `${b.where.replace(/Ja$/, 'En')}: ${b.hit} in ${b.text}`)
    expect(bad).toEqual([])
  })

  it('ja の辞書に想定外の文字体系が混ざっていない', () => {
    const bad = Object.entries(ja)
      .map(([k, v]) => ({ k, v, hit: unexpectedChar(v, UNEXPECTED_IN_JA) }))
      .filter((b) => b.hit !== null)
      .map((b) => `ja.${b.k}: ${b.hit} in ${b.v}`)
    expect(bad).toEqual([])
  })

  it('en の辞書に想定外の文字体系が混ざっていない', () => {
    // かな・漢字は上の検査でも落ちるが、こちらはハングルやキリルも落とす。
    const bad = Object.entries(en)
      .map(([k, v]) => ({ k, v, hit: unexpectedChar(v, UNEXPECTED_IN_EN) }))
      .filter((b) => b.hit !== null)
      .map((b) => `en.${b.k}: ${b.hit} in ${b.v}`)
    expect(bad).toEqual([])
  })

  it('検査そのものが効く（混ぜたら落ちることを確かめる）', () => {
    // この it が無いと、正規表現を書き間違えて「何も検出しない検査」になっても
    // 全部緑のままになる（落とし穴 57）。
    expect(unexpectedChar('\u97D3\u56FD\u8A9E (104\uD0A4)', UNEXPECTED_IN_JA)).toBe('\uD0A4 (U+D0A4)')
    expect(unexpectedChar('\u30ED\u30B7\u30A2\u8A9E (\u0420\u0443\u0441)', UNEXPECTED_IN_JA)).toBe('\u0420 (U+0420)')
    expect(unexpectedChar('\u30BF\u30A4\u8A9E (\u0E44\u0E17\u0E22)', UNEXPECTED_IN_JA)).toBe('\u0E44 (U+0E44)')
    // 日本語として正しいものは落とさない（英字・数字・約物・長音記号）
    expect(unexpectedChar('\u97D3\u56FD\u8A9E (104\u30AD\u30FC)', UNEXPECTED_IN_JA)).toBeNull()
    expect(unexpectedChar('\u30ED\u30B1\u30FC\u30EB\u306A\u3057 (C.UTF-8)', UNEXPECTED_IN_JA)).toBeNull()
    // en 側はかなも漢字も落とす
    expect(unexpectedChar('Korean (104\u30AD\u30FC)', UNEXPECTED_IN_EN)).toBe('\u30AD (U+30AD)')
    expect(unexpectedChar('Korean (104-key)', UNEXPECTED_IN_EN)).toBeNull()
  })
})
