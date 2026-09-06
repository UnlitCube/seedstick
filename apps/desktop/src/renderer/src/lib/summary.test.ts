import { describe, expect, it } from 'vitest'
import {
  createDefaultProfile,
  formatLocalized,
  ja,
  en,
  type AutoinstallProfile,
  type MsgKey,
} from '@autoinstall/shared'
import { summarizeStep } from './summary.js'
import { STEP_ORDER, type StepId } from '../store.js'

// サイドバーの 1 行要約。ここで固定するのは 4 つ。
//
//   1. 「既定のまま」が専用のキーで区別できること（`nav.summaryDefault`）
//   2. 設定を変えたら要約も変わること（＝要約が飾りになっていないこと）
//   3. **手で壊したプロファイルでも例外を投げないこと**（落とし穴 23 / 60）。
//      サイドバーは Error Boundary の外なので、投げると画面が白くなる
//   4. 壊れた値を黙って「既定のまま」に落とさないこと（落とし穴 49 / 50）

const both = (step: StepId, profile: AutoinstallProfile): { ja: string; en: string } => {
  const text = summarizeStep(step, profile)
  if (text === null) throw new Error(`${step} の要約が null`)
  return { ja: formatLocalized('ja', text), en: formatLocalized('en', text) }
}

/** 差し込み忘れ（`{name}` が残る）と、辞書に無いキー（`nav.` がそのまま出る）を弾く。 */
const looksTranslated = (s: string): boolean =>
  s.length > 0 && !/\{[A-Za-z]/.test(s) && !s.includes('nav.summary') && !s.includes('nav.group')

const DEFAULT_JA = ja['nav.summaryDefault'].replace('{detail}', '')
const DEFAULT_EN = en['nav.summaryDefault'].replace('{detail}', '')

const isDefaultText = (s: { ja: string; en: string }): boolean =>
  s.ja.startsWith(DEFAULT_JA.slice(0, 5)) && s.en.startsWith(DEFAULT_EN.slice(0, 8))

const base = (): AutoinstallProfile => createDefaultProfile('24.04')

/** プロファイルの一部を差し替える（型に無い値も入れられるようにする）。 */
function patch(over: Record<string, unknown>): AutoinstallProfile {
  return { ...base(), ...over } as unknown as AutoinstallProfile
}

describe('summarizeStep — 要約を出さないステップ', () => {
  // **`user` はここに含めない。** 折りたたみ（管理ユーザーの追加グループ）を持つのに
  // 要約が `null` で、このステップだけ「たたんでも中身が分かる」が効いていなかった。
  // 中身は `summary-placement.test.ts` が固定している。
  it('iso / basics / review / write は null', () => {
    for (const step of ['iso', 'basics', 'review', 'write'] as const) {
      expect(summarizeStep(step, base()), step).toBeNull()
    }
  })

  it('要約を出すステップは 6 つで、STEP_ORDER に実在する', () => {
    const withSummary = STEP_ORDER.filter((s) => summarizeStep(s, base()) !== null)
    expect(withSummary).toEqual([
      'user',
      'network',
      'storage',
      'software',
      'postinstall',
      'runtime',
    ])
  })
})

describe('summarizeStep — 既定のプロファイル', () => {
  it('要約を出すステップはすべて「既定のまま」と分かる形になる', () => {
    for (const step of [
      'user',
      'network',
      'storage',
      'software',
      'postinstall',
      'runtime',
    ] as const) {
      const s = both(step, base())
      expect(looksTranslated(s.ja), `${step} ja: ${s.ja}`).toBe(true)
      expect(looksTranslated(s.en), `${step} en: ${s.en}`).toBe(true)
      expect(isDefaultText(s), `${step} が既定と判定されない: ${s.ja} / ${s.en}`).toBe(true)
    }
  })

  it('英語の要約に日本語が残らない', () => {
    for (const step of STEP_ORDER) {
      const text = summarizeStep(step, base())
      if (text === null) continue
      expect(/[ぁ-んァ-ヶ一-龠]/.test(formatLocalized('en', text)), step).toBe(false)
    }
  })

  it('既定の中身も一緒に見える（何が既定なのか分からない要約にしない）', () => {
    // 「既定のまま」だけだと、たたんだ先が何になっているのか分からない。
    expect(both('storage', base()).ja).toContain(ja['nav.summaryDiskLargest'])
    expect(both('storage', base()).ja).toContain(ja['nav.summaryEncryptionOff'])
    expect(both('storage', base()).en).toContain(en['nav.summaryDiskLargest'])
    expect(both('network', base()).en).toContain(en['nav.summaryNetworkInstallerDefault'])
  })
})

describe('summarizeStep — 設定を変えたプロファイル', () => {
  it('ネットワーク: 静的 IP はアドレスが出る', () => {
    const s = both(
      'network',
      patch({
        network: {
          mode: 'static',
          target: { kind: 'any' },
          address: '192.168.1.10/24',
          gateway: '192.168.1.1',
          nameservers: [],
          searchDomains: [],
          optional: false,
        },
      }),
    )
    expect(s.ja).toContain('192.168.1.10/24')
    expect(s.en).toContain('192.168.1.10/24')
    expect(isDefaultText(s)).toBe(false)
  })

  it('ネットワーク: netplan の直接指定', () => {
    const s = both('network', patch({ network: { mode: 'raw', yaml: 'x' } }))
    expect(s.ja).toBe(ja['nav.summaryNetworkRaw'])
    expect(s.en).toBe(en['nav.summaryNetworkRaw'])
  })

  it('ディスク: シリアル・そのまま', () => {
    const s = both(
      'storage',
      patch({
        storage: {
          mode: 'direct',
          match: { kind: 'serial', serial: 'ABC123' },
          useWholeDisk: false,
          // ここは以前 `encryptionPassphrase: 'hunter2'` を入れて「暗号化あり」を
          // **要求していた**が、`generate.ts` は lvm でしか `layout.password` を
          // 出さず、`validate.ts` は `encryptionRequiresLvm` を error で出す。
          // つまり要約だけが「暗号化あり」と言う嘘で、テストがその嘘を
          // 固定していた（落とし穴 56）。暗号化は下の lvm のケースで見る。
          encryptionPassphrase: '',
          swap: { mode: 'installer-default', size: '' },
          partitionTable: 'default',
          resetPartition: { enabled: false, size: '' },
        },
      }),
    )
    expect(s.ja).toContain('ABC123')
    expect(s.ja).toContain(ja['nav.summaryLayoutDirect'])
    expect(s.ja).toContain(ja['nav.summaryEncryptionOff'])
    expect(isDefaultText(s)).toBe(false)
  })

  it('ディスク: シリアル・LVM・暗号化あり', () => {
    const s = both(
      'storage',
      patch({
        storage: {
          mode: 'lvm',
          match: { kind: 'serial', serial: 'ABC123' },
          useWholeDisk: false,
          encryptionPassphrase: 'hunter2',
          swap: { mode: 'installer-default', size: '' },
          partitionTable: 'default',
          resetPartition: { enabled: false, size: '' },
        },
      }),
    )
    expect(s.ja).toContain('ABC123')
    expect(s.ja).toContain(ja['nav.summaryLayoutLvm'])
    expect(s.ja).toContain(ja['nav.summaryEncryptionOn'])
    expect(s.en).toContain(en['nav.summaryEncryptionOn'])
    expect(isDefaultText(s)).toBe(false)
  })

  it('ディスク: 「最大のディスク・LVM・暗号化なし」のままでも、他が変われば既定ではない', () => {
    // ここを見落とすと「既定のまま」が嘘になる（要約の文面は既定と同じに見える）。
    const s = both(
      'storage',
      patch({
        storage: { ...base().storage, useWholeDisk: true } as never,
      }),
    )
    expect(isDefaultText(s)).toBe(false)
    expect(s.ja).toContain(ja['nav.summaryWholeDisk'])
  })

  it('ソフトウェア: 件数が出る', () => {
    const s = both(
      'software',
      patch({
        software: { ...base().software, packages: ['nginx', 'jq', 'git'], snaps: [{ name: 'lxd' }] } as never,
      }),
    )
    expect(s.ja).toContain('3')
    expect(s.ja).toContain('1')
    expect(s.en).toContain(en['nav.summaryPackages'].replace('{n}', '3'))
    expect(isDefaultText(s)).toBe(false)
  })

  it('インストール後: 何も無ければ「何もしない」', () => {
    const s = both('postinstall', base())
    expect(s.ja).toContain(ja['nav.summaryPostInstallNone'])
    expect(s.en).toContain(en['nav.summaryPostInstallNone'])
  })

  it('インストール後: 4 枠を超えたら「ほか N 件」でまとめる（1 行に収める）', () => {
    // **`additionalUsers` はここには出ない**（編集できるのは `user` ステップだけ）。
    // 断片は presets / files / deployments / services / commands の 5 つになり、
    // 3 つ + 「ほか 2 件」に畳まれる。件数の内訳は
    // `summary-placement.test.ts`（並び順）が別に固定している。
    const s = both(
      'postinstall',
      patch({
        postInstall: {
          ...base().postInstall,
          presets: ['ssh-harden'],
          files: [{ name: 'a', targetPath: '/a', mode: '0644', owner: 'root', content: '' }],
          additionalUsers: [{}, {}],
          deployments: [{}],
          services: [{}],
          lateCommands: ['true'],
        } as never,
      }),
    )
    expect(s.ja).toContain(ja['nav.summaryMore'].replace('{n}', '2'))
    expect(s.en).toContain(en['nav.summaryMore'].replace('{n}', '2'))
    // 打ち切っても差し込みは残らない（入れ子の深さは 1 で収まっている）
    expect(looksTranslated(s.ja)).toBe(true)
    expect(looksTranslated(s.en)).toBe(true)
  })

  it('実行時に決める: 項目とホスト件数が出る', () => {
    const s = both(
      'runtime',
      patch({
        runtimeValues: {
          hostname: 'kernel-arg',
          network: 'interactive',
          disk: 'fixed',
          presets: [{ id: 'a' }, { id: 'b' }],
          offerInteractiveEntry: true,
        } as never,
      }),
    )
    expect(s.ja).toContain(ja['nav.summaryRuntimeFieldHostname'])
    expect(s.en).toContain(en['nav.summaryRuntimeFieldHostname'])
    // 入れ子（項目名）が英語でも英語のまま出る
    expect(/[ぁ-んァ-ヶ一-龠]/.test(s.en)).toBe(false)
    expect(s.ja).toContain('2')
    expect(isDefaultText(s)).toBe(false)
  })
})

describe('summarizeStep — 手で壊したプロファイル', () => {
  /** 型を無視して何でも入れられる、現実に届きうる壊れ方。 */
  const broken: Record<string, unknown>[] = [
    { network: null },
    { network: [] },
    { network: 'dhcp' },
    { network: { mode: 'NOT-A-REAL-MODE' } },
    { network: { mode: 'static', address: null } },
    { network: { mode: 'static', address: 'x'.repeat(5000) } },
    { storage: null },
    { storage: { mode: 'NOPE' } },
    { storage: { mode: 'lvm', match: null } },
    { storage: { mode: 'lvm', match: { kind: 'NOPE' } } },
    { storage: { mode: 'lvm', match: { kind: 'serial' } } },
    { storage: { mode: 'lvm', match: { kind: 'largest' }, swap: 42, resetPartition: [] } },
    { software: null },
    { software: { packages: 'nginx', snaps: null, gpu: 'yes', kernel: 7 } },
    { apt: null },
    { apt: { sources: {} } },
    { postInstall: null },
    { postInstall: { files: 'x', presets: null, lateCommands: 3 } },
    { activeDirectory: 'yes' },
    { behavior: { reporting: [] } },
    { runtimeValues: null },
    { runtimeValues: { hostname: 'NOPE', network: null, disk: 42, presets: 'x' } },
  ]

  it('例外を投げず、必ず訳せる文字列になる', () => {
    for (const over of broken) {
      const profile = patch(over)
      for (const step of STEP_ORDER) {
        const text = summarizeStep(step, profile)
        if (text === null) continue
        const rendered = { ja: formatLocalized('ja', text), en: formatLocalized('en', text) }
        expect(looksTranslated(rendered.ja), `${JSON.stringify(over)} / ${step}: ${rendered.ja}`).toBe(true)
        expect(looksTranslated(rendered.en), `${JSON.stringify(over)} / ${step}: ${rendered.en}`).toBe(true)
        expect(/[ぁ-んァ-ヶ一-龠]/.test(rendered.en), `${step} の en に日本語`).toBe(false)
      }
    }
  })

  it('プロファイルそのものが壊れていても投げない', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      for (const step of STEP_ORDER) {
        expect(() => summarizeStep(step, bad as never)).not.toThrow()
      }
    }
  })

  it('知らない値は「既定のまま」に落とさず、読み取れないと伝える', () => {
    // 落とし穴 49 / 50。黙って既定に見せると、利用者は消えたことに気づけない。
    const cases: [StepId, Record<string, unknown>, string][] = [
      ['network', { network: { mode: 'NOT-A-REAL-MODE' } }, 'NOT-A-REAL-MODE'],
      ['storage', { storage: { mode: 'NOPE' } }, 'NOPE'],
      ['runtime', { runtimeValues: { hostname: 'NOPE', network: 'fixed', disk: 'fixed' } }, 'NOPE'],
    ]
    for (const [step, over, needle] of cases) {
      const s = both(step, patch(over))
      expect(isDefaultText(s), `${step} が既定扱いになっている: ${s.ja}`).toBe(false)
      expect(s.ja, step).toContain(needle)
      expect(s.en, step).toContain(needle)
    }
  })

  it('配列であるはずの場所が配列でないとき、「追加なし」に落とさない', () => {
    // `packages: 'nginx'` を件数 0 として扱うと「既定のまま（追加なし）」になり、
    // 壊れているのに正常に見える（落とし穴 50）。
    const s = both('software', patch({ software: { ...base().software, packages: 'nginx' } as never }))
    expect(isDefaultText(s), s.ja).toBe(false)
    expect(s.ja).toContain('nginx')

    const p = both('postinstall', patch({ postInstall: { ...base().postInstall, files: 'x' } as never }))
    expect(isDefaultText(p), p.ja).toBe(false)
  })

  it('壊れたディスク指定を「最大のディスク」に落とさない（最も破壊的な失敗）', () => {
    // 落とし穴 22 / 49。`{kind:'serial'}` が `{kind:'largest'}` になると、
    // 複数ディスク機で別のディスクを消す。
    const s = both('storage', patch({ storage: { mode: 'lvm', match: { kind: 'NOPE' } } }))
    expect(s.ja).not.toContain(ja['nav.summaryDiskLargest'])
    expect(s.en).not.toContain(en['nav.summaryDiskLargest'])
  })

  it('長すぎる値はサイドバーの 1 行を壊さない長さに切る', () => {
    const s = both('network', patch({ network: { mode: 'static', address: 'x'.repeat(5000) } }))
    expect(s.ja.length).toBeLessThan(120)
  })

  it('値の中に書かれた差し込み名を展開しない（別の値を引き出せない）', () => {
    const s = both('network', patch({ network: { mode: 'static', address: '{detail}' } }))
    expect(s.ja).toContain('{detail}')
  })
})

