import { describe, expect, it } from 'vitest'
import {
  createDefaultProfile,
  formatLocalized,
  ja,
  en,
  type AutoinstallProfile,
  type MsgKey,
} from '@autoinstall/shared'
import { IMPACT_RANK, summarizeStep } from './summary.js'
import { STEP_ORDER, type StepId } from '../store.js'

// ---------------------------------------------------------------------------
// **要約の「置き場」と「並び順」。**
//
// 7 巡目の監査で出た 4 件。どれも「要約はあるのに、要る人のところに無い」形。
//
//   (A) `user` ステップだけ要約が `null` だった。折りたたみ（管理ユーザーの
//       追加グループ）を持つのに、たたんだ中身を出す仕掛けがこの画面にだけ
//       効いていなかった
//   (B) 「追加ユーザー N 件」が、**編集できない** `postinstall` の要約に出ていた。
//       編集できるのは `user` ステップだけ（`AdditionalUsersSection`）
//   (C) 並び順がコードに書いた順だったので、`join()` の 4 枠打ち切りで
//       **影響の大きい設定から先に**「ほか N 件」へ消えていた。
//       消えていたのは `interactiveAll`（＝無人インストールでなくなる）と
//       `rawOverlayYaml`（＝任意のセクションを上書きできる）
//   (D) 「DHCP（NIC を指定）」が `network.target` を**読まずに**断定していた。
//       既定は `{kind:'any'}`（すべての NIC）なので、指定していないのに
//       「指定した」と出ていた
//
// 文面は固定しない（落とし穴 56）。固定するのは
// 「出る / 出ない」「どちらが先か」だけ。
// ---------------------------------------------------------------------------

const base = (series: Parameters<typeof createDefaultProfile>[0] = '24.04'): AutoinstallProfile =>
  createDefaultProfile(series)

const both = (step: StepId, profile: AutoinstallProfile): { ja: string; en: string } => {
  const text = summarizeStep(step, profile)
  if (text === null) throw new Error(`${step} の要約が null`)
  return { ja: formatLocalized('ja', text), en: formatLocalized('en', text) }
}

