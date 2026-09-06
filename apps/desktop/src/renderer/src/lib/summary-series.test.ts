import { describe, expect, it } from 'vitest'
import {
  UBUNTU_SERIES,
  buildAutoinstallObject,
  createDefaultProfile,
  en,
  formatLocalized,
  ja,
  type AutoinstallProfile,
  type MsgKey,
  type UbuntuSeries,
} from '@autoinstall/shared'
import { summarizeStep } from './summary.js'
import type { StepId } from '../store.js'

// サイドバーの 1 行要約が、**そのリリースで実際に出力される設定だけ**を言うこと。
//
// 7 巡目に見つかった high。`summary.ts` は `SERIES_FEATURES` を import すら
// していなかったので、22.04 のプロファイルで:
//
//   生成 source              : undefined   → 要約「最小構成」
//   生成 interactive-sections: undefined   → 要約「全画面で入力を待つ」
//   生成 storage.layout      : reset 無し  → 要約「リセット領域あり」
//
// と出ていた。最後のものが最悪で、**実際には完全無人インストールなのに
// 「全画面で入力を待つ」と出る**。6 巡目に直した「隠した設定が要約に出ない」の
// ちょうど逆向きの、同じ嘘。
//
// ここで固定するのは 4 つ。
//
//   1. 要約の断片の有無が、**生成物にそのキーが出るかどうかと一致する**
//      （表を 4 リリース分まわす。これがいちばん強い検査で、
//        「効かないのに言う」と「効くのに言わない」の両方を同時に見る）
//   2. 落とした設定を**黙って消さない**（`nav.summaryIneffective` で件数を言う。落とし穴 50）
//   3. **`changed` も同じ計算から導く**。効かない設定だけを変えたプロファイルは
//      生成物が既定と 1 バイトも変わらないので「既定のまま」と包まれる
//      （断片と `changed` を別々に数えると、片方だけが追いつかない。落とし穴 22）
//   4. `series` が読めないときは出し分けをせず、読めなかったことを言う（落とし穴 49）

const render = (step: StepId, profile: AutoinstallProfile): { ja: string; en: string } => {
  const text = summarizeStep(step, profile)
  if (text === null) throw new Error(`${step} の要約が null`)
  return { ja: formatLocalized('ja', text), en: formatLocalized('en', text) }
}

const DEFAULT_HEAD = {
  ja: ja['nav.summaryDefault'].split('{detail}')[0]!,
  en: en['nav.summaryDefault'].split('{detail}')[0]!,
}
const isDefaultText = (s: { ja: string; en: string }): boolean =>
  s.ja.startsWith(DEFAULT_HEAD.ja) && s.en.startsWith(DEFAULT_HEAD.en)

