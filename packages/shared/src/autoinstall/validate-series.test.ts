import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './defaults.js'
import { validateProfile } from './validate.js'
import { buildAutoinstallObject } from './generate.js'
import { SERIES_FEATURES, type AutoinstallProfile, type SeriesFeatures } from './model.js'

// ===========================================================================
// リリースで出し分けられる設定は、全部が「効きません」と言う（落とし穴 67 / 73）
// ===========================================================================
//
// `generate.ts` は `SERIES_FEATURES` の各フラグでキーごと出力を落とす。
// UI (`SoftwareStep` / `PostInstallStep` / `StorageStep` / `UserStep`) も
// 同じフラグでその欄を隠す。**設定は残り、生成物には出ず、誰も何も言わない**
// という状態を作らないために、落ちる設定には必ず warning を出す。
//
// 7 巡目の監査では 10 件中 7 件にしか警告が無く、
// `search_drivers` / `codecs` / `oem` の 3 件だけが無言だった。
// 1 件ずつ書くと次に増えた 1 件をまた落とすので、**表でまわす**。
// 表が `SeriesFeatures` のフラグを網羅していることも一緒に見る
// （フラグが増えたら、この網羅チェックが落ちる）。

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

function deep(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function seriesBase(series: AutoinstallProfile['series']): AutoinstallProfile {
  const p = createDefaultProfile(series)
  return {
    ...p,
    basics: { ...p.basics, hostname: 'h1' },
    user: { ...p.user, username: 'opsuser', passwordHash: HASH },
  }
}

const warningsFor = (p: AutoinstallProfile): { field: string; key: string }[] =>
  validateProfile(p)
    .issues.filter((i) => i.severity === 'warning')
    .map((i) => ({ field: i.field, key: i.text.key }))

const SERIES_GATED_SETTINGS: {
  name: string
  /** どの `SeriesFeatures` のフラグで落ちるか（網羅チェックが使う）。 */
  feature: keyof SeriesFeatures
  /** 落ちるリリースと、そのまま出るリリース。 */
  droppedOn: AutoinstallProfile['series']
  keptOn: AutoinstallProfile['series']
  field: string
  apply: (p: AutoinstallProfile) => AutoinstallProfile
  /** 生成物にその設定が出ているか（警告の要否を実物で確かめる）。 */
  emitted: (out: Record<string, unknown>) => boolean
}[] = [
  {
    name: 'software.sourceId',
    feature: 'source',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'software.sourceId',
    apply: (p) => ({ ...p, software: { ...p.software, sourceId: 'ubuntu-server-minimal' } }),
    emitted: (out) => deep(out, 'source', 'id') === 'ubuntu-server-minimal',
  },
  {
    name: 'software.searchDrivers',
    feature: 'source',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'software.searchDrivers',
    apply: (p) => ({ ...p, software: { ...p.software, searchDrivers: false } }),
    emitted: (out) => deep(out, 'source', 'search_drivers') !== undefined,
  },
  {
    name: 'software.codecs',
    feature: 'codecsOemAd',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'software.codecs',
    apply: (p) => ({ ...p, software: { ...p.software, codecs: true } }),
    emitted: (out) => deep(out, 'codecs') !== undefined,
  },
  {
    name: 'software.oem',
    feature: 'codecsOemAd',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'software.oem',
    apply: (p) => ({ ...p, software: { ...p.software, oem: 'yes' } }),
    emitted: (out) => deep(out, 'oem') !== undefined,
  },
  {
    name: 'software.kernelCrashDumps',
    feature: 'kernelCrashDumps',
    droppedOn: '24.04',
    keptOn: '25.10',
    field: 'software.kernelCrashDumps',
    apply: (p) => ({ ...p, software: { ...p.software, kernelCrashDumps: true } }),
    emitted: (out) => deep(out, 'kernel-crash-dumps') !== undefined,
  },
  {
    name: 'apt.fallback',
    feature: 'aptFallback',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'apt.fallback',
    apply: (p) => ({ ...p, apt: { ...p.apt, fallback: 'continue-anyway' } }),
    emitted: (out) => deep(out, 'apt', 'fallback') !== undefined,
  },
  {
    name: 'storage.resetPartition',
    feature: 'resetPartition',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'storage.resetPartition',
    apply: (p) => ({
      ...p,
      storage: { ...p.storage, resetPartition: { enabled: true, size: '' } } as never,
    }),
    emitted: (out) => deep(out, 'storage', 'layout', 'reset-partition') !== undefined,
  },
  {
    name: 'behavior.interactiveAll',
    feature: 'interactiveAll',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'behavior.interactiveAll',
    apply: (p) => ({ ...p, behavior: { ...p.behavior, interactiveAll: true } }),
    emitted: (out) => deep(out, 'interactive-sections') !== undefined,
  },
  {
    name: 'activeDirectory',
    feature: 'codecsOemAd',
    droppedOn: '22.04',
    keptOn: '24.04',
    field: 'activeDirectory',
    apply: (p) => ({
      ...p,
      activeDirectory: {
        ...p.activeDirectory,
        enabled: true,
        domainName: 'corp.example.com',
        adminName: 'Administrator',
      },
    }),
    emitted: (out) => deep(out, 'active-directory') !== undefined,
  },
  {
    name: 'user.groups',
    feature: 'identityGroups',
    droppedOn: '24.04',
    keptOn: '26.04',
    field: 'user.groups',
    apply: (p) => ({
      ...p,
      user: { ...p.user, groups: { mode: 'append', groups: ['docker'] } },
    }),
    emitted: (out) => deep(out, 'identity', 'groups') !== undefined,
  },
]

/**
 * どのプロファイル設定でも踏めないフラグと、その理由（落とし穴 78）。
 * ここが空だと「全部見ている」と誤解される。踏めるようになったら表から消す。
 */
const NO_SETTING_BEHIND_FEATURE: Partial<Record<keyof SeriesFeatures, string>> = {
  interactiveSections: '4 リリースとも true。落ちる組み合わせが存在しない',
  ubuntuPro: 'キー名が ubuntu-pro / ubuntu-advantage に変わるだけで、設定は落ちない',
  zdevs: '対応する設定が GUI にもモデルにも無い（生 YAML で書くしかない）',
  hweMenuEntry: 'grub.cfg 側の事情。autoinstall の出力には関係しない',
}

describe('リリースで出力されない設定は「効きません」と伝える', () => {
  it('表が SERIES_FEATURES のフラグを網羅している（増えたら気づける）', () => {
    const covered = new Set(SERIES_GATED_SETTINGS.map((s) => s.feature))
    const uncovered = (Object.keys(SERIES_FEATURES['22.04']) as (keyof SeriesFeatures)[])
      .filter((k) => !covered.has(k))
      .sort()
    expect(uncovered).toEqual(
      (Object.keys(NO_SETTING_BEHIND_FEATURE) as (keyof SeriesFeatures)[]).sort(),
    )
  })

  for (const s of SERIES_GATED_SETTINGS) {
    it(`${s.name}: ${s.droppedOn} では出力されず、警告が出る`, () => {
      const p = s.apply(seriesBase(s.droppedOn))
      // 前提を実物で確かめる（生成側が出すようになったら、この警告のほうが嘘になる）
      expect(
        s.emitted(buildAutoinstallObject(p)),
        `${s.name} が ${s.droppedOn} で出力された`,
      ).toBe(false)
      const hit = warningsFor(p).filter((w) => w.field === s.field)
      expect(hit.map((w) => w.key), `${s.name} に警告が無い`).not.toEqual([])
      // 文言が「効かない」と言っているキーであること
      // （`validate-i18n.test.ts` の IGNORED_KEYS が本文まで見る）
      expect(hit.some((w) => /Unsupported|Unverified/.test(w.key)), `${s.name}`).toBe(true)
    })

    it(`${s.name}: ${s.keptOn} では出力され、「効きません」とは言わない`, () => {
      const p = s.apply(seriesBase(s.keptOn))
      expect(s.emitted(buildAutoinstallObject(p)), `${s.name} が ${s.keptOn} で落ちた`).toBe(true)
      const hit = warningsFor(p).filter(
        (w) => w.field === s.field && /Unsupported|Unverified/.test(w.key),
      )
      expect(hit.map((w) => w.key), '効くのに「効きません」と言っている').toEqual([])
    })
  }
})
