import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as shared from '../index.js'
import {
  createTranslator,
  DICTIONARIES,
  en,
  formatLocalized,
  interpolate,
  isLocale,
  ja,
  localized,
  LOCALE_META,
  LOCALES,
  negotiateLocale,
  placeholdersOf,
  resolvePlurals,
  type Locale,
  type MsgKey,
} from './index.js'

/**
 * 危険な操作の確認文に、その言語で「消える」を表す語が入っていること。
 * **言語を足すと型エラーになる**ので、記入を忘れられない。
 */
const SAFETY_TERMS = {
  ja: /消去/,
  en: /erase/i,
} satisfies Record<Locale, RegExp>

/** その言語の訳文に出てよい文字体系の外にある 1 文字を探す正規表現（表から作る）。 */
function unexpectedScriptPattern(locale: Locale): RegExp {
  const allowed = [...LOCALE_META[locale].scripts, 'Common', 'Inherited']
  return new RegExp(`[^${allowed.map((sc) => `\\p{Script=${sc}}`).join('')}]`, 'u')
}

/** U+3000-303F: 、。「」〜 など / U+FF00-FFEF: （）！？： と半角カナ。ソースは ASCII で（落とし穴 44）。 */
const FULLWIDTH = /[\u3000-\u303F\uFF00-\uFFEF]/

describe('i18n', () => {
  it('どの言語の辞書も ja とキーが完全に一致する', () => {
    // 型でも保証しているが、実行時にも確認しておく（satisfies を外した事故を検出する）
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort(), locale).toEqual(Object.keys(ja).sort())
    }
  })

  it('表の言語と辞書の言語が一致する', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...LOCALES].sort())
    expect(LOCALES).toContain('ja')
    expect(LOCALES).toContain('en')
  })

  it('空の訳文が無い', () => {
    for (const locale of LOCALES) {
      for (const [k, v] of Object.entries(DICTIONARIES[locale])) {
        expect(v.trim().length, `${locale}.${k} が空`).toBeGreaterThan(0)
      }
    }
  })

  it('ja 以外の辞書に日本語（かな）が残っていない', () => {
    // 訳し残しの典型。中国語は漢字を使うので、かなで見る。
    for (const locale of LOCALES.filter((l) => l !== 'ja')) {
      for (const [k, v] of Object.entries(DICTIONARIES[locale])) {
        expect(/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(v), `${locale}.${k} に日本語が残っている: ${v}`).toBe(
          false,
        )
      }
    }
  })

  it('全角の約物を使わない言語に、全角の約物が混入していない', () => {
    // かな・漢字を訳しても、括弧と句読点だけ全角のまま残る取りこぼしが起きる。
    for (const locale of LOCALES.filter((l) => !LOCALE_META[l].fullwidthPunctuation)) {
      for (const [k, v] of Object.entries(DICTIONARIES[locale])) {
        const hit = v.match(FULLWIDTH)
        expect(hit, `${locale}.${k} に全角の約物が残っている: ${JSON.stringify(hit?.[0])} in ${v}`).toBeNull()
      }
    }
  })

  it('翻訳関数がロケールごとに正しい文字列を返す', () => {
    expect(createTranslator('ja')('common.next')).toBe('次へ')
    expect(createTranslator('en')('common.next')).toBe('Next')
  })

  it('未知のキーはキー名を返す（画面が空白にならない）', () => {
    expect(createTranslator('ja')('nope.not.a.key' as MsgKey)).toBe('nope.not.a.key')
  })

  it('OS の言語の並びから言語を決める', () => {
    expect(negotiateLocale(['ja-JP'])).toBe('ja')
    expect(negotiateLocale(['ja'])).toBe('ja')
    expect(negotiateLocale(['en-US'])).toBe('en')
    expect(negotiateLocale(['en-GB'])).toBe('en')
    expect(negotiateLocale([])).toBe('en')
    expect(negotiateLocale([undefined, null, ''])).toBe('en')
    // 対応していない言語は飛ばして、次に好まれている言語を見る
    expect(negotiateLocale(['it-IT', 'ja-JP'])).toBe('ja')
    expect(negotiateLocale(['it-IT'])).toBe('en')
    // 区切りが _ の形（POSIX のロケール）も読める
    expect(negotiateLocale(['ja_JP.UTF-8'.split('.')[0]!])).toBe('ja')
    for (const l of LOCALES) expect(negotiateLocale([l]), l).toBe(l)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('xx')).toBe(false)
    expect(isLocale('__proto__')).toBe(false)
  })

  it('危険な操作の文言に、その言語の「消える」が含まれている', () => {
    // 誤操作でディスクを消す事故を防ぐため、確認文には必ず消去を表す語が入る。
    // 訳で弱めると（「上書きされます」など）、ここで落ちる。
    for (const locale of LOCALES) {
      const term = SAFETY_TERMS[locale]
      const d = DICTIONARIES[locale]
      expect(d['write.confirmBody'], `${locale} write.confirmBody`).toMatch(term)
      expect(d['storage.warning'], `${locale} storage.warning`).toMatch(term)
    }
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

  it('プレースホルダを含むキーは、どの言語でも ja と名前の集合が一致する', () => {
    for (const locale of LOCALES) {
      const d = DICTIONARIES[locale]
      for (const key of Object.keys(ja) as MsgKey[]) {
        expect(placeholdersOf(d[key]), `${key} の差し込み名が ja と ${locale} で違う`).toEqual(
          placeholdersOf(ja[key]),
        )
      }
    }
  })

  it('翻訳関数が差し込みを行う', () => {
    const t = createTranslator('ja')
    expect(t('common.next')).toBe('次へ')
  })
})

