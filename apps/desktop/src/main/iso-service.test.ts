import { afterAll, describe, expect, it } from 'vitest'
import { cleanupTempDirs, makeTempDir } from './test-support/temp-files.js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IsoValidationError } from '@autoinstall/media'
import { en, formatLocalized, ja, recognizeIso, type LocalizedText } from '@autoinstall/shared'
import { invalidIsoText, openIso, unsupportedIsoText } from './iso-service.js'

// ISO を拒否した理由は `IsoStep` の Callout に本文としてそのまま描かれる。
// main はここで訳さず `LocalizedText` のまま返し、renderer が利用者の言語で描く。
//
// 文面を `toContain` で固定すると、English に切り替えても日本語を返す実装を
// テストが「正」として要求してしまう（落とし穴 56）。**キー**を確かめる。

const dir = makeTempDir('iso-service-')

/** 失敗した結果だけを取り出す（成功なら落とす）。 */
async function reject(path: string): Promise<{
  reason: string
  // 型を手で書き写すと、契約が広がったときに**テストだけが古い形を要求する**。
  // 本物の型を使う（落とし穴 56 の「今の実装の形を固定する」の別の顔）。
  text: LocalizedText
  detail: string | null
}> {
  const result = await openIso(path)
  if (result.ok) throw new Error('拒否されるはずの ISO が受け入れられた')
  return result
}

describe('openIso は拒否理由を訳せる形で返す', () => {
  it('ファイルが無いときは not-found のキーを返す', async () => {
    const r = await reject(join(dir, 'does-not-exist.iso'))
    expect(r.reason).toBe('not-found')
    expect(r.text.key).toBe('iso.rejectNotFound')
    // 開発者向けの生の詳細は無い（原因は分かっているので添えるものがない）
    expect(r.detail).toBeNull()
  })

  it('ディレクトリを渡すと not-a-file のキーを返す', async () => {
    const r = await reject(dir)
    expect(r.reason).toBe('not-a-file')
    expect(r.text.key).toBe('iso.rejectNotAFile')
    expect(r.detail).toBeNull()
  })

  it('ISO9660 ですらないファイルは、訳した総括 + 生の詳細の 2 本立てになる', async () => {
    const path = join(dir, 'not-an-iso.iso')
    // ISO9660 の PVD は LBA 16 にある。それより小さいファイルは構造から拒否される。
    writeFileSync(path, Buffer.alloc(4096, 0))
    const r = await reject(path)
    // 壊れた ISO の内部構造は開発者向けの診断なので、訳さず detail に落とす。
    // 総括文は**理由ごとに違うキー**。総称の `iso.unsupported` に潰すと
    // Callout のタイトルと本文が同じ文字列になる（実際に退行させた）。
    expect(r.reason).toBe('not-iso9660')
    expect(r.text.key).toBe('iso.rejectNotIso9660')
    expect(r.text.key).not.toBe('iso.unsupported')
    expect(r.detail).not.toBeNull()
    expect(typeof r.detail).toBe('string')
  })

  it('認識できなかった ISO は理由ごとに別のキーになり、生のボリューム ID を運ぶ', () => {
    // 実 ISO を用意せずに 3 分岐を確かめる。`recognizeIso` の結果をそのまま渡す。
    const desktop = recognizeIso('Ubuntu 24.04.1 LTS amd64')
    expect(desktop.kind).toBe('unsupported')
    if (desktop.kind === 'unsupported') {
      expect(unsupportedIsoText(desktop.reason, desktop.detail)).toEqual({
        key: 'iso.notServer',
        params: { volumeId: 'Ubuntu 24.04.1 LTS amd64' },
      })
    }

    const proxmox = recognizeIso('PVE')
    expect(proxmox.kind).toBe('unsupported')
    if (proxmox.kind === 'unsupported') {
      expect(unsupportedIsoText(proxmox.reason, proxmox.detail)).toEqual({
        key: 'iso.rejectNotUbuntu',
        params: { volumeId: 'PVE' },
      })
    }

    // 未知のシリーズは「バージョン」を運ぶ（ボリューム ID ではない）
    expect(unsupportedIsoText('unknown-series', '30.04')).toEqual({
      key: 'iso.unknownSeries',
      params: { version: '30.04' },
    })
  })

  it('返した LocalizedText は両方の言語で読め、JSON を往復しても変わらない', async () => {
    const r = await reject(join(dir, 'does-not-exist.iso'))
    expect(formatLocalized('en', r.text as never)).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
    expect(formatLocalized('ja', r.text as never)).toMatch(/[ぁ-んァ-ヶ一-龠]/u)
    expect(JSON.parse(JSON.stringify(r.text)) as unknown).toEqual(r.text)
  })
})