describe('summarizeStep — 知らない値を「既定のまま」に落とさない', () => {
  // 判別子 (`mode` / `kind`) には `default:` があったのに、
  // 「片方の値だけを見る」判定（`=== true` / `=== 'ubuntu-server-minimal'`）は
  // **知らない値も型の違う値も黙って既定にしていた**。
  // `oem: 'NOPE'` を書いた JSON を開くと「既定のまま（追加なし）」と出る。
  // 落とし穴 49 / 50。既定に落とすなら、落としたことを必ず伝える。

  /** 「その設定 1 つだけを壊した」プロファイル。既定のセクションに 1 か所だけ重ねる。 */
  const brokenField = (step: StepId, section: string, over: Record<string, unknown>) => {
    const b = base() as unknown as Record<string, unknown>
    return [step, { [section]: { ...(b[section] as object), ...over } }] as const
  }

  const cases: (readonly [StepId, Record<string, unknown>])[] = [
    // software（列挙・真偽値・三値・文字列・入れ子）
    brokenField('software', 'software', { sourceId: 'NOPE' }),
    brokenField('software', 'software', { updates: 'NOPE' }),
    brokenField('software', 'software', { installDrivers: 'yes' }),
    brokenField('software', 'software', { codecs: 'yes' }),
    brokenField('software', 'software', { oem: 'NOPE' }),
    brokenField('software', 'software', { searchDrivers: 'yes' }),
    brokenField('software', 'software', { kernelCrashDumps: 'yes' }),
    brokenField('software', 'software', { ubuntuProToken: {} }),
    brokenField('software', 'software', { gpu: 'yes' }),
    brokenField('software', 'software', { gpu: { enabled: 'yes' } }),
    brokenField('software', 'software', { kernel: 7 }),
    brokenField('software', 'software', { kernel: { mode: 'NOPE' } }),
    // apt（同じ画面が編集する）
    brokenField('software', 'apt', { mode: 'NOPE' }),
    brokenField('software', 'apt', { proxy: {} }),
    brokenField('software', 'apt', { preserveSourcesList: 'yes' }),
    brokenField('software', 'apt', { disableComponents: 'universe' }),
    brokenField('software', 'apt', { fallback: 'NOPE' }),
    brokenField('software', 'apt', { sources: {} }),
    // storage
    brokenField('storage', 'storage', { useWholeDisk: 'yes' }),
    brokenField('storage', 'storage', { encryptionPassphrase: {} }),
    brokenField('storage', 'storage', { partitionTable: 7 }),
    brokenField('storage', 'storage', { partitionTable: 'NOPE' }),
    brokenField('storage', 'storage', { swap: 42 }),
    brokenField('storage', 'storage', { swap: { mode: 'NOPE' } }),
    brokenField('storage', 'storage', { resetPartition: [] }),
    brokenField('storage', 'storage', { resetPartition: { enabled: 'yes' } }),
    // postinstall（`activeDirectory` / `behavior` / `advanced` を含む）
    brokenField('postinstall', 'postInstall', { aptFullUpgrade: 'yes' }),
    brokenField('postinstall', 'postInstall', { collectLogsOnError: 'no' }),
    brokenField('postinstall', 'postInstall', { debconfSelections: [] }),
    ['postinstall', { activeDirectory: 'yes' }] as const,
    brokenField('postinstall', 'activeDirectory', { enabled: 'yes' }),
    brokenField('postinstall', 'behavior', { refreshInstaller: 'yes' }),
    brokenField('postinstall', 'behavior', { interactiveAll: 'yes' }),
    brokenField('postinstall', 'behavior', { reporting: [] }),
    brokenField('postinstall', 'behavior', { reporting: { kind: 'NOPE' } }),
    brokenField('postinstall', 'advanced', { rawOverlayYaml: {} }),
    // 数は文字列として読む（`textOf` の方針）ので、ここでは配列を渡す
    brokenField('postinstall', 'advanced', { extraKernelArgs: [] }),
  ]

  it('壊した設定 1 つごとに「読み取れない」と出る（既定のままにしない）', () => {
    const unknownJa = ja['nav.summaryUnknown'].replace('{value}', '')
    const unknownEn = en['nav.summaryUnknown'].replace('{value}', '')
    for (const [step, over] of cases) {
      const s = both(step, patch(over))
      const what = `${step}: ${JSON.stringify(over).slice(0, 90)} → ${s.ja}`
      expect(isDefaultText(s), `既定のままと表示された ${what}`).toBe(false)
      expect(s.ja.includes(unknownJa.slice(0, 6)), what).toBe(true)
      expect(s.en.includes(unknownEn.slice(0, 6)), what).toBe(true)
      expect(looksTranslated(s.ja), what).toBe(true)
      expect(looksTranslated(s.en), what).toBe(true)
    }
  })

  it('正しい値は「読み取れない」にしない（逆向きの嘘を作らない）', () => {
    // 既知の値を「知らない値」と言い出したら、それはそれで使えない要約になる。
    const ok: (readonly [StepId, Record<string, unknown>])[] = [
      brokenField('software', 'software', { sourceId: 'ubuntu-server-minimal' }),
      brokenField('software', 'software', { updates: 'all', installDrivers: true, codecs: true }),
      brokenField('software', 'software', { oem: 'yes', searchDrivers: false }),
      brokenField('software', 'apt', { fallback: 'continue-anyway', mode: 'country-mirror' }),
      brokenField('storage', 'storage', { partitionTable: 'msdos', useWholeDisk: true }),
      brokenField('storage', 'storage', { swap: { mode: 'none', size: '' } }),
      brokenField('postinstall', 'behavior', { reporting: { kind: 'none' } }),
      brokenField('postinstall', 'postInstall', { collectLogsOnError: false }),
    ]
    const unknownJa = ja['nav.summaryUnknown'].replace('{value}', '')
    for (const [step, over] of ok) {
      const s = both(step, patch(over))
      expect(s.ja.includes(unknownJa.slice(0, 6)), `${step}: ${s.ja}`).toBe(false)
      expect(isDefaultText(s), `${step}: ${s.ja}`).toBe(false)
    }
  })

  it('既定の値そのものは何も言わない（キーが無い場合も既定として読む）', () => {
    // `undefined` は「設定していない」で、生成側も既定を出す。これは嘘にならない。
    const s = both('software', patch({ software: {}, apt: {} }))
    expect(isDefaultText(s), s.ja).toBe(true)
  })
})