describe('複数形', () => {
  const EN = '{n, plural, one {# item} other {# items}}'

  it('数に合う形を選ぶ（en: 1 は one、それ以外は other）', () => {
    expect(interpolate(EN, { n: 1 }, 'en')).toBe('1 item')
    expect(interpolate(EN, { n: 2 }, 'en')).toBe('2 items')
    expect(interpolate(EN, { n: 0 }, 'en')).toBe('0 items')
    // IPC から文字列で来ても数として読む
    expect(interpolate(EN, { n: '1' }, 'en')).toBe('1 item')
  })

  it('その言語に無い形は other を使う（ja は other だけ）', () => {
    expect(interpolate('{n, plural, other {# 件}}', { n: 1 }, 'ja')).toBe('1 件')
    // en で one を書き忘れても other で出る（落ちない）
    expect(interpolate('{n, plural, other {# items}}', { n: 1 }, 'en')).toBe('1 items')
  })

  it('中の通常の差し込みも置き換える', () => {
    expect(interpolate('{n, plural, one {# item ({size})} other {# items ({size})}}', { n: 3, size: '2 MB' }, 'en')).toBe(
      '3 items (2 MB)',
    )
  })

  it('値が無い・数でないときはブロックを残す（渡し忘れに気づける）', () => {
    expect(interpolate(EN, {}, 'en')).toBe(EN)
    expect(interpolate(EN, { n: 'abc' }, 'en')).toBe(EN)
  })

  it('壊れた書式でも例外を投げない', () => {
    for (const broken of ['{n, plural, one {x', '{n, plural, one x}', '{n, plural, }', '{n, plural,']) {
      expect(() => resolvePlurals(broken, { n: 1 }, 'en'), broken).not.toThrow()
    }
  })

  it('差し込み名の集合に、複数形の変数と中の差し込みを数える', () => {
    expect(placeholdersOf('{n, plural, one {# item ({size})} other {# items ({size})}}')).toEqual(['n', 'size'])
  })

  it('辞書の複数形は、どの言語でも other を持つ', () => {
    // other が無いと、CLDR がその言語で返す形によっては何も出ない。
    const bad: string[] = []
    for (const locale of LOCALES) {
      for (const [k, v] of Object.entries(DICTIONARIES[locale])) {
        if (!/,\s*plural\s*,/.test(v)) continue
        if (!/\bother\s*\{/.test(v)) bad.push(`${locale}.${k}`)
        // 実際に 1 と 2 で展開できること（壊れていればブロックが残る）
        for (const n of [1, 2]) {
          const out = resolvePlurals(v, { n, count: n }, locale)
          if (/,\s*plural\s*,/.test(out)) bad.push(`${locale}.${k} (n=${n}): ${out}`)
        }
      }
    }
    expect(bad).toEqual([])
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
// 選択肢のラベルと、想定外の文字体系（ハングル・キリル・タイ文字…）の混入
// ---------------------------------------------------------------------------
//
// 選択肢（`presets.ts` / `provisioning.ts` / `advanced.ts` の配列）は以前
// `labelJa` / `labelEn` を直接持っていた。表示は両言語とも正しかったが、
// **i18n の機構が 2 つある**ので、辞書だけを直しても選択肢は古いまま残る。
// いまは辞書のキー（`MsgKey`）を持ち、renderer が `t(c.label)` で引く。
// この節はその契約を機械に見張らせる（キーが実在すること・訳文が正しい文字体系であること）。
// 「ソースに `*Ja` / `*En` の対が残っていないこと」は最後の節が別に見ている。
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

interface LabelRef {
  /** どこにあったか（`KEYBOARDS[7].label` の形）。 */
  readonly where: string
  /** そこに書かれていた辞書のキー。 */
  readonly key: string
}

/** 選択肢の表示名を運ぶプロパティ名。ここに足すと検査対象が広がる。 */
const LABEL_PROPS = ['label', 'title', 'description'] as const

/**
 * `@autoinstall/shared` が公開する値を歩いて、選択肢の表示名（辞書のキー）を全部集める。
 *
 * ファイル名も配列名も並べないのは、**新しく足した選択肢を検査から漏らさない**ため。
 * `presets.ts` だけを見る検査にすると、`provisioning.ts` / `advanced.ts` に
 * 選択肢が増えたときに黙って素通りする（落とし穴 73）。
 * 選択肢を 1 つ足せば、その `label` は自動的にここへ入る。
 *
 * ここで拾えないのは「実行時に組み立てる」もの
 * （`validate.ts` と `ipc.ts` が積む `ValidationIssue.text`）。それらは
 * 静的な値として存在しないので、この検査の範囲外。
 * 見ているのは `packages/shared/src/autoinstall/validate-i18n.test.ts`
 * （実際に `validateProfile` を呼んで指摘を集め、キーの実在と差し込みを見る）。
 */
function collectChoiceLabels(): LabelRef[] {
  const found: LabelRef[] = []
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
      if ((LABEL_PROPS as readonly string[]).includes(key) && typeof v === 'string') {
        found.push({ where: `${path}.${key}`, key: v })
      }
      visit(v, `${path}.${key}`, depth + 1)
    }
  }
  for (const [name, value] of Object.entries(shared)) visit(value, name, 0)
  return found
}

describe('選択肢のラベル', () => {
  const labels = collectChoiceLabels()

  it('ラベルを実際に集められている（0 件だと何も検証しないので確認する）', () => {
    // 走査が空振りしたまま緑になるのを防ぐ。件数は presets(9+9+10+6+10+18) +
    // provisioning(3+9) + advanced(4+3) の実測。増える分には構わないので下限だけを見る。
    expect(labels.length).toBeGreaterThan(60)
    const where = labels.map((p) => p.where)
    expect(where).toContain('KEYBOARDS[7].label')
    expect(where).toContain('POST_INSTALL_PRESETS[0].title')
    expect(where).toContain('POST_INSTALL_PRESETS[0].description')
    expect(where).toContain('SHELL_CHOICES[0].label')
    expect(where).toContain('KERNEL_FLAVORS[0].label')
    expect(where).toContain('CUDA_TOOLKIT_CHOICES[0].label')
    expect(where).toContain('APT_FALLBACK_CHOICES[0].label')
    expect(where).toContain('LOCALE_CHOICES[0].label')
    expect(where).toContain('TIMEZONES[0].label')
    expect(where).toContain('APT_MIRROR_PRESETS[0].label')
    expect(where).toContain('COMMON_PACKAGES[0].label')
  })

  it('すべてのラベルがすべての辞書に実在する（実在しないと画面にキー名が出る）', () => {
    // `createTranslator` は未知のキーをそのまま返すので、綴りを間違えた選択肢は
    // 画面に `basics.keyboardKr140` のような英数字を出す。型（MsgKey）でも
    // 弾けるが、`as MsgKey` で抜けられるし、辞書からキーを消した側は気づけない。
    const missing = labels
      .filter((l) => LOCALES.some((locale) => DICTIONARIES[locale][l.key as MsgKey] === undefined))
      .map((l) => `${l.where}: "${l.key}"`)
    expect(missing, 'ja.ts / en.ts に無いキーを選択肢が指しています').toEqual([])
  })

  it('ラベルを英語に訳すと日本語が残らない', () => {
    const bad = labels
      .map((l) => ({ where: l.where, text: formatLocalized('en', localized(l.key as MsgKey)) }))
      .filter((b) => /[ぁ-んァ-ヶ一-龠]/.test(b.text) || b.text === '')
      .map((b) => `${b.where}: ${b.text}`)
    expect(bad).toEqual([])
  })

  it('ラベルに想定外の文字体系が混ざっていない', () => {
    // 訳文そのものの検査は下の「ja / en の辞書」が全キーに対して行うが、
    // 選択肢のラベルは製品名・規格名（`104キー` / `C.UTF-8`）を含むので、
    // ここでも実際に引いた文字列で確かめる。
    const bad: string[] = []
    for (const l of labels) {
      for (const locale of LOCALES) {
        const text = DICTIONARIES[locale][l.key as MsgKey]
        if (text === undefined) continue
        const hit = unexpectedChar(text, unexpectedScriptPattern(locale))
        if (hit !== null) bad.push(`${l.where} (${locale}): ${hit} in ${text}`)
      }
    }
    expect(bad, 'ハングル・キリル・タイ文字などがラベルに混ざっています').toEqual([])
  })
})

describe('想定外の文字体系', () => {
  it('どの言語の辞書にも、その言語の外の文字体系が混ざっていない', () => {
    // 表（LOCALE_META.scripts）から作るので、言語を足せば自動で検査が増える。
    const bad: string[] = []
    for (const locale of LOCALES) {
      const pattern = unexpectedScriptPattern(locale)
      for (const [k, v] of Object.entries(DICTIONARIES[locale])) {
        const hit = unexpectedChar(v, pattern)
        if (hit !== null) bad.push(`${locale}.${k}: ${hit} in ${v}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('表から作った検査が、手で書いた検査と同じに働く', () => {
    expect(unexpectedScriptPattern('ja').source).toContain('Hiragana')
    expect(unexpectedChar('Korean (104\u30AD\u30FC)', unexpectedScriptPattern('en'))).toBe('\u30AD (U+30AD)')
    expect(unexpectedChar('\u97D3\u56FD\u8A9E (104\uD0A4)', unexpectedScriptPattern('ja'))).toBe('\uD0A4 (U+D0A4)')
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

// ---------------------------------------------------------------------------
// ソースに `*Ja` / `*En` の対が残っていないこと
// ---------------------------------------------------------------------------
//
// 訳文の持ち方は 1 つでなければならない。**辞書（`ja.ts` / `en.ts`）のキー**か、
// それを運ぶ `LocalizedText` か、そのどちらかだけ。オブジェクトが `labelJa` と
// `labelEn` を並べて持つ形は、表示そのものは正しくなるが i18n の機構が 2 つになる。
// そうなると「`ja.ts` に文言を足したのに画面が変わらない」「辞書のキー検査
// （`localized-guard.test.ts`）がその文言を見ていない」が起きる。実際に
// `presets.ts` / `provisioning.ts` / `advanced.ts` の 75 か所がその状態だった。
//
// **この検査がどこまで見ているか（正直な範囲）**
//
//   走査するのは `packages/shared/src` / `packages/media/src` / `apps/desktop/src` と
//   `scripts`（`*.test.ts` / `*.test.tsx` を除く。`.mts` も読む）。
//   `scripts/` を足したのは、`ValidationIssue` から `messageJa` が消えたあとも
//   4 本が読み続け、検証が落ちたときの理由が `undefined` になっていたから。
//   `scripts/dev/` は `.gitignore` された使い捨ての置き場なので見ない
//   （手元にあるかどうかで結果が変わる検査にしない）。
//   コメントは落とすので、この節や `presets.ts` の「以前は `labelJa` だった」という
//   説明文は引っかからない。
//
//   見ているのは「識別子として `Ja` / `En` で終わる名前」だけで、字句解析はしていない。
//   したがって:
//     - 文字列リテラルの中の同じ綴りも拾う（＝**誤検出**しうる。現在のソースには無い）。
//     - `ja` / `en` という**小文字**のプロパティ名（`{ja: '…', en: '…'}`）は拾わない。
//       これは別の形の同じ間違いだが、`Locale` の値そのものが `'ja' | 'en'` なので
//       名前だけでは区別できない（＝**取りこぼし**）。
//     - 正規表現リテラル内の素の `//` を行コメントと誤読する（取りこぼし）。

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const SCAN_DIRS = ['packages/shared/src', 'packages/media/src', 'apps/desktop/src', 'scripts']
/** 走査しないディレクトリ（リポジトリルートからの相対、`/` 区切り）。 */
const SCAN_SKIP_DIRS = new Set(['scripts/dev'])

interface AllowedName {
  /** リポジトリルートからの相対パス（`/` 区切り）。 */
  readonly file: string
  /** 許可する識別子そのもの。ファイル単位ではなく**この名前だけ**を許す。 */
  readonly name: string
  readonly reason: string
}

/**
 * 意図的な例外。1 件ずつ理由を書く。
 *
 * **いまは空**。選択肢の `labelJa` / `titleJa` / `descriptionJa` と
 * `seed-builder.ts` の `whatJa` は辞書のキーに、`ValidationIssue` の
 * `messageJa` / `messageEn` は `LocalizedText` に移し終えている。
 * 例外を足すときは「なぜ辞書に置けないのか」を書くこと。下の it が
 * 「直したのに例外だけ残っている」状態を落とす。
 */
const NAME_ALLOWLIST: readonly AllowedName[] = []

/**
 * コメントを空白に潰す（行数は保つ）。`localized-guard.test.ts` と同じ近似で、
 * 行をまたげるのはブロックコメントとテンプレートリテラルだけ。
 */
function stripSourceComments(source: string): string {
  let out = ''
  let inBlock = false
  let quote: "'" | '"' | '`' | null = null
  for (const raw of source.split('\n')) {
    let kept = ''
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!
      const next = raw[i + 1]
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false
          kept += '  '
          i++
          continue
        }
        kept += ' '
        continue
      }
      if (quote !== null) {
        kept += c
        if (c === '\\') {
          kept += next ?? ''
          i++
          continue
        }
        if (c === quote) quote = null
        continue
      }
      if (c === '/' && next === '*') {
        inBlock = true
        kept += '  '
        i++
        continue
      }
      if (c === '/' && next === '/' && raw[i - 1] !== '\\') {
        kept += ' '.repeat(raw.length - i)
        break
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c
        kept += c
        continue
      }
      kept += c
    }
    if (quote === "'" || quote === '"') quote = null
    out += `${kept}\n`
  }
  return out
}

/** `Ja` / `En` で終わる識別子を抜き出す。`/g` を持つので抽出専用（落とし穴 63）。 */
const JA_EN_NAME = /\b[A-Za-z_$][A-Za-z0-9_$]*?(?:Ja|En)\b/g

interface NameHit {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly source: string
}

function listScanned(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = relative(REPO_ROOT, full).split(sep).join('/')
      if (statSync(full).isDirectory()) {
        if (!SCAN_SKIP_DIRS.has(rel)) walk(full)
        continue
      }
      // `scripts/` は `.mts` なので拡張子を広げる。広げないと scripts を
      // SCAN_DIRS に足しても 1 件も読まない「何も検証しない検査」になる。
      if (!/\.(ts|tsx|mts)$/.test(name)) continue
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
      out.push({
        file: rel,
        code: stripSourceComments(readFileSync(full, 'utf8')),
      })
    }
  }
  for (const d of SCAN_DIRS) walk(join(REPO_ROOT, d))
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

function findJaEnNames(files: readonly { file: string; code: string }[]): NameHit[] {
  const hits: NameHit[] = []
  for (const { file, code } of files) {
    code.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(JA_EN_NAME)) {
        hits.push({ file, line: i + 1, name: m[0], source: line.trim() })
      }
    })
  }
  return hits
}

describe('i18n の機構が 2 つに戻っていない', () => {
  const files = listScanned()
  const hits = findJaEnNames(files)

  it('走査対象を実際に読めている（空だと何も検証しないので確認する）', () => {
    const names = files.map((f) => f.file)
    expect(names.length).toBeGreaterThan(30)
    expect(names).toContain('packages/shared/src/autoinstall/presets.ts')
    expect(names).toContain('packages/shared/src/autoinstall/provisioning.ts')
    expect(names).toContain('packages/shared/src/autoinstall/advanced.ts')
    expect(names).toContain('packages/shared/src/autoinstall/validate.ts')
    expect(names).toContain('apps/desktop/src/main/seed-builder.ts')
    expect(names).toContain('apps/desktop/src/renderer/src/lib/i18n.ts')
    // `scripts/` を実際に読めていること。ここが空だと、`.mts` を拾えていないのに
    // 「scripts も見ている」と言うだけの検査になる。
    expect(names).toContain('scripts/smoke-media.mts')
    expect(names).toContain('scripts/e2e-matrix.mts')
    expect(names).toContain('scripts/e2e-write-usb.mts')
    expect(names).toContain('scripts/e2e-worker-usb.mts')
    expect(names.filter((n) => n.startsWith('scripts/dev/'))).toEqual([])
    expect(names.filter((n) => n.includes('.test.'))).toEqual([])
    // コメント除去が働いていること。**実在する文面**で確かめる
    // （このリポジトリに無い語で書くと、除去が壊れていても通る空の検査になる）。
    const presets = files.find((f) => f.file === 'packages/shared/src/autoinstall/presets.ts')!
    expect(presets.code).toContain('export interface KeyboardChoice extends Choice')
    // `// **表示名は辞書のキーで持つ。** …`（行コメント）
    expect(presets.code, '行コメントが残っている').not.toContain('表示名は辞書のキーで持つ')
    // `/** 画面に出す名前。… */`（ブロックコメント）
    expect(presets.code, 'ブロックコメントが残っている').not.toContain('画面に出す名前')
  })

  it('`*Ja` / `*En` で終わる識別子が残っていない（例外は NAME_ALLOWLIST に理由つきで）', () => {
    const remaining = hits.filter(
      (h) => !NAME_ALLOWLIST.some((a) => a.file === h.file && a.name === h.name),
    )
    const report = remaining
      .map((h) => `  ${h.file}:${h.line}\n    ${h.name}\n    ${h.source}`)
      .join('\n')
    expect(
      remaining.map((h) => `${h.file}:${h.line} ${h.name}`),
      remaining.length === 0
        ? ''
        : `訳文を「ja / en の両方を持つオブジェクト」で運んでいる箇所が ${remaining.length} 件あります。\n` +
            'ja.ts / en.ts にキーを足し、そのキー (MsgKey) か LocalizedText で運んでください。\n' +
            '意図的な例外なら i18n.test.ts の NAME_ALLOWLIST に理由つきで足してください。\n' +
            report,
    ).toEqual([])
  })

  it('NAME_ALLOWLIST に死んだ例外が残っていない', () => {
    const unused = NAME_ALLOWLIST.filter(
      (a) => !hits.some((h) => h.file === a.file && h.name === a.name),
    )
    expect(
      unused.map((a) => `${a.file}: ${a.name}`),
      '直したのに例外だけ残ると、次に増えた対をそのまま通してしまいます',
    ).toEqual([])
  })

  it('検査そのものが効く（対を書いたら落ちることを確かめる）', () => {
    // この it が無いと、正規表現やコメント除去を書き間違えて「何も検出しない検査」に
    // なっても全部緑のままになる（落とし穴 57）。
    const sample = [
      "const A = [{ value: 'x', labelJa: 'a', labelEn: 'b' }]",
      '// labelJa と書いたコメントは拾わない',
      '/** titleJa もブロックコメントなら拾わない */',
      "const B = { label: 'basics.localeC' }",
      // 末尾が小文字の `en` / `ja` のふつうの語を誤検出しない
      'const open = hidden ? 1 : 2',
    ].join('\n')
    const found = findJaEnNames([{ file: 'sample.ts', code: stripSourceComments(sample) }])
    expect(found.map((h) => h.name)).toEqual(['labelJa', 'labelEn'])
    // 直したあとの形は 1 件も拾わない
    const fixed = findJaEnNames([
      {
        file: 'sample.ts',
        code: stripSourceComments("const A = [{ value: 'x', label: 'basics.localeC' }]"),
      },
    ])
    expect(fixed).toEqual([])
  })
})