/** 差し込み忘れ（`{name}` が残る）と、辞書に無いキー（`nav.` がそのまま出る）を弾く。 */
const looksTranslated = (s: string): boolean =>
  s.length > 0 && !/\{[A-Za-z]/.test(s) && !s.includes('nav.summary')

const isDefaultText = (s: { ja: string; en: string }): boolean =>
  s.ja.startsWith(ja['nav.summaryDefault'].split('{detail}')[0]!) &&
  s.en.startsWith(en['nav.summaryDefault'].split('{detail}')[0]!)

const UNKNOWN_HEAD = {
  ja: ja['nav.summaryUnknown'].split('{value}')[0]!,
  en: en['nav.summaryUnknown'].split('{value}')[0]!,
}

// ---------------------------------------------------------------------------
// (A) `user` ステップ
// ---------------------------------------------------------------------------

describe('summarizeStep("user") — 折りたたみを持つステップに要約が無かった', () => {
  it('要約を出さないのは iso / basics / review / write の 4 つだけ', () => {
    // **`user` はここに入らない。** 入れ直したら、この巡の修正が消えている。
    for (const step of ['iso', 'basics', 'review', 'write'] as const) {
      expect(summarizeStep(step, base()), step).toBeNull()
    }
    const withSummary = STEP_ORDER.filter((s) => summarizeStep(s, base()) !== null)
    expect(withSummary).toEqual(['user', 'network', 'storage', 'software', 'postinstall', 'runtime'])
  })

  it('既定のプロファイルは「既定のまま」と分かり、中身（誰で入るか）も見える', () => {
    const s = both('user', base())
    expect(isDefaultText(s), s.ja).toBe(true)
    expect(s.ja).toContain(base().user.username)
    expect(s.en).toContain(base().user.username)
    expect(looksTranslated(s.ja), s.ja).toBe(true)
    expect(looksTranslated(s.en), s.en).toBe(true)
    expect(/[ぁ-んァ-ヶ一-龠]/.test(s.en), s.en).toBe(false)
  })

  it('折りたたみの中身（追加グループ）が要約に出る＝これがこのステップの主目的', () => {
    // 26.04 でしか出力されない設定なので、26.04 で見る（22.04 は下のケース）。
    const p = base('26.04')
    const s = both('user', {
      ...p,
      user: { ...p.user, groups: { mode: 'override', groups: ['sudo', 'docker'] } },
    })
    expect(isDefaultText(s), s.ja).toBe(false)
    expect(s.ja).toContain(ja['nav.summaryGroupsOverride'])
    expect(s.en).toContain(en['nav.summaryGroupsOverride'])
  })

  it('append と override を書き分ける（override は sudo を落とせる）', () => {
    const p = base('26.04')
    const s = both('user', { ...p, user: { ...p.user, groups: { mode: 'append', groups: ['docker'] } } })
    expect(s.ja).toContain(ja['nav.summaryGroupsAppend'])
    expect(s.ja).not.toContain(ja['nav.summaryGroupsOverride'])
  })

  it('そのリリースで出力されない追加グループは「効かない設定」として言う（黙って消さない）', () => {
    // 落とし穴 50。22.04 の `generate.ts` は `identity.groups` をキーごと出さない。
    const p = base('22.04')
    const s = both('user', {
      ...p,
      user: { ...p.user, groups: { mode: 'override', groups: ['sudo'] } },
    })
    expect(s.ja).not.toContain(ja['nav.summaryGroupsOverride'])
    expect(s.ja).toContain(ja['nav.summaryIneffective'].replace('{n}', '1'))
    expect(s.en).toContain(en['nav.summaryIneffective'].replace('{n}', '1'))
  })

  it('SSH の有無とパスワード認証の可否が出る', () => {
    const p = base()
    const off = both('user', { ...p, ssh: { ...p.ssh, installServer: false } })
    expect(off.ja).toContain(ja['nav.summarySshOff'])
    expect(isDefaultText(off), off.ja).toBe(false)

    const keyOnly = both('user', { ...p, ssh: { ...p.ssh, allowPasswordAuth: false } })
    expect(keyOnly.ja).toContain(ja['nav.summarySshKeyOnly'])
    expect(keyOnly.en).toContain(en['nav.summarySshKeyOnly'])
  })

  it('公開鍵の件数は出すが、鍵そのものは出さない', () => {
    const p = base()
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA user@example'
    const s = both('user', { ...p, ssh: { ...p.ssh, authorizedKeys: [key] } })
    expect(s.ja).toContain(ja['nav.summarySshKeys'].replace('{n}', '1'))
    expect(s.ja).not.toContain('AAAAC3')
    expect(s.en).not.toContain('AAAAC3')
  })

  it('パスワードは平文もハッシュも出さない（規約）', () => {
    const p = base()
    const hash = '$6$rounds=5000$abcdefgh$0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTU'
    const s = both('user', { ...p, user: { ...p.user, passwordHash: hash } })
    for (const rendered of [s.ja, s.en]) {
      expect(rendered).not.toContain('$6$')
      expect(rendered).not.toContain('abcdefgh')
    }
  })

  it('sudo のパスワード不要は出す（危険な設定なので、たたんだままにしない）', () => {
    const p = base()
    const s = both('user', { ...p, user: { ...p.user, sudoNoPassword: true } })
    expect(s.ja).toContain(ja['nav.summarySudoNoPassword'])
    expect(isDefaultText(s), s.ja).toBe(false)
  })

  it('手で壊しても例外を投げず、既定のままとも言わない', () => {
    const broken: Record<string, unknown>[] = [
      { user: null },
      { user: 'ubuntu' },
      { user: { username: {} } },
      { user: { username: 'x', groups: 'sudo' } },
      { user: { username: 'x', groups: { mode: 'NOPE' } } },
      { user: { username: 'x', sudoNoPassword: 'yes' } },
      { ssh: 'yes' },
      { ssh: { installServer: 'yes' } },
      { ssh: { authorizedKeys: 'ssh-ed25519 AAAA' } },
      { postInstall: { additionalUsers: 'x' } },
    ]
    for (const over of broken) {
      const profile = { ...base(), ...over } as unknown as AutoinstallProfile
      const text = summarizeStep('user', profile)
      expect(text, JSON.stringify(over)).not.toBeNull()
      const s = { ja: formatLocalized('ja', text!), en: formatLocalized('en', text!) }
      expect(looksTranslated(s.ja), `${JSON.stringify(over)}: ${s.ja}`).toBe(true)
      expect(looksTranslated(s.en), `${JSON.stringify(over)}: ${s.en}`).toBe(true)
      expect(/[ぁ-んァ-ヶ一-龠]/.test(s.en), `en に日本語: ${s.en}`).toBe(false)
      if (over['user'] === null || typeof over['user'] === 'string') continue
      expect(s.ja.includes(UNKNOWN_HEAD.ja), `読み取れないと言っていない: ${s.ja}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// (B) 置き場所ではなく「編集できる画面」に出す
// ---------------------------------------------------------------------------

describe('追加ユーザーの件数は、編集できる画面の要約に出す', () => {
  const withUsers = (): AutoinstallProfile => {
    const p = base()
    return {
      ...p,
      postInstall: {
        ...p.postInstall,
        additionalUsers: [
          { username: 'deploy' },
          { username: 'ops' },
        ] as unknown as AutoinstallProfile['postInstall']['additionalUsers'],
      },
    }
  }

  it('user の要約に件数が出る', () => {
    const s = both('user', withUsers())
    expect(s.ja).toContain(ja['nav.summaryUsers'].replace('{n}', '2'))
    expect(s.en).toContain(en['nav.summaryUsers'].replace('{n}', '2'))
  })

  it('postinstall の要約には出ない（その画面では触れないので、探しても見つからない）', () => {
    const s = both('postinstall', withUsers())
    expect(s.ja).not.toContain(ja['nav.summaryUsers'].replace('{n}', '2'))
    expect(s.en).not.toContain(en['nav.summaryUsers'].replace('{n}', '2'))
    // 追加ユーザーだけを足したプロファイルは、postinstall では「既定のまま」でよい。
    expect(isDefaultText(s), s.ja).toBe(true)
  })

  it('壊れた配列は、移した先（user）で「読み取れない」と出る（報告ごと落とさない）', () => {
    const p = base()
    const profile = {
      ...p,
      postInstall: { ...p.postInstall, additionalUsers: 'deploy' },
    } as unknown as AutoinstallProfile
    const s = both('user', profile)
    expect(s.ja).toContain(UNKNOWN_HEAD.ja)
    expect(s.en).toContain(UNKNOWN_HEAD.en)
  })
})

// ---------------------------------------------------------------------------
// (C) 並び順
// ---------------------------------------------------------------------------

/** 影響の大きい設定と件数ものを同時に立てたプロファイル。 */
function crowdedPostInstall(): AutoinstallProfile {
  const p = base()
  return {
    ...p,
    postInstall: {
      ...p.postInstall,
      presets: ['ssh-harden'],
      files: [{ name: 'a', targetPath: '/a', mode: '0644', owner: 'root', content: '' }],
      deployments: [{}],
      services: [{}],
      lateCommands: ['true'],
      aptFullUpgrade: true,
    } as unknown as AutoinstallProfile['postInstall'],
    behavior: { ...p.behavior, interactiveAll: true },
    advanced: { ...p.advanced, rawOverlayYaml: 'storage:\n  layout:\n    name: direct\n' },
  }
}

describe('要約の並び順は「影響の大きい順」', () => {
  it('無人インストールでなくなる設定が、件数ものより先に出る', () => {
    const s = both('postinstall', crowdedPostInstall())
    const interactive = s.ja.indexOf(ja['nav.summaryInteractiveAll'])
    const presets = s.ja.indexOf(ja['nav.summaryPresets'].replace('{n}', '1'))
    expect(interactive, `無人性を壊す設定が出ていない: ${s.ja}`).toBeGreaterThanOrEqual(0)
    expect(interactive).toBeLessThan(presets === -1 ? Number.MAX_SAFE_INTEGER : presets)
  })

  it('打ち切り（ほか N 件）に消えるのは件数もののほう', () => {
    const s = both('postinstall', crowdedPostInstall())
    expect(s.ja).toContain(ja['nav.summaryMore'].replace('{n}', '5'))
    // 影響の大きい 2 つは残る
    expect(s.ja).toContain(ja['nav.summaryInteractiveAll'])
    expect(s.ja).toContain(ja['nav.summaryRawOverlay'])
    expect(s.en).toContain(en['nav.summaryInteractiveAll'])
    expect(s.en).toContain(en['nav.summaryRawOverlay'])
    // 件数ものは消えてよい（消えても「何かある」ことは他の断片から分かる）
    expect(s.ja).not.toContain(ja['nav.summaryServices'].replace('{n}', '1'))
    expect(looksTranslated(s.ja), s.ja).toBe(true)
    expect(looksTranslated(s.en), s.en).toBe(true)
  })

  it('software も同じ（出力を丸ごと変える設定が、パッケージ件数より先）', () => {
    const p = base()
    const s = both('software', {
      ...p,
      software: {
        ...p.software,
        packages: ['nginx', 'jq'],
        snaps: [{ name: 'lxd' }],
        sourceId: 'ubuntu-server-minimal',
        kernel: { mode: 'flavor', value: 'hwe' },
        installDrivers: true,
      } as unknown as AutoinstallProfile['software'],
    })
    const minimal = s.ja.indexOf(ja['nav.summarySourceMinimal'])
    const packages = s.ja.indexOf(ja['nav.summaryPackages'].replace('{n}', '2'))
    expect(minimal).toBeGreaterThanOrEqual(0)
    expect(minimal).toBeLessThan(packages === -1 ? Number.MAX_SAFE_INTEGER : packages)
  })

  it('storage は「どのディスクを消すか」が先頭のまま（落とし穴 65）', () => {
    const p = base()
    const s = both('storage', {
      ...p,
      storage: {
        ...p.storage,
        match: { kind: 'serial', serial: 'ABC123' },
        useWholeDisk: true,
        partitionTable: 'gpt',
        swap: { mode: 'none', size: '' },
      } as unknown as AutoinstallProfile['storage'],
    })
    // 断片は 6 つあるので 3 つに畳まれる。**残るのは芯の 3 つ**
    //（どのディスクを・どう構成し・暗号化するか）で、後から足した設定が消える。
    expect(s.ja.indexOf('ABC123')).toBeGreaterThanOrEqual(0)
    expect(s.ja).toContain(ja['nav.summaryLayoutLvm'])
    expect(s.ja).toContain(ja['nav.summaryEncryptionOff'])
    expect(s.ja).toContain(ja['nav.summaryMore'].replace('{n}', '3'))
    expect(s.ja).not.toContain(ja['nav.summarySwapCustom'])
  })

  it('実行時に決める: 「インストーラで入力」が「起動メニューで選ぶ」より先', () => {
    const p = base()
    const s = both('runtime', {
      ...p,
      runtimeValues: { ...p.runtimeValues, hostname: 'kernel-arg', network: 'interactive' },
    })
    const interactive = s.ja.indexOf(ja['nav.summaryRuntimeFieldNetwork'])
    const kernelArg = s.ja.indexOf(ja['nav.summaryRuntimeFieldHostname'])
    expect(interactive).toBeGreaterThanOrEqual(0)
    expect(interactive).toBeLessThan(kernelArg)
  })
})

// ---------------------------------------------------------------------------
// 順位表の番人（設定を足したときに「順位を書き忘れる」と、そこだけ黙って消える）
// ---------------------------------------------------------------------------

/**
 * `nav.summary*` のうち、**断片ではない**キー。
 * 断片＝ 1 行の中に並ぶ要素。ここに挙げるのはその入れ物・但し書き・
 * 要約そのものになるキーで、順位を持たない。**理由を必ず書く。**
 */
const NOT_A_FRAGMENT: { key: MsgKey; why: string }[] = [
  { key: 'nav.summaryDefault', why: '要約全体の包み' },
  { key: 'nav.summaryUnknown', why: '但し書き（常に先頭）' },
  { key: 'nav.summaryIneffective', why: '但し書き（常に先頭）' },
  { key: 'nav.summaryJoin2', why: '断片をつなぐ入れ物' },
  { key: 'nav.summaryJoin3', why: '断片をつなぐ入れ物' },
  { key: 'nav.summaryJoin4', why: '断片をつなぐ入れ物' },
  { key: 'nav.summaryMore', why: '打ち切りの表示' },
  { key: 'nav.summaryUserNameMissing', why: '断片だが順位表にある（下で確認する）' },
  { key: 'nav.summaryNetworkInstallerDefault', why: 'network は要約が 1 つの断片で完結する' },
  { key: 'nav.summaryNetworkDhcp', why: '同上' },
  { key: 'nav.summaryNetworkStatic', why: '同上' },
  { key: 'nav.summaryNetworkRaw', why: '同上' },
  { key: 'nav.summaryTargetAny', why: 'DHCP の中に入れ子で差し込む値' },
  { key: 'nav.summaryTargetName', why: '同上' },
  { key: 'nav.summaryTargetMac', why: '同上' },
  { key: 'nav.summaryStorageRaw', why: 'curtin 直接指定は要約そのもの / 空のときの受け皿' },
  { key: 'nav.summarySoftwareNone', why: '断片が 0 件のときの受け皿' },
  { key: 'nav.summaryPostInstallNone', why: '同上' },
  { key: 'nav.summaryRuntimeFixed', why: '同上' },
  { key: 'nav.summaryRuntimeFieldHostname', why: '断片の中に入れ子で差し込む項目名' },
  { key: 'nav.summaryRuntimeFieldNetwork', why: '同上' },
  { key: 'nav.summaryRuntimeFieldDisk', why: '同上' },
]

/**
 * `summary.ts` を raw で読む。`node:fs` を使わないのは、renderer の tsconfig に
 * Node の型を入れないという規約（CLAUDE.md）を、テストでも破らないため
 * （`i18n.test.ts` と同じ手）。
 */
const SUMMARY_SOURCE = (
  import.meta.glob('./summary.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as unknown as Record<string, string>
)['./summary.ts'] as string

describe('影響の順位表 (IMPACT_RANK)', () => {
  it('走査対象を実際に読めている（空だと何も検証しない）', () => {
    expect(SUMMARY_SOURCE.length).toBeGreaterThan(1000)
    expect(SUMMARY_SOURCE).toContain('IMPACT_RANK')
  })

  it('summary.ts が使う断片のキーは、すべて順位表にある', () => {
    // 順位を書き忘れた断片は先頭に出る（黙って消えるよりまし）が、
    // 「先頭に出すのが正しい」わけではない。ここで必ず気づけるようにする。
    const used = new Set(
      [...SUMMARY_SOURCE.matchAll(/'(nav\.summary[A-Za-z0-9]+)'/g)].map((m) => m[1] as MsgKey),
    )
    const excluded = new Set(NOT_A_FRAGMENT.map((e) => e.key))
    const missing = [...used].filter((k) => !excluded.has(k) && IMPACT_RANK[k] === undefined)
    expect(missing, `順位が決まっていない断片: ${missing.join(', ')}`).toEqual([])
  })

  it('順位表に、もう使われていないキーが残っていない', () => {
    const dead = (Object.keys(IMPACT_RANK) as MsgKey[]).filter(
      (k) => !SUMMARY_SOURCE.includes(`'${k}'`),
    )
    expect(dead, `使われていない順位: ${dead.join(', ')}`).toEqual([])
  })

  it('例外表に死んだ項目が残っていない（例外表が逃げ道にならないように）', () => {
    const dead = NOT_A_FRAGMENT.filter((e) => !SUMMARY_SOURCE.includes(`'${e.key}'`))
    expect(dead.map((e) => e.key)).toEqual([])
  })

  it('順位表のキーは ja / en の両方に実在する', () => {
    const missing = (Object.keys(IMPACT_RANK) as MsgKey[]).filter(
      (k) => ja[k] === undefined || en[k] === undefined,
    )
    expect(missing).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (D) DHCP の対象 NIC
// ---------------------------------------------------------------------------

describe('summarizeStep("network") — 読まずに断定しない', () => {
  const withTarget = (target: unknown): AutoinstallProfile =>
    ({ ...base(), network: { mode: 'dhcp', target, optional: true } }) as unknown as AutoinstallProfile

  it('既定（すべての NIC）を「指定した」と言わない', () => {
    const s = both('network', withTarget({ kind: 'any' }))
    expect(s.ja).toContain(ja['nav.summaryTargetAny'])
    expect(s.en).toContain(en['nav.summaryTargetAny'])
    expect(looksTranslated(s.ja), s.ja).toBe(true)
    expect(/[ぁ-んァ-ヶ一-龠]/.test(s.en), s.en).toBe(false)
  })

  it('名前で指定したときは、その名前が出る', () => {
    const s = both('network', withTarget({ kind: 'name', name: 'eno1' }))
    expect(s.ja).toContain('eno1')
    expect(s.en).toContain('eno1')
    expect(s.ja).not.toContain(ja['nav.summaryTargetAny'])
  })

  it('MAC で指定したときは、その MAC が出る', () => {
    const s = both('network', withTarget({ kind: 'mac', macaddress: '52:54:00:12:34:56' }))
    expect(s.ja).toContain('52:54:00:12:34:56')
    expect(s.en).toContain('52:54:00:12:34:56')
  })

  it('知らない指定を「すべての NIC」に落とさない（落とし穴 49 / 50）', () => {
    for (const target of [{ kind: 'NOPE' }, null, 'eno1', [], { kind: 'name' }]) {
      const s = both('network', withTarget(target))
      if (typeof target === 'object' && target !== null && 'kind' in target && target.kind === 'name') {
        // 名前が空でも「指定した」ことは事実。`?` で欠けていることを見せる。
        expect(s.ja).toContain('?')
        continue
      }
      expect(s.ja, JSON.stringify(target)).toContain(UNKNOWN_HEAD.ja)
      expect(s.en, JSON.stringify(target)).toContain(UNKNOWN_HEAD.en)
      expect(s.ja).not.toContain(ja['nav.summaryTargetAny'])
    }
  })

  it('長すぎる値でもサイドバーの 1 行を壊さない', () => {
    const s = both('network', withTarget({ kind: 'name', name: 'x'.repeat(5000) }))
    expect(s.ja.length).toBeLessThan(120)
  })
})