describe('summarizeStep — 知らないプリセット ID', () => {
  // `findPreset` が読み飛ばすので、知らない ID は YAML に 1 バイトも出ない。
  // 「よくある設定 1 件」と数えると、効いていない設定を効いていると言うことになる。
  it('数に入れず、読み取れないものとして出す', () => {
    const s = both(
      'postinstall',
      patch({ postInstall: { ...base().postInstall, presets: ['NOT-A-PRESET'] } as never }),
    )
    expect(s.ja).not.toContain(ja['nav.summaryPresets'].replace('{n}', '1'))
    expect(s.en).not.toContain(en['nav.summaryPresets'].replace('{n}', '1'))
    expect(s.ja).toContain('NOT-A-PRESET')
    expect(isDefaultText(s), s.ja).toBe(false)
  })

  it('知っている ID だけを数える', () => {
    const s = both(
      'postinstall',
      patch({
        postInstall: { ...base().postInstall, presets: ['ssh-harden', 'NOT-A-PRESET'] } as never,
      }),
    )
    expect(s.ja).toContain(ja['nav.summaryPresets'].replace('{n}', '1'))
    expect(s.en).toContain(en['nav.summaryPresets'].replace('{n}', '1'))
    expect(s.ja).toContain('NOT-A-PRESET')
  })

  it('知っている ID だけなら、そのまま件数になる', () => {
    const s = both(
      'postinstall',
      patch({
        postInstall: { ...base().postInstall, presets: ['ssh-harden', 'docker-ce'] } as never,
      }),
    )
    expect(s.ja).toContain(ja['nav.summaryPresets'].replace('{n}', '2'))
    expect(s.ja).not.toContain(ja['nav.summaryUnknown'].replace('{value}', '').slice(0, 6))
  })
})

