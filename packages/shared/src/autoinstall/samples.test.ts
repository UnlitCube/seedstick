import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { migrateProfile } from './migrate.js'
import { validateProfile } from './validate.js'
import { generateUserData } from './generate.js'
import { buildHostMenuEntries, baseKernelArgs, KERNEL_ARG } from './runtime-values.js'
import { parseAutoinstallYamlToJs as parse } from './yaml.js'
import { formatLocalized } from '../i18n/index.js'

// `samples/` に置いたプロファイルが**読める・通る・意図どおりの YAML になる**ことを固定する。
//
// **サンプルは配布物である。** 壊れたまま置いておくと、開いた人が
// 「このツールは動かない」と判断する。しかもサンプルはコードから遠いので、
// スキーマを変えたときに真っ先に取り残される（落とし穴 71 の親戚）。
//
// ここで見るのは 3 層:
//   1. 読める（`migrateProfile` が移行の note を出さない＝いまの形で書けている）
//   2. 通る（`validateProfile` の error が、意図した 1 件だけ）
//   3. 意図どおりの YAML になる（起動メニューの項目と、その引数）

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), '../../../../samples')

function loadSample(name: string): unknown {
  return JSON.parse(readFileSync(join(SAMPLES, name), 'utf8')) as unknown
}

describe('samples/ip-only.json（IP だけ起動メニューで切り替える）', () => {
  const raw = loadSample('ip-only.json')
  const { profile, notes } = migrateProfile(raw)

  it('いまの形式でそのまま読める（移行の note が出ない）', () => {
    // note が出るなら、サンプルが古い形式で書かれている。
    expect(notes).toEqual([])
    expect(profile.profileVersion).toBe(4)
  })

  it('検証の error は「パスワード未設定」の 1 件だけ', () => {
    // **サンプルにパスワードハッシュを入れて配らない。**
    // 入れると、それをそのまま使う人が出る。
    // 空にしておけば GUI が 1 件だけ error を出し、
    // 「ここを自分で埋めてください」と伝わる（落とし穴 61: 直せる形で止める）。
    const errors = validateProfile(profile).issues.filter((i) => i.severity === 'error')
    expect(errors.map((i) => i.field)).toEqual(['user.passwordHash'])
  })

  it('IP だけが起動メニューで変わる（ホスト名とディスクは固定）', () => {
    expect(profile.runtimeValues.network).toBe('kernel-arg')
    expect(profile.runtimeValues.hostname).toBe('fixed')
    expect(profile.runtimeValues.disk).toBe('fixed')
    // プリセットは **ipv4 だけ**が違う。
    const presets = profile.runtimeValues.presets
    expect(presets.length).toBeGreaterThanOrEqual(2)
    const varying = new Set(presets.map((p) => p.ipv4))
    expect(varying.size).toBe(presets.length)
    for (const p of presets) {
      expect(p.hostname).toBe('')
      expect(p.disk).toBe('')
      expect(p.gateway).toBe(presets[0]!.gateway)
      expect(p.nameservers).toBe(presets[0]!.nameservers)
    }
  })

  it('起動メニューの項目が「予備の値 → 各 IP → 手入力」の順に並ぶ', () => {
    const entries = buildHostMenuEntries(profile.runtimeValues, baseKernelArgs(''))
    const presets = profile.runtimeValues.presets
    expect(entries.length).toBe(presets.length + 1)
    presets.forEach((p, i) => {
      expect(entries[i]!.args).toContain(`${KERNEL_ARG.ipv4}=${p.ipv4}`)
      // **ホスト名の引数は出さない**（固定なので）。出ると「IP だけ別」が崩れる。
      expect(entries[i]!.args.some((a) => a.startsWith(`${KERNEL_ARG.hostname}=`))).toBe(false)
    })
    expect(entries[entries.length - 1]!.args).toContain(`${KERNEL_ARG.interactive}=1`)
  })

  it('生成される YAML には「予備の値」が入る（メニューで選ばなければこれになる）', () => {
    const js = parse(generateUserData(profile, { comments: 'none' })) as {
      autoinstall: { network: { ethernets: Record<string, { addresses?: string[] }> } }
    }
    const eths = js.autoinstall.network.ethernets
    const addrs = Object.values(eths).flatMap((v) => v.addresses ?? [])
    expect(addrs).toEqual([profile.network.mode === 'static' ? profile.network.address : ''])
    // プリセットの IP は YAML には入らない。**起動時に early-commands が差し替える。**
    for (const p of profile.runtimeValues.presets) {
      expect(addrs).not.toContain(p.ipv4)
    }
  })

  // **キー名を打ち間違えたサンプルは、黙って既定に落ちる。**
  // `netowrk`（綴り違い）と書くと `network` は既定の installer-default になり、
  // **note も出ず、`validateProfile` も通る**（実測）。
  // 静的 IP のつもりが DHCP に、シリアル指定が「いちばん大きいディスク」に化ける
  // ——落とし穴 22 / 49 / 50 が「サンプルを手で書く」という新しい入口から再現する。
  // だから **サンプルに書いたはずの値が、読み込んだあとも残っていること**を名指しで見る。
  it('サンプルに書いた値が、読み込んだあとも残っている（綴り違いで既定に落ちていない）', () => {
    const written = JSON.parse(JSON.stringify(raw)) as Record<string, never>
    const w = written as unknown as {
      basics: { hostname: string }
      user: { username: string }
      network: { mode: string; address: string; gateway: string }
      runtimeValues: { network: string; presets: Array<{ ipv4: string }> }
    }
    expect(profile.basics.hostname).toBe(w.basics.hostname)
    expect(profile.user.username).toBe(w.user.username)
    expect(profile.network.mode).toBe(w.network.mode)
    if (profile.network.mode === 'static') {
      expect(profile.network.address).toBe(w.network.address)
      expect(profile.network.gateway).toBe(w.network.gateway)
    }
    expect(profile.runtimeValues.network).toBe(w.runtimeValues.network)
    expect(profile.runtimeValues.presets.map((p) => p.ipv4)).toEqual(
      w.runtimeValues.presets.map((p) => p.ipv4),
    )
  })
  it('画面に出る指摘が両方の言語で読める', () => {
    for (const i of validateProfile(profile).issues) {
      for (const locale of ['ja', 'en'] as const) {
        const text = formatLocalized(locale, i.text)
        expect(text.length).toBeGreaterThan(0)
        // キー名がそのまま出ていないこと（辞書に無いキーだとキー名が出る）。
        expect(text).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/)
      }
    }
  })
})
