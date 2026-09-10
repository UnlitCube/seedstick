import { describe, expect, it } from 'vitest'
import {
  AUTOINSTALL_YAML_VERSION,
  createAutoinstallDocument,
  parseAutoinstallYaml,
  yamlDialectDiffs as dialectDiffs,
} from './yaml.js'
import { createDefaultProfile } from './defaults.js'
import { generateUserData } from './generate.js'
import { createBondMember, createDefaultBondNetwork } from './bond.js'
import { UBUNTU_SERIES, type AutoinstallProfile } from './model.js'

// **この設定を読むのは PyYAML と libyaml、つまり YAML 1.1。**
// `yaml` パッケージの既定 1.2 で出すと、1.1 でだけ別の型になる値が素のまま出る。
// 実際に `match: {macaddress: 52:54:00:12:34:56}` が 60 進数 41135085296 と読まれ、
// `netplan apply` が exit 1 でインストールが止まった（落とし穴 108）。

describe('YAML の方言（消費者は PyYAML / libyaml = 1.1）', () => {
  it('1.1 を使う', () => {
    expect(AUTOINSTALL_YAML_VERSION).toBe('1.1')
  })

  it('1.1 でだけ別の型になる値をクォートする', () => {
    const out = String(
      createAutoinstallDocument({
        mac: '52:54:00:12:34:56',
        yes: 'yes',
        no: 'no',
        on: 'on',
        off: 'off',
        time: '1:30',
        oct: '0123',
      }),
    )
    // 60 進数（MAC）と 1.1 の真偽値は必ずクォートされる。
    expect(out).toContain('"52:54:00:12:34:56"')
    for (const v of ['yes', 'no', 'on', 'off']) expect(out).toContain(`"${v}"`)
    expect(out).toContain('"1:30"')
    expect(dialectDiffs(out)).toEqual([])
  })

  it('60 進数になりえない MAC は過剰にクォートしない', () => {
    // hex の英字が入ると 1.1 でも文字列なので、素のまま出るのが正しい。
    const out = String(createAutoinstallDocument({ mac: '52:54:00:ab:34:56' }))
    expect(out.trim()).toBe('mac: 52:54:00:ab:34:56')
  })

  it('`%YAML` のディレクティブ行を出さない（#cloud-config の直後に挟まると困る）', () => {
    expect(String(createAutoinstallDocument({ a: 1 }))).not.toContain('%YAML')
  })

  it('読むときも 1.1（生の YAML の `dhcp4: yes` を真偽値として読む）', () => {
    const js = parseAutoinstallYaml('dhcp4: yes\nmtu: 0123\n').toJS() as Record<string, unknown>
    expect(js['dhcp4']).toBe(true)
    // 1.1 の八進数。subiquity（PyYAML）もこう読む。
    expect(js['mtu']).toBe(0o123)
  })

  const macTarget: AutoinstallProfile = {
    ...createDefaultProfile('24.04'),
    network: {
      mode: 'dhcp',
      target: { kind: 'mac', macaddress: '52:54:00:12:34:56' },
      optional: false,
    },
  }
  const macBond: AutoinstallProfile = {
    ...createDefaultProfile('24.04'),
    network: {
      ...createDefaultBondNetwork(),
      members: [
        createBondMember('m1', { kind: 'mac', macaddress: '52:54:00:12:34:56' }),
        createBondMember('m2', { kind: 'mac', macaddress: '52:54:00:12:34:57' }),
      ],
    },
  }

  it.each([
    ['単一 NIC を MAC で選ぶ', macTarget],
    ['bond のメンバーを MAC で選ぶ', macBond],
  ])('%s: 生成物が両方の方言で同じ意味になる', (_label, profile) => {
    expect(dialectDiffs(generateUserData(profile, { comments: 'ja' }))).toEqual([])
  })

  // **MAC 以外にも 1.1 の地雷はある。** `no` は Linux の正当なユーザー名だが、
  // 1.1 では真偽値 false になる（1.2 では文字列）。列挙して塞ぐのではなく、
  // 自由入力の欄に地雷を詰めたプロファイルを 1 本通して、方言差が出ないことを見る。
  const mined: AutoinstallProfile = {
    ...createDefaultProfile('24.04'),
    basics: { ...createDefaultProfile('24.04').basics, hostname: 'off', timezone: 'Etc/GMT+0' },
    user: { ...createDefaultProfile('24.04').user, username: 'no', realname: 'yes' },
    software: {
      ...createDefaultProfile('24.04').software,
      packages: ['no', 'yes', 'on', 'off', 'y', 'n'],
    },
  }

  it('自由入力に 1.1 の地雷（no / yes / on / off）が入っても方言差が出ない', () => {
    const yaml = generateUserData(mined, { comments: 'ja' })
    expect(dialectDiffs(yaml)).toEqual([])
    // 消費者と同じ 1.1 で読み直しても、文字列のまま届く。
    const js = parseAutoinstallYaml(yaml).toJS() as { autoinstall: Record<string, unknown> }
    const ai = js.autoinstall
    const identity = ai['identity'] as Record<string, unknown>
    expect(identity['username']).toBe('no')
    expect(identity['realname']).toBe('yes')
    expect(identity['hostname']).toBe('off')
    // 生成側が並べ替える（重複も落とす）ので、集合として見る。
    expect([...(ai['packages'] as unknown as string[])].sort()).toEqual(
      ['n', 'no', 'off', 'on', 'y', 'yes'],
    )
  })

  // **`yaml` パッケージの 1.1 は PyYAML の 1.1 と同じではない。**
  //
  // 下の表は **PyYAML 6.0.1 に実際に読ませた結果**（`yaml.safe_load`）。
  // 番人が「1.1 で読む」と言うだけでは、消費者を一度も通していないことになる
  // ——ここが食い違うと、こちらだけが正しいつもりでいる（落とし穴 109 の親戚）。
  //
  // 期待するのは「**出す側は PyYAML が誤読する値をすべて覆う**」
  // （＝ `yaml` がクォートする集合 ⊇ PyYAML が誤読する集合）と、
  // 「**読む側は PyYAML が文字列にする値を数にしない**」の 2 つ。
  const PYYAML: ReadonlyArray<readonly [string, 'int' | 'str' | 'bool']> = [
    ['52:54:00:12:34:56', 'int'],
    ['10:20:30:40:50:59', 'int'],
    ['59:59:59:59:59:59', 'int'],
    ['1:30', 'int'],
    // **先頭グループが 0 始まりだと PyYAML は 60 進数にしない**（`[1-9]` 始まりのみ）。
    ['00:50:56:12:34:56', 'str'],
    ['08:00:27:12:34:56', 'str'],
    ['01:02:03:04:05:06', 'str'],
    ['00:00:00:00:00:00', 'str'],
    ['0:1:2', 'str'],
    ['52:54:00:ab:34:56', 'str'],
    ['802.3ad', 'str'],
    ['0123', 'int'],
    ['0x1f', 'int'],
    ['0b101', 'int'],
    // **PyYAML の浮動小数は「小数点」と「符号つき指数」の両方を要求する。**
    // だから指数形式はほとんど文字列のまま（`yaml` は全部数にする）。
    ['1e5', 'str'],
    ['1E5', 'str'],
    ['1e+5', 'str'],
    ['1.5e3', 'str'],
    ['yes', 'bool'],
    ['no', 'bool'],
    ['on', 'bool'],
    ['off', 'bool'],
    // `y` / `n` は PyYAML では**文字列**。`yaml` は真偽値にする（残した食い違い）。
    ['y', 'str'],
    ['n', 'str'],
  ]

  const kindOf = (v: unknown): string =>
    typeof v === 'number' ? 'int' : typeof v === 'boolean' ? 'bool' : typeof v

  it('読む側: PyYAML が文字列にする値を、こちらが数にしない', () => {
    const wrong: string[] = []
    for (const [raw, py] of PYYAML) {
      if (py !== 'str') continue
      const v = (parseAutoinstallYaml(`k: ${raw}`).toJS() as Record<string, unknown>)['k']
      // `y` / `n` は残した食い違い（`yaml.ts` に理由を書いてある）。
      if (raw === 'y' || raw === 'n') continue
      if (kindOf(v) === 'int') wrong.push(`${raw} -> ${String(v)}`)
    }
    expect(wrong).toEqual([])
  })

  it('出す側: PyYAML が誤読する値をすべてクォートで覆う', () => {
    const uncovered: string[] = []
    for (const [raw, py] of PYYAML) {
      if (py === 'str') continue
      // 文字列として渡したものが、出力で素のまま（＝ PyYAML が別の型で読む）なら漏れ。
      const out = String(createAutoinstallDocument({ k: raw })).trim()
      if (!out.includes(`"${raw}"`) && !out.includes(`'${raw}'`)) uncovered.push(out)
    }
    expect(uncovered).toEqual([])
  })

  it('残した食い違いは `y` / `n` だけ（増えたら気づく）', () => {
    const diffs: string[] = []
    for (const [raw, py] of PYYAML) {
      const v = (parseAutoinstallYaml(`k: ${raw}`).toJS() as Record<string, unknown>)['k']
      const mine = kindOf(v) === 'string' ? 'str' : kindOf(v)
      // 60 進数タグを外しているので、PyYAML が int にする値はこちらでは str になる。
      // それは「曖昧さを消す側」への食い違いなので数えない（出力でクォートされる）。
      if (py === 'int' && mine === 'str') continue
      if (mine !== py) diffs.push(`${raw}: mine=${mine} PyYAML=${py}`)
    }
    expect(diffs).toEqual(['y: mine=bool PyYAML=str', 'n: mine=bool PyYAML=str'])
  })
  it.each(UBUNTU_SERIES)('%s の既定プロファイルが両方の方言で同じ意味になる', (series) => {
    expect(dialectDiffs(generateUserData(createDefaultProfile(series), { comments: 'ja' }))).toEqual(
      [],
    )
  })
})
