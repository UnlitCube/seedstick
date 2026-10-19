import { beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// **生成物は消費者と同じ方言で読み直す。**
// `yaml` の既定 (1.2) で読むと、クォート漏れが文字列に見えて素通りする
// （実際に 73/73 が緑のまま VM で落ちた。落とし穴 109）。
import { stringify } from 'yaml'
import { parseAutoinstallYamlToJs as parse } from './yaml.js'
import { createDefaultProfile } from './defaults.js'
import { formatLocalized } from '../i18n/index.js'
import { buildAutoinstallObject, collectEarlyCommands, generateUserData } from './generate.js'
import {
  KERNEL_ARG,
  buildHostMenuEntries,
  buildSubstitutionScript,
  interactiveSectionsFor,
  isSafePresetLabel,
  isSafeRuntimeValue,
  usesKernelArgs,
  utf8ToBase64,
  type HostPreset,
  type RuntimeValuesConfig,
} from './runtime-values.js'
import type { AutoinstallProfile } from './model.js'
import { validateProfile } from './validate.js'

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

function profile(fn: (p: AutoinstallProfile) => AutoinstallProfile = (p) => p): AutoinstallProfile {
  const base = createDefaultProfile('24.04')
  return fn({ ...base, user: { ...base.user, passwordHash: HASH } })
}

function runtime(overrides: Partial<RuntimeValuesConfig> = {}): RuntimeValuesConfig {
  return {
    hostname: 'fixed',
    network: 'fixed',
    disk: 'fixed',
    presets: [],
    offerInteractiveEntry: true,
    ...overrides,
  }
}

function preset(overrides: Partial<HostPreset> = {}): HostPreset {
  return {
    id: 'p1',
    label: 'web01',
    hostname: 'web01',
    ipv4: '192.168.1.11/24',
    gateway: '192.168.1.1',
    nameservers: '1.1.1.1,8.8.8.8',
    disk: 'CT500MX500SSD1',
    ...overrides,
  }
}


/**
 * subiquity が書く `/autoinstall.yaml` を再現する。
 *
 * 大事なのは **手書きのテンプレートを使わない** こと。
 * 以前はフロー形式の手書き YAML でテストしていたため、
 * 「実際にはブロックシーケンスで出る」という前提のズレを検出できず、
 * `interactive-sections: [""]` になる不具合を通してしまった。
 *
 * subiquity は cloud-config から autoinstall キーを取り出し、PyYAML で
 * 書き直してから `/autoinstall.yaml` に置く（server.py の _read_config →
 * select_autoinstall）。なのでトップレベルは autoinstall のキーそのもので、
 * 引用形式もこちらの出力ではなく PyYAML のものになる。
 */
function asInstallerConfig(p: AutoinstallProfile): string {
  const obj = buildAutoinstallObject(p)
  // yaml で 1 度往復させて Scalar ノードを素の値に戻し、PyYAML と同じ
  // ブロックスタイルで書き直す（フロー形式に依存しないことを保証する）。
  return stringify(parse(stringify(obj)), { defaultStringType: 'QUOTE_SINGLE', lineWidth: 0 })
}

/**
 * Windows（Git Bash）には `python3` が無く `python` しか無いので、そこだけシムを置く。
 *
 * **macOS / Linux では置かない。** 置くと本物の `python3` を隠し、
 * `python` が無い環境（macOS の既定）では全件が「見つからない」で落ちる。
 */
function pathWithPython3(dir: string): string {
  const base = process.env['PATH'] ?? ''
  if (process.platform !== 'win32') return base
  writeFileSync(join(dir, 'python3'), '#!/bin/sh\nexec python "$@"\n', { encoding: 'utf8', mode: 0o755 })
  return `${dir}:${base}`
}

interface ShellRun {
  status: number | null
  stderr: string
  conf: string
}

/**
 * 生成した early-commands を実際に sh で実行する。
 * シェルや Python の構文ミスは、読んだだけでは見つからない。
 */
function execEarlyCommands(p: AutoinstallProfile, cmdline: string): ShellRun {
  const early = collectEarlyCommands(p)
  if (early.length === 0) throw new Error('early-commands が生成されていません')
  const dir = mkdtempSync(join(tmpdir(), 'ai-subst-'))
  try {
    const conf = join(dir, 'autoinstall.yaml')
    const cmd = join(dir, 'cmdline')
    writeFileSync(conf, asInstallerConfig(p), 'utf8')
    writeFileSync(cmd, cmdline, 'utf8')
    const r = spawnSync('sh', ['-c', early[0]!], {
      env: {
        ...process.env,
        AI_CONF: conf,
        AI_CMDLINE: cmd,
        // Windows の Python は既定で cp1252 / cp932 で書くので、診断が読めなくなる
        PYTHONUTF8: '1',
        PATH: pathWithPython3(dir),
      },
      encoding: 'utf8',
    })
    if (r.error) throw r.error
    return { status: r.status, stderr: r.stderr, conf: readFileSync(conf, 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 成功するはずの実行。失敗したら stderr ごと見せる。 */
function runEarlyCommands(p: AutoinstallProfile, cmdline: string): Record<string, unknown> {
  const r = execEarlyCommands(p, cmdline)
  if (r.status !== 0) throw new Error(`early-commands が exit ${r.status} で終わった:\n${r.stderr}`)
  return parse(r.conf) as Record<string, unknown>
}

/**
 * 失敗するはずの実行。**理由まで返す。**
 *
 * 終了コードだけを見ると、PyYAML が無い環境でも「失敗した」ので緑になる
 * （CI の Windows ランナーで実際にそうなった。落とし穴 116 / 153）。
 */
function failEarlyCommands(p: AutoinstallProfile, cmdline: string): string {
  const r = execEarlyCommands(p, cmdline)
  if (r.status === 0) throw new Error('early-commands が成功してしまった')
  return r.stderr
}

// **前提を 1 回だけ、はっきり確かめる。** 無いと全件が同じ 180 行の失敗を出し、
// 原因（PyYAML が無い）が読み取れない。黙って skip にもしない（CI で検査が消える）。
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-pycheck-'))
  try {
    const r = spawnSync('sh', ['-c', 'python3 -c "import yaml; print(yaml.__version__)"'], {
      env: { ...process.env, PYTHONUTF8: '1', PATH: pathWithPython3(dir) },
      encoding: 'utf8',
    })
    if (r.error || r.status !== 0) {
      throw new Error(
        'このテストは sh と python3 + PyYAML を要求する（生成した early-commands を実際に走らせるため）。\n' +
          '  python -m pip install PyYAML==6.0.1\n' +
          `stderr: ${r.stderr ?? String(r.error)}`,
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 起動メニューでホストを選ぶ、実際に作れる構成。 */
function kernelArgProfile(): AutoinstallProfile {
  return profile((x) => ({
    ...x,
    basics: { ...x.basics, hostname: 'fallback-host' },
    network: {
      mode: 'static',
      target: { kind: 'any' },
      address: '10.0.0.9/24',
      gateway: '10.0.0.1',
      nameservers: ['1.1.1.1'],
      searchDomains: [],
      optional: false,
    },
    storage: {
      ...(x.storage as Exclude<AutoinstallProfile['storage'], { mode: 'raw' }>),
      match: { kind: 'serial', serial: 'FALLBACKSERIAL' },
    },
    runtimeValues: runtime({ hostname: 'kernel-arg', network: 'kernel-arg', disk: 'kernel-arg' }),
  }))
}

interface AppliedConfig {
  identity?: { hostname?: string }
  network?: { ethernets?: Record<string, Record<string, unknown>> }
  storage?: { layout?: { match?: { serial?: string } } }
  'interactive-sections'?: unknown
}

describe('early-commands（実際に sh + python で実行）', () => {
  it('カーネル引数の値が反映される', () => {
    const out = runEarlyCommands(
      kernelArgProfile(),
      'BOOT_IMAGE=/casper/vmlinuz autoinstall ai.hostname=web01 ai.ipv4=192.168.1.11/24' +
        ' ai.gw=192.168.1.1 ai.dns=1.1.1.1,8.8.8.8 ai.disk=CT500 ---\n',
    ) as AppliedConfig
    expect(out.identity?.hostname).toBe('web01')
    const eth = Object.values(out.network?.ethernets ?? {})[0]!
    expect(eth['addresses']).toEqual(['192.168.1.11/24'])
    expect(eth['routes']).toEqual([{ to: 'default', via: '192.168.1.1' }])
    // DNS は「本物のリスト」になること。ここが 1 本の文字列だと netplan が壊れる。
    expect((eth['nameservers'] as { addresses: string[] }).addresses).toEqual(['1.1.1.1', '8.8.8.8'])
    expect(out.storage?.layout?.match?.serial).toBe('CT500')
  })

  it('引数が無ければプロファイルの既定値のまま', () => {
    const out = runEarlyCommands(kernelArgProfile(), 'BOOT_IMAGE=/casper/vmlinuz autoinstall ---\n') as AppliedConfig
    expect(out.identity?.hostname).toBe('fallback-host')
    const eth = Object.values(out.network?.ethernets ?? {})[0]!
    expect(eth['addresses']).toEqual(['10.0.0.9/24'])
    expect(out.storage?.layout?.match?.serial).toBe('FALLBACKSERIAL')
  })

  // 回帰: プレースホルダをテキスト置換していた頃は、ここが [""] になり
  // subiquity が bool([""]) == True で対話インストール扱いにしていた。
  it('引数なしでは interactive-sections が残らない（無人インストールが壊れない）', () => {
    const out = runEarlyCommands(kernelArgProfile(), 'autoinstall ---\n') as AppliedConfig
    expect(out['interactive-sections']).toBeUndefined()
  })

  it('カーネル引数を渡しても interactive-sections は増えない', () => {
    const out = runEarlyCommands(kernelArgProfile(), 'autoinstall ai.hostname=web01 ---\n') as AppliedConfig
    expect(out['interactive-sections']).toBeUndefined()
  })

  // 回帰: 以前は "identity, network, storage" という 1 個の文字列になり、
  // どのコントローラにも一致せず画面が 1 つも出なかった。
  it('ai.interactive=1 でセクション名のリストになる', () => {
    const out = runEarlyCommands(kernelArgProfile(), 'autoinstall ai.interactive=1 ---\n') as AppliedConfig
    expect(out['interactive-sections']).toEqual(['identity', 'network', 'storage'])
  })

  // 空白はカーネル引数の区切りなので、そもそも値に入らない（`ai.hostname=a b` は
  // `ai.hostname=a` と `b` の 2 トークンになる）。ここではそれ以外の危険文字を見る。
  //
  // 以前は黙って既定値を使っていたが、それだと GRUB の e キーで打ち間違えた値が
  // 何の表示もなく捨てられ、全台がプロファイルの既定 IP でインストールされる。
  // 気づけるように中止する。
  it('危険な文字を含む値は中止になる', () => {
    for (const bad of ['a;rm', 'a"b', 'a$b', 'a&b', 'a|b', 'a`b', 'a<b', "a'b"]) {
      const stderr = failEarlyCommands(kernelArgProfile(), `autoinstall ai.hostname=${bad} ---\n`)
      // 落ちた理由が「使えない文字」であること（PyYAML が無いことではなく）
      expect(stderr, bad).toContain('boot parameters contain characters that are not allowed: ai.hostname')
    }
  })


  // 回帰: 既定値は検証されずに sed の置換文字列へ直接埋め込まれていたため、
  // シリアルに `"` を入れるとインストーラ（root）で任意コマンドが動いた。
  it('プロファイル側の値にシェルのメタ文字が入っても実行されない', () => {
    const p = profile((x) => ({
      ...kernelArgProfile(),
      storage: {
        ...(x.storage as Exclude<AutoinstallProfile['storage'], { mode: 'raw' }>),
        match: { kind: 'serial', serial: 'X";touch /tmp/ai-pwned-marker;#' },
      },
    }))
    const script = collectEarlyCommands(p)[0]!
    // 値はシェルにも Python ソースにも現れない（base64 の JSON で渡している）
    expect(script).not.toContain('touch /tmp/ai-pwned-marker')
    const out = runEarlyCommands(p, 'autoinstall ai.hostname=web01 ---\n') as AppliedConfig
    expect(out.identity?.hostname).toBe('web01')
    // 既定値はそのまま YAML の値として入るだけ
    expect(out.storage?.layout?.match?.serial).toBe('X";touch /tmp/ai-pwned-marker;#')
  })

  it('複数 NIC の指定でも対象のインターフェースだけ書き換える', () => {
    const p = profile((x) => ({
      ...kernelArgProfile(),
      network: {
        mode: 'static',
        target: { kind: 'name', name: 'enp3s0' },
        address: '10.0.0.9/24',
        gateway: '10.0.0.1',
        nameservers: ['1.1.1.1'],
        searchDomains: [],
        optional: false,
      },
      storage: x.storage,
    }))
    const out = runEarlyCommands(p, 'autoinstall ai.ipv4=172.16.0.5/16 ---\n') as AppliedConfig
    expect(out.network?.ethernets?.['enp3s0']?.['addresses']).toEqual(['172.16.0.5/16'])
  })
})

// 回帰: 「その場で入力する」は kernel-arg にした項目を手で入れるための逃げ道。
// interactive にした項目の集合から作ると、手入力を選んでも肝心の画面が出ない。
describe('ai.interactive=1 の画面', () => {
  function mixed(): AutoinstallProfile {
    return profile((x) => ({
      ...kernelArgProfile(),
      // ホスト名は起動メニュー、ネットワークはインストーラで入力、ディスクは固定
      runtimeValues: runtime({ hostname: 'kernel-arg', network: 'interactive', disk: 'fixed' }),
      behavior: { ...x.behavior, interactiveSections: ['storage'] },
    }))
  }

  it('kernel-arg にした項目の画面が出る', () => {
    const out = runEarlyCommands(mixed(), 'autoinstall ai.interactive=1 ---\n') as AppliedConfig
    const sections = out['interactive-sections'] as string[]
    expect(sections).toContain('identity')
  })

  it('もともと指定していた画面を消さない', () => {
    const out = runEarlyCommands(mixed(), 'autoinstall ai.interactive=1 ---\n') as AppliedConfig
    const sections = out['interactive-sections'] as string[]
    // プロファイルで明示した storage（ディスク消去の確認）と network を奪わない
    expect(sections).toContain('storage')
    expect(sections).toContain('network')
  })

  it('3 項目とも kernel-arg なら 3 画面とも出る', () => {
    const out = runEarlyCommands(kernelArgProfile(), 'autoinstall ai.interactive=1 ---\n') as AppliedConfig
    expect((out['interactive-sections'] as string[]).sort()).toEqual(['identity', 'network', 'storage'])
  })
})

// 回帰: 引数を渡したのに反映できないと、全台が同じ IP / 同じディスクを掴む。
// 黙って成功扱いにすると、気づくのは再起動後になる。
describe('反映できなかった引数は失敗にする', () => {
  it('fixed の項目に対する引数はエラーで止まる', () => {
    const p = profile(() => ({
      ...kernelArgProfile(),
      runtimeValues: runtime({ hostname: 'kernel-arg', network: 'fixed', disk: 'fixed' }),
    }))
    // ai.disk は fields.disk が false なので入れる場所がない
    const stderr = failEarlyCommands(p, 'autoinstall ai.hostname=web01 ai.disk=X ---\n')
    expect(stderr).toContain('could not apply boot parameters: ai.disk')
  })

  it('反映できる引数だけなら成功する', () => {
    const p = profile(() => ({
      ...kernelArgProfile(),
      runtimeValues: runtime({ hostname: 'kernel-arg', network: 'fixed', disk: 'fixed' }),
    }))
    const out = runEarlyCommands(p, 'autoinstall ai.hostname=web01 ---\n') as AppliedConfig
    expect(out.identity?.hostname).toBe('web01')
  })
})

describe('生成される設定', () => {
  it('kernel-arg にすると early-commands が 1 つ出る', () => {
    const p = profile((x) => ({ ...x, runtimeValues: runtime({ hostname: 'kernel-arg' }) }))
    const early = collectEarlyCommands(p)
    expect(early).toHaveLength(1)
    expect(early[0]).toContain('/autoinstall.yaml')
    expect(buildAutoinstallObject(p)['early-commands']).toEqual(early)
  })

  it('fixed のみなら early-commands は出ない', () => {
    expect(collectEarlyCommands(profile())).toEqual([])
    expect(buildAutoinstallObject(profile())['early-commands']).toBeUndefined()
  })

  // プレースホルダは廃止した。YAML はそれ自体で有効でなければならない
  // （early-commands が動かなくても、既定値でインストールが完走する）。
  it('プレースホルダを一切出さない', () => {
    const p = kernelArgProfile()
    const body = generateUserData(p, { comments: 'none' })
    expect(body).not.toMatch(/@@AI_/)
    expect(JSON.stringify(buildAutoinstallObject(p))).not.toMatch(/@@AI_/)
  })

  it('kernel-arg でも identity.hostname は既定値が入る', () => {
    const o = buildAutoinstallObject(kernelArgProfile())
    expect((o['identity'] as { hostname: string }).hostname).toBe('fallback-host')
  })

  it('kernel-arg でも match.serial は既定値が入る', () => {
    const o = buildAutoinstallObject(kernelArgProfile())
    const layout = (o['storage'] as { layout: { match: { serial: string } } }).layout
    expect(layout.match.serial).toBe('FALLBACKSERIAL')
  })

  it('kernel-arg だけでは interactive-sections を出さない', () => {
    expect(buildAutoinstallObject(kernelArgProfile())['interactive-sections']).toBeUndefined()
  })
})


describe('interactive モード', () => {
  it('項目ごとに対応するセクションが interactive-sections に入る', () => {
    expect(interactiveSectionsFor(runtime({ hostname: 'interactive' }))).toEqual(['identity'])
    expect(interactiveSectionsFor(runtime({ network: 'interactive' }))).toEqual(['network'])
    expect(interactiveSectionsFor(runtime({ disk: 'interactive' }))).toEqual(['storage'])
    expect(
      interactiveSectionsFor(runtime({ hostname: 'interactive', disk: 'interactive' })),
    ).toEqual(['identity', 'storage'])
  })

  it('生成結果の interactive-sections に反映される', () => {
    const o = buildAutoinstallObject(
      profile((x) => ({
        ...x,
        runtimeValues: runtime({ hostname: 'interactive', network: 'interactive' }),
      })),
    )
    expect(o['interactive-sections']).toEqual(['identity', 'network'])
  })

  // subiquity は interactive-sections を schema ではなく直接読む (server.py) ので 22.04 でも効く。
  // 22.04 の autoinstall-schema.json に載っていないのは schema がコントローラ単位で
  // 生成されるためで、トップレベルは additionalProperties: true なので検証も通る。
  it('22.04 でもセクション名の指定は出す', () => {
    const o = buildAutoinstallObject(
      profile((x) => ({
        ...x,
        series: '22.04',
        runtimeValues: runtime({ hostname: 'interactive' }),
      })),
    )
    expect(o['interactive-sections']).toEqual(['identity'])
  })

  // ["*"] の展開は interactive_sections_GET にあり、22.04 で同じ挙動になる確証が無い。
  // 黙って効かないのが最悪なので、出さずに validate 側で警告する。
  it('22.04 では ["*"] を出さない', () => {
    const o = buildAutoinstallObject(
      profile((x) => ({
        ...x,
        series: '22.04',
        behavior: { ...x.behavior, interactiveAll: true },
      })),
    )
    expect(o['interactive-sections']).toBeUndefined()
  })

  it('interactiveAll は ["*"] になる', () => {
    const o = buildAutoinstallObject(
      profile((x) => ({ ...x, behavior: { ...x.behavior, interactiveAll: true } })),
    )
    expect(o['interactive-sections']).toEqual(['*'])
  })
})

describe('GRUB メニュー', () => {
  it('ホストごとにメニュー項目を作る', () => {
    const entries = buildHostMenuEntries(
      runtime({
        hostname: 'kernel-arg',
        network: 'kernel-arg',
        presets: [preset(), preset({ id: 'p2', label: 'web02', hostname: 'web02', ipv4: '192.168.1.12/24' })],
      }),
      ['autoinstall'],
    )
    // 2 ホスト + 手入力
    expect(entries).toHaveLength(3)
    expect(entries[0]!.args).toContain('autoinstall')
    expect(entries[0]!.args).toContain(`${KERNEL_ARG.hostname}=web01`)
    expect(entries[0]!.args).toContain(`${KERNEL_ARG.ipv4}=192.168.1.11/24`)
    expect(entries[0]!.title).toContain('web01')
    expect(entries.at(-1)!.args).toContain(`${KERNEL_ARG.interactive}=1`)
  })

  it('kernel-arg の項目だけを引数に入れる', () => {
    const entries = buildHostMenuEntries(
      runtime({ hostname: 'kernel-arg', network: 'fixed', disk: 'fixed', presets: [preset()] }),
    )
    const args = entries[0]!.args.join(' ')
    expect(args).toContain(KERNEL_ARG.hostname)
    expect(args).not.toContain(KERNEL_ARG.ipv4)
    expect(args).not.toContain(KERNEL_ARG.disk)
  })

  it('DNS の空白を取り除く（カーネル引数に空白は入れられない）', () => {
    const entries = buildHostMenuEntries(
      runtime({
        network: 'kernel-arg',
        presets: [preset({ nameservers: '1.1.1.1, 8.8.8.8' })],
      }),
    )
    expect(entries[0]!.args).toContain(`${KERNEL_ARG.nameservers}=1.1.1.1,8.8.8.8`)
  })

  it('kernel-arg が無ければメニューを増やさない', () => {
    expect(buildHostMenuEntries(runtime({ presets: [preset()] }))).toEqual([])
  })

  it('手入力の項目を出さない設定もできる', () => {
    const entries = buildHostMenuEntries(
      runtime({ hostname: 'kernel-arg', presets: [preset()], offerInteractiveEntry: false }),
    )
    expect(entries).toHaveLength(1)
  })
})

describe('値の安全性', () => {
  it.each([
    ['web01', true],
    ['192.168.1.10/24', true],
    ['CT500MX500SSD1', true],
    ['/dev/nvme0n1', true],
    ['1.1.1.1,8.8.8.8', true],
    ['bad value', false],
    ['bad|value', false],
    ['bad;rm -rf /', false],
    ['$(whoami)', false],
    ['', false],
  ])('%s → %s', (value, expected) => {
    expect(isSafeRuntimeValue(value)).toBe(expected)
  })

  it('GRUB のラベルに " や $ を許さない', () => {
    expect(isSafePresetLabel('web01')).toBe(true)
    expect(isSafePresetLabel('本番 web01')).toBe(true)
    expect(isSafePresetLabel('bad"label')).toBe(false)
    expect(isSafePresetLabel('bad$label')).toBe(false)
    expect(isSafePresetLabel('')).toBe(false)
  })
})

describe('検証', () => {
  it('kernel-arg + プリセット無しは警告になる', () => {
    const r = validateProfile(
      profile((x) => ({ ...x, runtimeValues: runtime({ hostname: 'kernel-arg' }) })),
    )
    expect(r.issues.some((i) => i.field.startsWith('runtimeValues'))).toBe(true)
  })

  it('プリセットの値が不正ならエラー', () => {
    const r = validateProfile(
      profile((x) => ({
        ...x,
        runtimeValues: runtime({
          hostname: 'kernel-arg',
          presets: [preset({ hostname: 'bad hostname' })],
        }),
      })),
    )
    expect(r.ok).toBe(false)
  })

  // 引数なしで起動されたときの既定値が無いと netplan が空アドレスになるので弾く
  it('IP を起動メニューで決めるのに固定 IP の既定値が無いと落とす', () => {
    const r = validateProfile(
      profile((x) => ({
        ...x,
        runtimeValues: runtime({ network: 'kernel-arg', presets: [preset()] }),
      })),
    )
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'runtimeValues.network')).toBe(true)
  })

  it('正しく設定すれば検証を通る', () => {
    const r = validateProfile(
      profile((x) => ({
        ...x,
        // 引数が渡されなかったときに使う既定値を用意しておく
        network: {
          mode: 'static',
          target: { kind: 'any' },
          address: '192.168.1.50/24',
          gateway: '192.168.1.1',
          nameservers: ['1.1.1.1'],
          searchDomains: [],
          optional: false,
        },
        runtimeValues: runtime({
          hostname: 'kernel-arg',
          network: 'kernel-arg',
          presets: [preset()],
        }),
      })),
    )
    expect(r.ok, r.issues.map((i) => formatLocalized('ja', i.text)).join(' / ')).toBe(true)
  })
})

describe('usesKernelArgs', () => {
  it('1 つでも kernel-arg があれば true', () => {
    expect(usesKernelArgs(runtime())).toBe(false)
    expect(usesKernelArgs(runtime({ disk: 'kernel-arg' }))).toBe(true)
    expect(usesKernelArgs(runtime({ hostname: 'interactive' }))).toBe(false)
  })
})

describe('utf8ToBase64', () => {
  // Node の Buffer と一致することを確かめる。renderer からも import されるモジュールなので
  // Buffer は使えないが、テストでは正解として使える。
  it('ASCII / 日本語 / 絵文字で Buffer と一致する', () => {
    for (const text of [
      '',
      'a',
      'ab',
      'abc',
      'abcd',
      'hello world',
      '{"hostname":"web01"}',
      'ホスト名',
      '{"hostname":"ホスト01","x":"😀"}',
      'a'.repeat(1000),
    ]) {
      expect(utf8ToBase64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'))
    }
  })
})

// 回帰: ゲートウェイや DNS が空欄のホストで引数自体を省くと、
// プロファイルの既定値をそのまま引き継ぐ。自分のサブネットに無いゲートウェイが
// 既定経路になり、「閉じたネットワーク」の意図が黙って反転する。
describe('起動メニューの「無し」指定', () => {
  it('空欄のゲートウェイ / DNS は既定値を引き継がない', () => {
    const p = profile(() => ({
      ...kernelArgProfile(),
      runtimeValues: runtime({
        hostname: 'kernel-arg',
        network: 'kernel-arg',
        disk: 'kernel-arg',
        presets: [
          { id: 'c1', label: 'closed', hostname: 'closed', ipv4: '10.9.9.9/24', gateway: '', nameservers: '', disk: 'S1' },
        ],
      }),
    }))
    const entry = buildHostMenuEntries(p.runtimeValues)[0]!
    // 空欄は「無し」を明示して渡す
    expect(entry.args).toContain(`${KERNEL_ARG.gateway}=none`)
    expect(entry.args).toContain(`${KERNEL_ARG.nameservers}=none`)

    const out = runEarlyCommands(p, `autoinstall ${entry.args.join(' ')} ---\n`) as AppliedConfig
    const eth = Object.values(out.network?.ethernets ?? {})[0]!
    expect(eth['addresses']).toEqual(['10.9.9.9/24'])
    // プロファイルの既定 (10.0.0.1 / 1.1.1.1) を引き継がないこと
    expect(eth['routes']).toBeUndefined()
    expect(eth['nameservers']).toBeUndefined()
  })

  it('ai.interactive=0 でインストールを中止しない', () => {
    // 起動メニューが出すのは ai.interactive=1 だけだが、GRUB で e を押して
    // 手で打つ人はいる。`=0` は「追加の確認画面は要らない」という自然な指定で、
    // それが既定の状態なのだから、何も変えずに受け入れるのが正しい。
    // ignored に落として exit 1 にすると、打ち直しただけでインストールが止まる。
    const p = kernelArgProfile()
    const out = runEarlyCommands(
      p,
      'autoinstall ai.hostname=web01 ai.ipv4=192.168.1.11/24 ai.gw=none ai.dns=none' +
        ' ai.disk=SERIAL1 ai.interactive=0 ---\n',
    ) as AppliedConfig
    // 例外にならず（runEarlyCommands は非ゼロ終了で throw する）、
    // 対話セクションは増えていないこと
    expect(out['interactive-sections']).toBeUndefined()
    expect(out.identity?.hostname).toBe('web01')
  })

  it('ai.dns=none は DNS だけを消す（search ドメインは残す）', () => {
    // netplan の nameservers は addresses と search を同じ dict に持つ。
    // nameservers ごと pop すると、プロファイルで指定した検索ドメインまで
    // 一緒に消える。名前解決の設定が黙って変わるので気づきにくい。
    const base = kernelArgProfile()
    const p = {
      ...base,
      network: {
        ...(base.network as Extract<AutoinstallProfile['network'], { mode: 'static' }>),
        searchDomains: ['example.local', 'corp.internal'],
      },
    } as AutoinstallProfile

    const out = runEarlyCommands(
      p,
      'autoinstall ai.hostname=web01 ai.ipv4=192.168.1.11/24 ai.gw=none ai.dns=none ---\n',
    ) as AppliedConfig
    const eth = Object.values(out.network?.ethernets ?? {})[0]!
    const ns = eth['nameservers'] as { addresses?: unknown; search?: unknown } | undefined
    expect(ns?.addresses).toBeUndefined()
    expect(ns?.search).toEqual(['example.local', 'corp.internal'])
  })

  it('値があるホストはそのまま入る', () => {
    // **プリセットを実際に入れること。** presets が空だと buildHostMenuEntries が
    // 返すのは「手入力」項目 (ai.interactive=1) だけになり、ホストの値を一度も
    // 適用しないまま、プロファイル既定の routes を見て緑になっていた。
    const base = kernelArgProfile()
    const p = {
      ...base,
      runtimeValues: { ...base.runtimeValues, presets: [preset()] },
    } as AutoinstallProfile
    const entries = buildHostMenuEntries(p.runtimeValues)
    const entry = entries.find((e) => e.args.some((a) => a.startsWith(`${KERNEL_ARG.hostname}=`)))
    expect(entry).toBeDefined()

    const out = runEarlyCommands(p, `autoinstall ${entry!.args.join(' ')} ---\n`) as AppliedConfig
    // プロファイル既定 (fallback-host / 10.0.0.9 / FALLBACKSERIAL) ではなく
    // プリセットの値になっていること
    expect(out.identity?.hostname).toBe('web01')
    const eth = Object.values(out.network?.ethernets ?? {})[0]!
    expect(eth['addresses']).toEqual(['192.168.1.11/24'])
    expect(eth['nameservers']).toEqual({ addresses: ['1.1.1.1', '8.8.8.8'] })
    expect(JSON.stringify(eth['routes'])).toContain('192.168.1.1')
    expect(out.storage?.layout?.match?.serial).toBe('CT500MX500SSD1')
  })
})