/** 差し込み忘れ（`{name}` が残る）と、辞書に無いキー（`nav.` がそのまま出る）を弾く。 */
const looksTranslated = (s: string): boolean =>
  s.length > 0 && !/\{[A-Za-z]/.test(s) && !s.includes('nav.summary')

const base = (series: UbuntuSeries): AutoinstallProfile => createDefaultProfile(series)

const patch = (p: AutoinstallProfile, over: Record<string, unknown>): AutoinstallProfile =>
  ({ ...p, ...over }) as unknown as AutoinstallProfile

const built = (p: AutoinstallProfile): Record<string, unknown> => buildAutoinstallObject(p)

const at = (obj: unknown, ...path: string[]): unknown => {
  let cur: unknown = obj
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * リリースで出し分けられる設定と、それが要約に出す断片・生成物に出すキー。
 *
 * **同じ 1 つの設定について、要約と生成物を突き合わせる。**
 * 片方だけを固定するテストは「今の実装の形」を固定するだけで、
 * 食い違いそのものを見ない（落とし穴 56）。
 */
const SERIES_GATED: {
  name: string
  step: StepId
  /** 要約に出るはずの断片（`{n}` は 1 件として埋める）。 */
  key: MsgKey
  apply: (p: AutoinstallProfile) => AutoinstallProfile
  /** 生成された autoinstall にその設定が出ているか。 */
  emitted: (out: Record<string, unknown>) => boolean
}[] = [
  {
    name: 'software.sourceId = 最小構成',
    step: 'software',
    key: 'nav.summarySourceMinimal',
    apply: (p) => ({ ...p, software: { ...p.software, sourceId: 'ubuntu-server-minimal' } }),
    emitted: (out) => at(out, 'source', 'id') === 'ubuntu-server-minimal',
  },
  {
    name: 'software.searchDrivers',
    step: 'software',
    key: 'nav.summaryOther',
    apply: (p) => ({ ...p, software: { ...p.software, searchDrivers: false } }),
    emitted: (out) => at(out, 'source', 'search_drivers') !== undefined,
  },
  {
    name: 'software.codecs',
    step: 'software',
    key: 'nav.summaryOther',
    apply: (p) => ({ ...p, software: { ...p.software, codecs: true } }),
    emitted: (out) => at(out, 'codecs') !== undefined,
  },
  {
    name: 'software.oem',
    step: 'software',
    key: 'nav.summaryOther',
    apply: (p) => ({ ...p, software: { ...p.software, oem: 'yes' } }),
    emitted: (out) => at(out, 'oem') !== undefined,
  },
  {
    name: 'software.kernelCrashDumps',
    step: 'software',
    key: 'nav.summaryOther',
    apply: (p) => ({ ...p, software: { ...p.software, kernelCrashDumps: true } }),
    emitted: (out) => at(out, 'kernel-crash-dumps') !== undefined,
  },
  {
    name: 'apt.fallback',
    step: 'software',
    key: 'nav.summaryMirrorCustom',
    apply: (p) => ({ ...p, apt: { ...p.apt, fallback: 'continue-anyway' } }),
    emitted: (out) => at(out, 'apt', 'fallback') !== undefined,
  },
  {
    name: 'storage.resetPartition',
    step: 'storage',
    key: 'nav.summaryResetPartition',
    apply: (p) => ({
      ...p,
      storage: { ...p.storage, resetPartition: { enabled: true, size: '' } } as never,
    }),
    emitted: (out) => at(out, 'storage', 'layout', 'reset-partition') !== undefined,
  },
  {
    name: 'behavior.interactiveAll',
    step: 'postinstall',
    key: 'nav.summaryInteractiveAll',
    apply: (p) => ({ ...p, behavior: { ...p.behavior, interactiveAll: true } }),
    emitted: (out) => at(out, 'interactive-sections') !== undefined,
  },
  {
    name: 'activeDirectory',
    step: 'postinstall',
    key: 'nav.summaryActiveDirectory',
    apply: (p) => ({
      ...p,
      activeDirectory: {
        ...p.activeDirectory,
        enabled: true,
        domainName: 'corp.example.com',
        adminName: 'Administrator',
      },
    }),
    emitted: (out) => at(out, 'active-directory') !== undefined,
  },
]

/** `{n}` を 1 件として埋めた断片の文字列。 */
const fragment = (locale: 'ja' | 'en', key: MsgKey): string =>
  (locale === 'ja' ? ja : en)[key].replace('{n}', '1')

describe('要約はリリースで出し分けられた設定を「有効」と言わない', () => {
  it('前提: 表の設定は 4 リリースのどこかで実際に落ちている（空振りしていない）', () => {
    // ここが全部 true だと、下の突き合わせは何も検証していないことになる（落とし穴 57）。
    const dropped = SERIES_GATED.filter((g) =>
      UBUNTU_SERIES.some((s) => !g.emitted(built(g.apply(base(s))))),
    )
    expect(dropped.map((g) => g.name)).toHaveLength(SERIES_GATED.length)
    // 逆に、どのリリースでも出ないものがあれば表のほうが間違っている。
    const neverEmitted = SERIES_GATED.filter((g) =>
      UBUNTU_SERIES.every((s) => !g.emitted(built(g.apply(base(s))))),
    )
    expect(neverEmitted.map((g) => g.name)).toEqual([])
  })

  for (const series of UBUNTU_SERIES) {
    for (const g of SERIES_GATED) {
      it(`${series} / ${g.name}: 要約の断片と生成物のキーが一致する`, () => {
        const profile = g.apply(base(series))
        const emitted = g.emitted(built(profile))
        const s = render(g.step, profile)
        const where = `${series} ${g.name} (emitted=${emitted}) -> ${s.ja}`
        expect(s.ja.includes(fragment('ja', g.key)), where).toBe(emitted)
        expect(s.en.includes(fragment('en', g.key)), where).toBe(emitted)
      })
    }
  }
})

describe('効かない設定は黙って消さない（落とし穴 50）', () => {
  const ineffective = (n: number, locale: 'ja' | 'en'): string =>
    (locale === 'ja' ? ja : en)['nav.summaryIneffective'].replace('{n}', String(n))

  it('22.04: 出力されない設定の件数を言う', () => {
    for (const g of SERIES_GATED) {
      const profile = g.apply(base('22.04'))
      if (g.emitted(built(profile))) continue // 22.04 でも出るものは対象外
      const s = render(g.step, profile)
      expect(s.ja, `${g.name}: ${s.ja}`).toContain(ineffective(1, 'ja'))
      expect(s.en, `${g.name}: ${s.en}`).toContain(ineffective(1, 'en'))
    }
  })

  it('22.04: 複数まとめて設定すると件数がその数になる', () => {
    // 親の再現そのまま。software 側は sourceId / searchDrivers / codecs / oem /
    // apt.fallback の 5 件が落ちる（kernelCrashDumps は既定のまま）。
    const p = ['software.sourceId = 最小構成', 'software.searchDrivers', 'software.codecs', 'software.oem', 'apt.fallback']
      .map((name) => SERIES_GATED.find((g) => g.name === name)!)
      .reduce((acc, g) => g.apply(acc), base('22.04'))
    const s = render('software', p)
    expect(s.ja).toContain(ineffective(5, 'ja'))
    expect(s.en).toContain(ineffective(5, 'en'))
    // 断片そのものは出ない（効かないものを「有効」と言わない）
    expect(s.ja).not.toContain(ja['nav.summarySourceMinimal'])
    expect(s.ja).not.toContain(ja['nav.summaryMirrorCustom'])
  })

  it('24.04 では同じ設定がそのまま断片として出る（ゲートを効かせすぎない）', () => {
    const p = ['software.sourceId = 最小構成', 'apt.fallback']
      .map((name) => SERIES_GATED.find((g) => g.name === name)!)
      .reduce((acc, g) => g.apply(acc), base('24.04'))
    const s = render('software', p)
    expect(s.ja).toContain(ja['nav.summarySourceMinimal'])
    expect(s.ja).toContain(ja['nav.summaryMirrorCustom'])
    // 「効かない設定が N 件」は 1 件も出ない（24.04 では全部効く）
    expect(s.ja).not.toContain(ja['nav.summaryIneffective'].split('{n}')[0]!)
  })

  it('ja / en のどちらでも訳せる（差し込み漏れも生キーも出ない）', () => {
    for (const g of SERIES_GATED) {
      const s = render(g.step, g.apply(base('22.04')))
      expect(looksTranslated(s.ja), `${g.name} ja: ${s.ja}`).toBe(true)
      expect(looksTranslated(s.en), `${g.name} en: ${s.en}`).toBe(true)
      expect(/[ぁ-んァ-ヶ一-龠]/.test(s.en), `${g.name} の en に日本語: ${s.en}`).toBe(false)
    }
  })
})

describe('「既定のまま」も同じ計算から導く（落とし穴 22）', () => {
  it('22.04: 効かない設定だけを変えたら「既定のまま」と包まれる', () => {
    // 生成物は既定と 1 バイトも変わらないので、「既定ではない」と言うのは
    // 逆向きの嘘になる。断片だけ直して `changed` を放置すると、ここが落ちる。
    for (const g of SERIES_GATED) {
      const profile = g.apply(base('22.04'))
      if (g.emitted(built(profile))) continue
      expect(JSON.stringify(built(profile))).toBe(JSON.stringify(built(base('22.04'))))
      const s = render(g.step, profile)
      expect(isDefaultText(s), `${g.name}: ${s.ja}`).toBe(true)
    }
  })

  it('24.04: 効く設定を変えたら「既定のまま」ではなくなる', () => {
    for (const g of SERIES_GATED) {
      const profile = g.apply(base('24.04'))
      if (!g.emitted(built(profile))) continue
      const s = render(g.step, profile)
      expect(isDefaultText(s), `${g.name}: ${s.ja}`).toBe(false)
    }
  })

  it('効かない設定と効く設定が混ざったら「既定のまま」ではない', () => {
    const minimal = SERIES_GATED.find((g) => g.name === 'software.sourceId = 最小構成')!
    const p = minimal.apply(base('22.04'))
    const s = render('software', {
      ...p,
      software: { ...p.software, packages: ['nginx'] },
    })
    expect(isDefaultText(s), s.ja).toBe(false)
    expect(s.ja).toContain(ja['nav.summaryPackages'].replace('{n}', '1'))
  })
})

describe('series が読めないときは出し分けをしない', () => {
  it('読めなかったことを言い、断片は落とさない（落とし穴 49）', () => {
    const p = patch(base('22.04'), { series: 'NOT-A-SERIES' })
    const unknownJa = ja['nav.summaryUnknown'].replace('{value}', '').slice(0, 6)
    for (const step of ['storage', 'software', 'postinstall'] as const) {
      const s = render(step, p)
      expect(s.ja, step).toContain(unknownJa)
      expect(s.ja, step).toContain('NOT-A-SERIES')
      expect(looksTranslated(s.ja), s.ja).toBe(true)
      expect(looksTranslated(s.en), s.en).toBe(true)
    }
    // 出し分けができないので、設定はそのまま断片として出す（黙って消さない）。
    const minimal = SERIES_GATED.find((g) => g.name === 'software.sourceId = 最小構成')!
    expect(render('software', minimal.apply(p)).ja).toContain(ja['nav.summarySourceMinimal'])
  })

  it('series が壊れていても例外を投げない（サイドバーは Error Boundary の外）', () => {
    for (const bad of [null, undefined, 42, [], {}, '24.4']) {
      const p = patch(base('24.04'), { series: bad })
      for (const step of ['storage', 'software', 'postinstall'] as const) {
        expect(() => summarizeStep(step, p), String(bad)).not.toThrow()
      }
    }
  })
})