// `IsoStep.tsx` の Callout は **タイトルに `iso.unsupported`** を使う。
// 本文まで同じキーにすると、タイトルと本文がまったく同じ文字列になり、
// 意味のある情報が開発者向けの `<pre>`（detail）にしか残らない。
// CLAUDE.md の「Proxmox と Windows Vista は no-casper として**原因つきで**拒否される」が
// 成立しなくなるので、ここで固定する。
const CALLOUT_TITLE_KEY = 'iso.unsupported'

/**
 * `IsoValidationError['reason']` の全列挙。
 *
 * `satisfies Record<..., true>` なので、media 側の union に理由を足すと
 * **このテストがコンパイルエラーになる**（列挙を書き足し忘れられない）。
 */
const ALL_INVALID_REASONS = Object.keys({
  'not-iso9660': true,
  'no-casper': true,
  'no-grub-cfg': true,
  'no-kernel-line': true,
  'grub-too-large': true,
} satisfies Record<IsoValidationError['reason'], true>) as IsoValidationError['reason'][]

describe('ISO の構造を理由に拒否したときは、理由ごとに別の文言になる', () => {
  it('5 つの reason がすべて別々のキーになる', () => {
    expect(ALL_INVALID_REASONS).toHaveLength(5)
    const keys = ALL_INVALID_REASONS.map((r) => invalidIsoText(r).key)
    expect(new Set(keys).size, `重複したキーがある: ${keys.join(', ')}`).toBe(keys.length)
  })

  it('どの reason も Callout のタイトルと同じキーに潰れない', () => {
    for (const reason of ALL_INVALID_REASONS) {
      expect(invalidIsoText(reason).key, `${reason} が総称のキーに潰れている`).not.toBe(
        CALLOUT_TITLE_KEY,
      )
    }
  })

  it('本文はタイトルと違う文字列になる（キーが違っても訳文が同じなら意味が無い）', () => {
    for (const reason of ALL_INVALID_REASONS) {
      for (const locale of ['ja', 'en'] as const) {
        const title = locale === 'ja' ? ja[CALLOUT_TITLE_KEY] : en[CALLOUT_TITLE_KEY]
        expect(formatLocalized(locale, invalidIsoText(reason)), `${locale}/${reason}`).not.toBe(
          title,
        )
      }
    }
  })

  it('割り当てたキーが ja と en の両方に実在する', () => {
    for (const reason of ALL_INVALID_REASONS) {
      const { key } = invalidIsoText(reason)
      expect(ja[key], `ja に ${key} が無い`).toBeTypeOf('string')
      expect(en[key], `en に ${key} が無い`).toBeTypeOf('string')
      // 訳せていないとキー名がそのまま画面に出る
      expect(formatLocalized('ja', invalidIsoText(reason))).not.toBe(key)
      expect(formatLocalized('en', invalidIsoText(reason))).not.toBe(key)
    }
  })

  it('英語の本文に日本語が残らず、日本語の本文は日本語で出る', () => {
    for (const reason of ALL_INVALID_REASONS) {
      const text = invalidIsoText(reason)
      expect(formatLocalized('en', text), `en/${reason}`).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
      expect(formatLocalized('ja', text), `ja/${reason}`).toMatch(/[ぁ-んァ-ヶ一-龠]/u)
    }
  })

  it('訳文に差し込みを持たない（生のオフセット・バイト数は detail に残す）', () => {
    for (const reason of ALL_INVALID_REASONS) {
      const text = invalidIsoText(reason)
      // params を生やさなければ、値の取りこぼしで `{n}` が画面に出ることもない
      expect(Object.keys(text), reason).toEqual(['key'])
      expect(formatLocalized('ja', text), reason).not.toMatch(/[{}]/)
      expect(formatLocalized('en', text), reason).not.toMatch(/[{}]/)
    }
  })

  it('grub-too-large は「どうすればよいか」を伝える', () => {
    // 5 つの中で唯一、利用者が自分で直せる（カーネル引数を減らす）。
    // 総称の文言に潰すと、この行動指示が消える。
    expect(formatLocalized('ja', invalidIsoText('grub-too-large'))).toMatch(/減らして/)
    expect(formatLocalized('en', invalidIsoText('grub-too-large'))).toMatch(/reduce/i)
  })
})

afterAll(() => {
  cleanupTempDirs()
})