describe('件数の助数詞', () => {
  it('日本語の {n} は必ず「件」で数える（1 行に並ぶので揃っていないと不揃いに見える）', () => {
    // 「パッケージ 3 個・追加リポジトリ 2 件・ファイル 1」が 1 行に並んでいた。
    // 日本語に単複は無いので、1 と 2 で表現を変えることもしない。
    const counters = (Object.keys(ja) as MsgKey[]).filter(
      (k) => k.startsWith('nav.') && ja[k].includes('{n}'),
    )
    const offenders = counters.filter((k) => !(ja[k].split('{n}')[1] ?? '').startsWith(' 件'))
    expect(offenders).toEqual([])
    // 数え忘れ防止（キーを消して「揃った」ことにしない）。
    // 増やしたときはここも増やし、その助数詞も「件」に揃える。
    expect(counters.length, `件数キーが増減した: ${counters.join(', ')}`).toBe(15)
  })
})

describe('summarizeStep が使う辞書のキー', () => {
  it('nav.* のキーがすべて ja / en の両方に実在する', () => {
    // 綴りを間違えると画面に `nav.summaryFoo` が出る。型（MsgKey）でも弾けるが、
    // 辞書からキーを消した側は気づけない。
    const missing = (Object.keys(ja) as MsgKey[])
      .filter((k) => k.startsWith('nav.'))
      .filter((k) => en[k] === undefined)
    expect(missing).toEqual([])
    expect((Object.keys(ja) as MsgKey[]).filter((k) => k.startsWith('nav.')).length).toBeGreaterThan(50)
  })
})
