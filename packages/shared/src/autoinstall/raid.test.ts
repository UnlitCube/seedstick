import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import Ajv2020, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { createDefaultProfile } from './defaults.js'
import {
  buildAutoinstallObject,
  collectLateCommands,
  generateUserData,
  needsRaidEspMirror,
} from './generate.js'
import {
  RAID_ESP_MIRROR_LOG,
  UNREADABLE_DISK_MATCH_SERIAL,
  buildRaidPlan,
  raidEspMirrorCommand,
} from './generate-raid.js'
import { migrateProfile } from './migrate.js'
import { createDefaultRaidStorage } from './raid.js'
import type { RaidArray, RaidDisk, RaidStorageConfig } from './raid.js'
import type { AutoinstallProfile, UbuntuSeries } from './model.js'
import { validateProfile } from './validate.js'
import { formatLocalized } from '../i18n/index.js'

// RAID + LVM の生成・検証・移行。
//
// **いちばん壊れやすいのは「id の参照が解決するか」**（`mount.device` が
// `format` を指す、`lvm_volgroup.devices` が `raid` を指す…）なので、
// 目視で読める並びの固定と、機械での参照解決の両方を置く。

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

function disk(id: string, serial: string, boot: boolean): RaidDisk {
  return { id, match: { kind: 'serial', serial }, boot }
}

function array(over: Partial<RaidArray> & Pick<RaidArray, 'id' | 'name' | 'role'>): RaidArray {
  return { level: 'raid1', diskIds: [], spareDiskIds: [], ...over }
}

function raidProfile(raid: Partial<RaidStorageConfig>, series: UbuntuSeries = '24.04'): AutoinstallProfile {
  const p = createDefaultProfile(series)
  if (p.storage.mode === 'raw') throw new Error('kitei ga raw ni natte iru')
  return {
    ...p,
    basics: { ...p.basics, hostname: 'raidhost' },
    user: { ...p.user, passwordHash: HASH },
    storage: { ...p.storage, mode: 'raid', raid: { ...createDefaultRaidStorage(), ...raid } },
  }
}

/** 2 台 RAID1 の /boot + 4 台 RAID10 の PV。利用者が最初に言った構成。 */
const BOOT_AND_DATA: Partial<RaidStorageConfig> = {
  disks: [
    disk('d0', 'SER0', true),
    disk('d1', 'SER1', true),
    disk('d2', 'SER2', false),
    disk('d3', 'SER3', false),
  ],
  arrays: [
    array({ id: 'ab', name: 'md0', role: 'boot', level: 'raid1', diskIds: ['d0', 'd1'] }),
    array({ id: 'ap', name: 'md1', role: 'lvm-pv', level: 'raid10', diskIds: ['d0', 'd1', 'd2', 'd3'] }),
  ],
}

/** 2 台だけ。/boot は RAID1、データも同じ 2 台の RAID1。 */
const TWO_DISK_MIRROR: Partial<RaidStorageConfig> = {
  disks: [disk('d0', 'SER0', true), disk('d1', 'SER1', true)],
  arrays: [
    array({ id: 'ab', name: 'md0', role: 'boot', diskIds: ['d0', 'd1'] }),
    array({ id: 'ap', name: 'md1', role: 'lvm-pv', diskIds: ['d0', 'd1'] }),
  ],
}

type Action = Record<string, unknown>

function storageOf(profile: AutoinstallProfile): Record<string, unknown> {
  const built = buildAutoinstallObject(profile, { comments: 'none' })
  return built['storage'] as Record<string, unknown>
}

function configOf(profile: AutoinstallProfile): Action[] {
  return storageOf(profile)['config'] as Action[]
}

/** `type/id` の並び。目で読める形で固定する。 */
function shapeOf(config: Action[]): string[] {
  return config.map((a) => `${String(a['type'])}:${String(a['id'])}`)
}

// ---------------------------------------------------------------------------
// 参照の解決（機械で確かめる）
// ---------------------------------------------------------------------------

/** どのキーがどの種類のアクションを指すか（R8 の表がそのまま入る）。 */
const REFERENCES: Record<string, { key: string; list?: boolean; to: string[] }[]> = {
  partition: [{ key: 'device', to: ['disk'] }],
  raid: [
    { key: 'devices', list: true, to: ['disk', 'partition'] },
    { key: 'spare_devices', list: true, to: ['disk', 'partition'] },
  ],
  lvm_volgroup: [{ key: 'devices', list: true, to: ['partition', 'disk', 'raid'] }],
  lvm_partition: [{ key: 'volgroup', to: ['lvm_volgroup'] }],
  // `format.volume` はパーティション / RAID / 論理ボリュームを指す
  format: [{ key: 'volume', to: ['partition', 'raid', 'lvm_partition'] }],
  // **`mount.device` が指すのは `format` の id。** 取り違えると黙ってマウントされない。
  mount: [{ key: 'device', to: ['format'] }],
}

/**
 * 参照の食い違いを全部集める。空配列なら健全。
 *
 * 「前方参照していない」ことまで見る（curtin はアクションを書かれた順に処理する）。
 */
function referenceProblems(config: Action[]): string[] {
  const problems: string[] = []
  const typeById = new Map<string, string>()
  const seen = new Set<string>()
  config.forEach((action, i) => {
    const type = String(action['type'])
    const id = String(action['id'])
    if (seen.has(id)) problems.push(`id が重複: ${id}`)
    seen.add(id)
    for (const ref of REFERENCES[type] ?? []) {
      const value = action[ref.key]
      if (value === undefined) continue
      const ids = ref.list ? (value as unknown[]).map(String) : [String(value)]
      if (ref.list && !Array.isArray(value)) problems.push(`${type}#${i} の ${ref.key} が配列でない`)
      for (const target of ids) {
        const targetType = typeById.get(target)
        if (targetType === undefined) {
          problems.push(`${type}:${id} の ${ref.key} が未定義か後ろの id を指している: ${target}`)
        } else if (!ref.to.includes(targetType)) {
          problems.push(
            `${type}:${id} の ${ref.key} が ${ref.to.join('/')} ではなく ${targetType} を指している: ${target}`,
          )
        }
      }
    }
    typeById.set(id, type)
  })
  return problems
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

describe('RAID + LVM の生成', () => {
  it('2 台 RAID1 の /boot と 4 台 RAID10 の PV を、依存関係の順に出す', () => {
    const config = configOf(raidProfile(BOOT_AND_DATA))
    expect(shapeOf(config)).toEqual([
      'disk:disk-0',
      'disk:disk-1',
      'disk:disk-2',
      'disk:disk-3',
      'partition:disk-0-esp',
      'partition:disk-1-esp',
      'partition:disk-0-boot',
      'partition:disk-1-boot',
      'partition:disk-0-data',
      'partition:disk-1-data',
      'partition:disk-2-data',
      'partition:disk-3-data',
      'raid:md-0',
      'raid:md-1',
      'format:disk-0-esp-fs',
      'format:disk-1-esp-fs',
      'format:md-0-fs',
      'lvm_volgroup:vg-0',
      'lvm_partition:lv-root',
      'format:lv-root-fs',
      'mount:lv-root-mnt',
      'mount:md-0-mnt',
      'mount:disk-0-esp-mnt',
    ])
  })

  it('id の参照がすべて解決し、前方参照が無い', () => {
    for (const raid of [BOOT_AND_DATA, TWO_DISK_MIRROR]) {
      expect(referenceProblems(configOf(raidProfile(raid)))).toEqual([])
    }
  })

  it('参照の検査そのものが効く（壊したら落ちることを確かめる）', () => {
    // 落とし穴 57: 入れた検査は、変異させて落ちることまで確かめる。
    const config = configOf(raidProfile(BOOT_AND_DATA))
    // (a) mount が format ではなくパーティションを指す（実際に起きうる取り違え）
    const wrongMount = config.map((a) =>
      a['id'] === 'disk-0-esp-mnt' ? { ...a, device: 'disk-0-esp' } : a,
    )
    expect(referenceProblems(wrongMount)).toEqual([
      'mount:disk-0-esp-mnt の device が format ではなく partition を指している: disk-0-esp',
    ])
    // (b) 前方参照（raid を partition より前に置く）
    const reordered = [config[12]!, ...config.filter((_, i) => i !== 12)]
    expect(referenceProblems(reordered).length).toBeGreaterThan(0)
    // (c) id の重複
    expect(referenceProblems([...config, config[0]!])).toContain('id が重複: disk-0')
  })

  it('マウントは / → /boot → /boot/efi の順（curtin は書かれた順に処理する）', () => {
    const config = configOf(raidProfile(BOOT_AND_DATA))
    const paths = config.filter((a) => a['type'] === 'mount').map((a) => String(a['path']))
    expect(paths).toEqual(['/', '/boot', '/boot/efi'])
  })

  it('ESP は boot ディスクごとに作るが、マウントするのは 1 つだけ', () => {
    const config = configOf(raidProfile(BOOT_AND_DATA))
    const esps = config.filter((a) => a['type'] === 'partition' && a['flag'] === 'boot')
    expect(esps.map((a) => a['id'])).toEqual(['disk-0-esp', 'disk-1-esp'])
    expect(config.filter((a) => a['type'] === 'format' && a['fstype'] === 'fat32')).toHaveLength(2)
    expect(config.filter((a) => a['path'] === '/boot/efi')).toHaveLength(1)
  })

  it('grub_device は 1 台目の boot ディスクだけに付く', () => {
    const config = configOf(raidProfile(BOOT_AND_DATA))
    const withGrub = config.filter((a) => a['grub_device'] === true).map((a) => a['id'])
    expect(withGrub).toEqual(['disk-0'])
  })

  it('boot に使わないディスクが 1 台目でも、grub_device は boot ディスクに付く', () => {
    const config = configOf(
      raidProfile({
        disks: [disk('d0', 'SER0', false), disk('d1', 'SER1', true), disk('d2', 'SER2', true)],
        arrays: [array({ id: 'ap', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1', 'd2'] })],
      }),
    )
    expect(config.filter((a) => a['grub_device'] === true).map((a) => a['id'])).toEqual(['disk-1'])
  })

  it('データ用パーティションはそのディスクの最後なので size: -1', () => {
    const config = configOf(raidProfile(BOOT_AND_DATA))
    const data = config.filter((a) => String(a['id']).endsWith('-data'))
    expect(data).toHaveLength(4)
    for (const a of data) expect(a['size']).toBe(-1)
    // 番号はディスクごとに 1 から。boot ディスクは ESP・/boot のあとなので 3。
    expect(config.find((a) => a['id'] === 'disk-0-data')?.['number']).toBe(3)
    expect(config.find((a) => a['id'] === 'disk-2-data')?.['number']).toBe(1)
  })

  it('root のサイズは、空なら残り全部・指定があればその値', () => {
    expect(
      configOf(raidProfile(BOOT_AND_DATA)).find((a) => a['type'] === 'lvm_partition')?.['size'],
    ).toBe(-1)
    expect(
      configOf(raidProfile({ ...BOOT_AND_DATA, rootSize: '80G' })).find(
        (a) => a['type'] === 'lvm_partition',
      )?.['size'],
    ).toBe('80G')
  })

  it('ボリュームグループは PV 用の配列だけを取り、/boot 用は取らない', () => {
    const config = configOf(raidProfile(BOOT_AND_DATA))
    const vg = config.find((a) => a['type'] === 'lvm_volgroup')
    expect(vg?.['devices']).toEqual(['md-1'])
    expect(vg?.['name']).toBe('vg0')
  })

  it('スペアは spare_devices に出て、devices には出ない', () => {
    const config = configOf(
      raidProfile({
        disks: [
          disk('d0', 'S0', true),
          disk('d1', 'S1', true),
          disk('d2', 'S2', false),
          disk('d3', 'S3', false),
          disk('d4', 'S4', false),
        ],
        arrays: [
          array({
            id: 'ap',
            name: 'md0',
            role: 'lvm-pv',
            level: 'raid5',
            diskIds: ['d0', 'd1', 'd2', 'd3'],
            spareDiskIds: ['d4'],
          }),
        ],
      }),
    )
    const md = config.find((a) => a['type'] === 'raid')
    expect(md?.['devices']).toEqual(['disk-0-data', 'disk-1-data', 'disk-2-data', 'disk-3-data'])
    expect(md?.['spare_devices']).toEqual(['disk-4-data'])
    expect(referenceProblems(config)).toEqual([])
  })

  it('どこにも使わないディスクには disk アクションを出さない（消さない）', () => {
    const plan = buildRaidPlan({
      ...createDefaultRaidStorage(),
      disks: [disk('d0', 'S0', true), disk('d1', 'S1', true), disk('unused', 'S9', false)],
      arrays: [array({ id: 'ap', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'] })],
    })
    expect(plan.config.filter((a) => a['type'] === 'disk').map((a) => a['id'])).toEqual([
      'disk-0',
      'disk-1',
    ])
    expect(plan.unusedDiskIndexes).toEqual([2])
  })

  it('読めないディスク指定を「どのディスクでもよい」に落とさない', () => {
    // `{}`（= match: {}）は「任意の 1 台」。読めない指定をそこへ落とすと、
    // 複数ディスク機で意図しないディスクを消す（落とし穴 22 / 65）。
    const config = configOf(
      raidProfile({
        disks: [
          { id: 'd0', match: null as unknown as RaidDisk['match'], boot: true },
          disk('d1', 'S1', true),
        ],
        arrays: [array({ id: 'ap', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'] })],
      }),
    )
    const first = config.find((a) => a['id'] === 'disk-0')
    expect(first?.['match']).toEqual({ serial: UNREADABLE_DISK_MATCH_SERIAL })
    expect(first?.['match']).not.toEqual({})
  })

  it('layout は出さない（layout と config は排他）', () => {
    const storage = storageOf(raidProfile(BOOT_AND_DATA))
    expect(storage['layout']).toBeUndefined()
    expect(storage['version']).toBe(1)
  })

  it('swap は config と併用できる（storage の直下に出る）', () => {
    const p = raidProfile(BOOT_AND_DATA)
    if (p.storage.mode === 'raw') throw new Error('raw')
    const storage = storageOf({
      ...p,
      storage: { ...p.storage, swap: { mode: 'none', size: '' } },
    })
    expect(storage['swap']).toEqual({ size: 0 })
    expect(Array.isArray(storage['config'])).toBe(true)
  })

  it('reset-partition は raid では出さない（layout の中のキーなので）', () => {
    const p = raidProfile(BOOT_AND_DATA)
    if (p.storage.mode === 'raw') throw new Error('raw')
    const storage = storageOf({
      ...p,
      storage: { ...p.storage, resetPartition: { enabled: true, size: '12G' } },
    })
    expect(JSON.stringify(storage)).not.toContain('reset-partition')
  })

  it('YAML に書き出して読み戻しても同じアクション列になる', () => {
    const p = raidProfile(BOOT_AND_DATA)
    const parsed = parse(generateUserData(p, { comments: 'ja' })) as {
      autoinstall: { storage: { config: Action[] } }
    }
    expect(shapeOf(parsed.autoinstall.storage.config)).toEqual(shapeOf(configOf(p)))
    expect(referenceProblems(parsed.autoinstall.storage.config)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2 台目以降への GRUB
// ---------------------------------------------------------------------------

describe('2 台目以降の起動ディスクへのブートローダ', () => {
  it('boot ディスクが 2 台以上のときだけ late-command を出す', () => {
    expect(needsRaidEspMirror(raidProfile(BOOT_AND_DATA))).toBe(true)
    expect(
      needsRaidEspMirror(
        raidProfile({
          disks: [disk('d0', 'S0', true), disk('d1', 'S1', false)],
          arrays: [array({ id: 'ap', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'] })],
        }),
      ),
    ).toBe(false)
    expect(needsRaidEspMirror({ ...raidProfile({ ...BOOT_AND_DATA, mirrorBootloader: false }) })).toBe(
      false,
    )
    expect(needsRaidEspMirror(createDefaultProfile())).toBe(false)
  })

  it('late-commands の先頭に 1 エントリだけ入る', () => {
    const cmds = collectLateCommands(raidProfile(BOOT_AND_DATA))
    expect(cmds.filter((c) => c.includes('efi-mirror'))).toHaveLength(1)
    expect(cmds[0]).toBe(raidEspMirrorCommand())
  })

  it('失敗を握り潰さず、必ず 0 で終わる（インストール全体を止めない）', () => {
    const cmd = raidEspMirrorCommand()
    // 落とし穴 28: late-commands の各エントリは別々に実行される。
    // 1 エントリにまとめ、最後に必ず exit 0 する。
    expect(cmd.startsWith('sh -c ')).toBe(true)
    expect(cmd).toContain('exit 0')
    expect(cmd).toContain(RAID_ESP_MIRROR_LOG)
    // `|| true` で結果を捨てていない（何が起きたかをログに残す）
    expect(cmd).toContain('FAILED')
    expect(cmd).toContain('RESULT:')
  })

  it('生成した文字列がシェルとして 1 個の引数になっている', () => {
    // 落とし穴 46 / 47: 値はクォートする。ヒアドキュメントを使わない。
    const cmd = raidEspMirrorCommand()
    expect(cmd).not.toContain('<<')
    const q = String.fromCharCode(39)
    const bs = String.fromCharCode(92)
    const prefix = 'sh -c ' + q
    expect(cmd.startsWith(prefix) && cmd.endsWith(q)).toBe(true)
    // 中身の `'` はすべて `'\''` になっているので、剥がすと元のスクリプトに戻る
    const inner = cmd.slice(prefix.length, -1)
    expect(inner.split(q + bs + q + q).join('')).not.toContain(q)
  })
})

// ---------------------------------------------------------------------------
// subiquity 公式スキーマ
// ---------------------------------------------------------------------------

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/research/schema')
const SCHEMA_FILES: Record<UbuntuSeries, string> = {
  '22.04': 'autoinstall-schema.22.04.2.json',
  '24.04': 'autoinstall-schema.24.04.4.json',
  '25.10': 'autoinstall-schema.25.10.json',
  '26.04': 'autoinstall-schema.26.04.1.json',
}

function validatorFor(series: UbuntuSeries): (data: unknown) => ErrorObject[] | null {
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8')) as object
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  return (data: unknown) => (validate(data) ? null : (validate.errors ?? []))
}

function toPlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if ('value' in value && Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    return (value as { value: unknown }).value
  }
  if (Array.isArray(value)) return value.map(toPlain)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]))
}

describe.each(['22.04', '24.04', '25.10', '26.04'] as UbuntuSeries[])(
  'RAID の生成結果が公式スキーマを通る (%s)',
  (series) => {
    const validate = validatorFor(series)

    it('storage.config を出してもスキーマを通る', () => {
      // `storage` はどのリリースでも `{type: object}` としか宣言されていないので、
      // リリース差は無い（落とし穴 64 の確認）。実際に 4 リリースで通す。
      const built = toPlain(buildAutoinstallObject(raidProfile(BOOT_AND_DATA, series), { comments: 'none' }))
      const errors = validate(built)
      expect(errors?.map((e) => `${e.instancePath} ${e.message ?? ''}`).join('\n') ?? '').toBe('')
    })

    it('storage の宣言はリリースによらず type: object だけ', () => {
      const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8')) as {
        properties?: Record<string, unknown>
      }
      expect(schema.properties?.['storage']).toEqual({ type: 'object' })
    })
  },
)

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

const keysOf = (p: AutoinstallProfile): string[] => validateProfile(p).issues.map((i) => i.text.key)
const errorsOf = (p: AutoinstallProfile): string[] =>
  validateProfile(p).issues.filter((i) => i.severity === 'error').map((i) => i.text.key)

describe('RAID の検証', () => {
  it('まっとうな構成なら error が出ない', () => {
    const result = validateProfile(raidProfile(BOOT_AND_DATA))
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('RAID10 は 4 台から（curtin のドキュメントの数字）', () => {
    const p = raidProfile({
      disks: [disk('d0', 'S0', true), disk('d1', 'S1', true), disk('d2', 'S2', false)],
      arrays: [
        array({ id: 'ap', name: 'md0', role: 'lvm-pv', level: 'raid10', diskIds: ['d0', 'd1', 'd2'] }),
      ],
    })
    expect(errorsOf(p)).toContain('validate.raidTooFewDevices')
    const issue = validateProfile(p).issues.find((i) => i.text.key === 'validate.raidTooFewDevices')!
    expect(formatLocalized('ja', issue.text)).toContain('4')
    expect(formatLocalized('en', issue.text)).toContain('4')
    expect(validateProfile(p).ok).toBe(false)
  })

  it('最小台数の検査が効く（4 台にすれば通る）', () => {
    // 落とし穴 57: 変異させて落ちることを確かめる（ここは逆向きに、直せば消えること）。
    expect(errorsOf(raidProfile(BOOT_AND_DATA))).not.toContain('validate.raidTooFewDevices')
  })

  it.each([
    ['raid0', 2],
    ['raid1', 2],
    ['raid5', 3],
    ['raid6', 4],
    ['raid10', 4],
  ] as const)('%s は %i 台から', (level, need) => {
    const disks = [0, 1, 2, 3, 4].map((i) => disk(`d${i}`, `S${i}`, i < 2))
    const withCount = (n: number): AutoinstallProfile =>
      raidProfile({
        disks: disks.slice(0, Math.max(n, 2)),
        arrays: [
          array({
            id: 'ap',
            name: 'md0',
            role: 'lvm-pv',
            level,
            diskIds: disks.slice(0, n).map((d) => d.id),
          }),
        ],
      })
    expect(errorsOf(withCount(need - 1))).toContain('validate.raidTooFewDevices')
    expect(errorsOf(withCount(need))).not.toContain('validate.raidTooFewDevices')
  })

  it('起動に使うディスクが 0 台なら error', () => {
    const p = raidProfile({
      disks: [disk('d0', 'S0', false), disk('d1', 'S1', false)],
      arrays: [array({ id: 'ap', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'] })],
    })
    expect(errorsOf(p)).toContain('validate.raidNoBootDisk')
  })

  it('同じ用途の配列に同じディスクを入れたら error / 別の用途なら正常', () => {
    const both = raidProfile({
      disks: [disk('d0', 'S0', true), disk('d1', 'S1', true)],
      arrays: [
        array({ id: 'a1', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'] }),
        array({ id: 'a2', name: 'md1', role: 'lvm-pv', diskIds: ['d0', 'd1'] }),
      ],
    })
    expect(errorsOf(both)).toContain('validate.raidDiskInTwoArraysOfSameRole')
    // /boot 用と PV 用に同じ 2 台を使うのは**正常**（これが 2 台構成の定番）
    expect(errorsOf(raidProfile(TWO_DISK_MIRROR))).toEqual([])
  })

  it('1 つの配列に同じディスクを 2 回入れたら error（本体とスペアの重複も）', () => {
    const p = raidProfile({
      disks: [disk('d0', 'S0', true), disk('d1', 'S1', true)],
      arrays: [
        array({ id: 'a1', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'], spareDiskIds: ['d1'] }),
      ],
    })
    expect(errorsOf(p)).toContain('validate.raidDiskDuplicatedInArray')
  })

  it('曖昧なディスク指定は強く警告する（どれが消えるか分からない）', () => {
    const p = raidProfile({
      disks: [
        { id: 'd0', match: { kind: 'largest' }, boot: true },
        { id: 'd1', match: { kind: 'any' }, boot: true },
      ],
      arrays: [array({ id: 'ap', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'] })],
    })
    const hits = validateProfile(p).issues.filter(
      (i) => i.text.key === 'validate.raidMemberMatchNotSpecific',
    )
    expect(hits).toHaveLength(2)
    for (const locale of ['ja', 'en'] as const) {
      const text = formatLocalized(locale, hits[0]!.text)
      expect(text).toMatch(locale === 'ja' ? /消え/ : /erase/i)
    }
  })

  it('RAID に使うディスクが全部消えることを必ず言う（落とし穴 65）', () => {
    const issue = validateProfile(raidProfile(BOOT_AND_DATA)).issues.find(
      (i) => i.text.key === 'validate.raidWipesAllMemberDisks',
    )!
    expect(issue.severity).toBe('warning')
    expect(formatLocalized('ja', issue.text)).toContain('4')
    expect(formatLocalized('ja', issue.text)).toMatch(/消去/)
    expect(formatLocalized('en', issue.text)).toMatch(/erased/i)
  })

  it('効かない設定は「効かない」と伝える（storage.match / リセットパーティション）', () => {
    const p = raidProfile(BOOT_AND_DATA)
    if (p.storage.mode === 'raw') throw new Error('raw')
    const keys = keysOf({
      ...p,
      storage: { ...p.storage, resetPartition: { enabled: true, size: '' } },
    })
    expect(keys).toContain('validate.raidMatchIgnored')
    expect(keys).toContain('validate.raidResetPartitionIgnored')
    // 「どのディスクでもよい」の助言は raid では出さない（そちらは使われないので）
    expect(keys).not.toContain('validate.diskMatchAny')
  })

  it('暗号化パスフレーズは raid では効かないと伝える（既存の指摘が効く）', () => {
    const p = raidProfile(BOOT_AND_DATA)
    if (p.storage.mode === 'raw') throw new Error('raw')
    const keys = keysOf({ ...p, storage: { ...p.storage, encryptionPassphrase: 'longenough' } })
    expect(keys).toContain('validate.encryptionRequiresLvm')
  })

  it('ディスクをカーネル引数で渡す設定とは併用できない', () => {
    const p = raidProfile(BOOT_AND_DATA)
    const withArg: AutoinstallProfile = {
      ...p,
      runtimeValues: { ...p.runtimeValues, disk: 'kernel-arg' },
    }
    expect(errorsOf(withArg)).toContain('validate.diskKernelArgWithRaidStorage')
    // 「シリアルで指定してください」という的外れな指摘は出さない
    expect(errorsOf(withArg)).not.toContain('validate.diskKernelArgNeedsSerialMatch')
  })

  it('読めないディスク指定も error にする（一致するディスクが無い）', () => {
    const p = raidProfile({
      disks: [
        { id: 'd0', match: null as unknown as RaidDisk['match'], boot: true },
        disk('d1', 'S1', true),
      ],
      arrays: [array({ id: 'ap', name: 'md0', role: 'lvm-pv', diskIds: ['d0', 'd1'] })],
    })
    expect(errorsOf(p)).toContain('validate.raidDiskMatchEmpty')
  })

  it('手で壊した JSON でも例外を投げない', () => {
    const broken = [
      { disks: null, arrays: null },
      { disks: [null, 42, 'x'], arrays: [null] },
      { disks: [{ id: 'd0' }], arrays: [{ id: 'a', diskIds: 'not-a-list' }] },
      { disks: [{ id: 'd0', match: null, boot: 'yes' }], arrays: [{ name: 5, level: 9 }] },
      { volumeGroup: null, rootName: 42, espSize: [], rootSize: {} },
    ]
    for (const raid of broken) {
      const p = raidProfile(raid as unknown as Partial<RaidStorageConfig>)
      expect(() => validateProfile(p)).not.toThrow()
      expect(() => buildAutoinstallObject(p, { comments: 'none' })).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// 読み込み（移行）
// ---------------------------------------------------------------------------

/** そのプロファイルの raid 設定（raw ならテストを落とす）。 */
function raidOf(p: AutoinstallProfile): RaidStorageConfig {
  if (p.storage.mode === 'raw') throw new Error('raw')
  return p.storage.raid
}

describe('RAID の読み込み', () => {
  const saved = (raid: unknown, mode: unknown = 'raid'): unknown => ({
    profileVersion: 4,
    series: '24.04',
    storage: { mode, match: { kind: 'serial', serial: 'X' }, raid },
  })

  it('保存した構成をそのまま読み戻せる', () => {
    const raid = { ...createDefaultRaidStorage(), ...BOOT_AND_DATA }
    const { profile } = migrateProfile(saved(raid))
    expect(profile.storage.mode).toBe('raid')
    expect(raidOf(profile).disks).toEqual(raid.disks)
    expect(raidOf(profile).arrays).toEqual(raid.arrays)
  })

  it('mergeSection でレコードの配列が潰れない（行が丸ごと消えない）', () => {
    // ここが本当に壊れやすい: `mergeSection` はレコードの配列を strList で
    // 文字列だけにするので、専用の読み取りを通さないと行が全部消える。
    const { profile } = migrateProfile(saved({ ...createDefaultRaidStorage(), ...TWO_DISK_MIRROR }))
    expect(raidOf(profile).disks).toHaveLength(2)
    expect(raidOf(profile).arrays).toHaveLength(2)
  })

  it('ディスクの match が既定に落ちない（落とし穴 22 / 49）', () => {
    const { profile } = migrateProfile(
      saved({
        disks: [
          { id: 'd0', match: { kind: 'serial', serial: 'CT-1' }, boot: true },
          { id: 'd1', match: { kind: 'path', path: '/dev/sdb' }, boot: true },
        ],
        arrays: [],
      }),
    )
    expect(raidOf(profile).disks.map((d) => d.match)).toEqual([
      { kind: 'serial', serial: 'CT-1' },
      { kind: 'path', path: '/dev/sdb' },
    ])
  })

  it('mode が読めなくても RAID の構成は残す（落とし穴 49）', () => {
    const { profile, notes } = migrateProfile(
      saved({ ...createDefaultRaidStorage(), ...TWO_DISK_MIRROR }, 'made-up-mode'),
    )
    expect(raidOf(profile).arrays).toHaveLength(2)
    expect(raidOf(profile).disks).toHaveLength(2)
    expect(notes.map((n) => n.key)).toContain('migrate.storageModeReset')
  })

  it('mode が lvm に戻っていても RAID の構成は消さない（解除できない状態にしない）', () => {
    const { profile } = migrateProfile(
      saved({ ...createDefaultRaidStorage(), ...TWO_DISK_MIRROR }, 'lvm'),
    )
    expect(profile.storage.mode).toBe('lvm')
    expect(raidOf(profile).arrays).toHaveLength(2)
  })

  it('知らない RAID レベル / 用途は既定に戻し、戻したと伝える', () => {
    const { profile, notes } = migrateProfile(
      saved({
        disks: [
          { id: 'd0', match: { kind: 'serial', serial: 'A' }, boot: true },
          { id: 'd1', match: { kind: 'serial', serial: 'B' }, boot: true },
        ],
        arrays: [{ id: 'a1', name: 'md0', level: 'raid7', role: 'swap', diskIds: ['d0', 'd1'] }],
      }),
    )
    expect(raidOf(profile).arrays[0]?.level).toBe('raid1')
    expect(raidOf(profile).arrays[0]?.role).toBe('lvm-pv')
    const keys = notes.map((n) => n.key)
    expect(keys).toContain('migrate.enumReset')
  })

  it('要素を落としたら添字をずらさない（落とし穴 48）', () => {
    // 先頭に非オブジェクトを混ぜても、2 番目の配列が 1 番目の設定を受け取らない。
    const { profile, notes } = migrateProfile(
      saved({
        disks: [
          null,
          { id: 'd0', match: { kind: 'serial', serial: 'A' }, boot: true },
          { id: 'd1', match: { kind: 'serial', serial: 'B' }, boot: false },
        ],
        arrays: [
          42,
          { id: 'a1', name: 'md0', level: 'raid1', role: 'boot', diskIds: ['d0'] },
          { id: 'a2', name: 'md1', level: 'raid1', role: 'lvm-pv', diskIds: ['d1'] },
        ],
      }),
    )
    expect(raidOf(profile).disks.map((d) => d.id)).toEqual(['d0', 'd1'])
    expect(raidOf(profile).disks.map((d) => d.boot)).toEqual([true, false])
    expect(raidOf(profile).arrays.map((a) => [a.name, a.role, a.diskIds])).toEqual([
      ['md0', 'boot', ['d0']],
      ['md1', 'lvm-pv', ['d1']],
    ])
    expect(notes.map((n) => n.key)).toContain('migrate.itemsDropped')
  })

  it('存在しないディスクを指す参照は外し、外したと伝える（黙って消さない）', () => {
    const { profile, notes } = migrateProfile(
      saved({
        disks: [{ id: 'd0', match: { kind: 'serial', serial: 'A' }, boot: true }],
        arrays: [{ id: 'a1', name: 'md0', level: 'raid1', role: 'lvm-pv', diskIds: ['d0', 'ghost'] }],
      }),
    )
    expect(raidOf(profile).arrays[0]?.diskIds).toEqual(['d0'])
    const note = notes.find((n) => n.key === 'migrate.raidDiskRefDropped')
    expect(note).toBeDefined()
    expect(formatLocalized('ja', note!)).toContain('1')
    expect(formatLocalized('en', note!)).toContain('1')
  })

  it('壊れた JSON でも例外を投げず、生成と検証まで通る', () => {
    for (const raid of [null, 42, 'x', [], { disks: 'no', arrays: { a: 1 } }, { disks: [[]] }]) {
      const { profile } = migrateProfile(saved(raid))
      expect(() => validateProfile(profile)).not.toThrow()
      expect(() => buildAutoinstallObject(profile, { comments: 'none' })).not.toThrow()
    }
  })
})
