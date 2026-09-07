/**
 * RAID + LVM と bond を「利用者の言葉どおりの構成」で実際に生成して確かめる。
 *
 *   npx tsx scripts/e2e-raid-bond.mts          # 生成 + 検証 + スキーマ（既定）
 *   npx tsx scripts/e2e-raid-bond.mts --print  # 生成した YAML をそのまま出す
 *
 * 作る構成（利用者の要望）:
 *   「ストレージを boot デバイスに 2 個設定し、RAID1 で /boot、
 *     RAID10 で LVM を組んで root パーティションを切る」
 *   ＋「NIC 2 枚を 802.3ad で束ねて固定 IP」
 *
 * RAID10 は curtin のドキュメントで**最小 4 台**なので、
 * boot 2 台（ESP + /boot の RAID1）+ data 4 台（RAID10 → LVM PV）の 6 台構成にする。
 *
 * **ISO も実デバイスも触らない**（`storage` / `network` の生成物だけを見る）ので
 * 権限も要らず数秒で終わる。ISO を絡めた網羅は `scripts/e2e-matrix.mts` の担当。
 *
 * ここで見るのは「YAML の形」と「公式スキーマを通ること」まで。
 * **実機／VM でインストールを完走させてはいない**（`docs/HANDOFF.md` §3.2）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import Ajv2020, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import {
  buildRaidPlan,
  createDefaultProfile,
  createBondMember,
  createDefaultBondNetwork,
  createDefaultRaidStorage,
  createRaidArray,
  createRaidDisk,
  formatLocalized,
  generateUserData,
  validateProfile,
  type AutoinstallProfile,
  type UbuntuSeries,
} from '../packages/shared/src/index.js'
import { sha512Crypt } from '../packages/shared/src/crypt/sha512crypt.js'
import { printRevisionBanner } from './lib/git-revision.mjs'

/** 検証用の固定ハッシュ。**このスクリプトの外へは出ない**（`.img` にも書かない）。 */
const HASH = sha512Crypt('e2e-raid-bond-password', { salt: 'raidbond0' })

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../docs/research/schema')
const SCHEMA_FILES: Record<UbuntuSeries, string> = {
  '22.04': 'autoinstall-schema.22.04.2.json',
  '24.04': 'autoinstall-schema.24.04.4.json',
  '25.10': 'autoinstall-schema.25.10.json',
  '26.04': 'autoinstall-schema.26.04.1.json',
}
const ALL_SERIES = Object.keys(SCHEMA_FILES) as UbuntuSeries[]

const printYaml = process.argv.includes('--print')

let checks = 0
let failures = 0
const failed: string[] = []

function check(label: string, condition: boolean, detail = ''): void {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures++
  failed.push(label)
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

function section(title: string): void {
  console.log(`\n■ ${title}`)
}

// ---------------------------------------------------------------------------
// スキーマ検証（e2e-matrix.mts と同じ道具立て。ajv + subiquity の公式スキーマ）
// ---------------------------------------------------------------------------

const validators = new Map<UbuntuSeries, (d: unknown) => ErrorObject[] | null>()
function validatorFor(series: UbuntuSeries): (d: unknown) => ErrorObject[] | null {
  const cached = validators.get(series)
  if (cached) return cached
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8')) as object
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  const fn = (d: unknown): ErrorObject[] | null => (validate(d) ? null : (validate.errors ?? []))
  validators.set(series, fn)
  return fn
}

// ---------------------------------------------------------------------------
// 構成を組み立てる
// ---------------------------------------------------------------------------

/** boot 用 2 台 + data 用 4 台。**シリアル指定**（RAID で曖昧な match は危険）。 */
const BOOT_SERIALS = ['BOOT-SERIAL-0001', 'BOOT-SERIAL-0002'] as const
const DATA_SERIALS = ['DATA-SERIAL-0001', 'DATA-SERIAL-0002', 'DATA-SERIAL-0003', 'DATA-SERIAL-0004'] as const

/**
 * `StorageConfig` は「構造化モード」と `raw` の判別可能ユニオン。
 * 絞らずに `...profile.storage` と広げると `raw` の枝（`yaml` だけ）も混ざって
 * 型が通らない。**ここで 1 度だけ絞る**（落とし穴 22：ユニオンは型ごとに扱う）。
 */
type StructuredStorage = Extract<AutoinstallProfile['storage'], { readonly match: unknown }>

function structuredStorage(profile: AutoinstallProfile): StructuredStorage {
  const s = profile.storage
  if (s.mode === 'raw') throw new Error('このスクリプトは構造化モードの storage を前提にしている')
  return s
}

function bootDiskId(i: number): string {
  return `boot-${i}`
}
function dataDiskId(i: number): string {
  return `data-${i}`
}

function buildProfile(series: UbuntuSeries): AutoinstallProfile {
  const base = createDefaultProfile(series, 'e2e-raid-bond/0.1.0', '2026-09-07T00:00:00.000Z')

  const disks = [
    // boot デバイス 2 個。ESP を作り、/boot の RAID1 のメンバーになる。
    ...BOOT_SERIALS.map((serial, i) => ({
      ...createRaidDisk(bootDiskId(i), { kind: 'serial' as const, serial }),
      boot: true,
    })),
    // data 4 台。RAID10 のメンバー。ESP は作らない。
    ...DATA_SERIALS.map((serial, i) => ({
      ...createRaidDisk(dataDiskId(i), { kind: 'serial' as const, serial }),
      boot: false,
    })),
  ]

  const arrays = [
    {
      ...createRaidArray('md-boot', 'md0', 'boot' as const),
      level: 'raid1' as const,
      diskIds: [bootDiskId(0), bootDiskId(1)],
    },
    {
      ...createRaidArray('md-data', 'md1', 'lvm-pv' as const),
      level: 'raid10' as const,
      diskIds: DATA_SERIALS.map((_, i) => dataDiskId(i)),
    },
  ]

  return {
    ...base,
    basics: { ...base.basics, hostname: 'raid-bond-host' },
    user: { ...base.user, passwordHash: HASH },
    storage: {
      ...structuredStorage(base),
      // 既存の 3 モードには一切触らない。4 つ目として `raid` を選ぶ。
      mode: 'raid',
      raid: {
        ...createDefaultRaidStorage(),
        disks,
        arrays,
        volumeGroup: 'vg0',
        rootName: 'root',
        rootSize: '', // 残り全部（size: -1）
        rootFstype: 'ext4',
        espSize: '512M',
        bootSize: '2G',
        // 2 台目の boot ディスクにも late-commands で grub-install する。
        mirrorBootloader: true,
      },
    },
    network: {
      ...createDefaultBondNetwork(),
      name: 'bond0',
      members: [
        createBondMember('member-1', { kind: 'name', name: 'enp1s0' }),
        createBondMember('member-2', { kind: 'name', name: 'enp2s0' }),
      ],
      parameters: {
        mode: '802.3ad',
        lacpRate: 'fast',
        miiMonitorInterval: 100,
        transmitHashPolicy: 'layer3+4',
      },
      addressing: 'static',
      address: '192.168.10.20/24',
      gateway: '192.168.10.1',
      nameservers: ['192.168.10.1', '8.8.8.8'],
      searchDomains: ['example.test'],
    },
  }
}

// ---------------------------------------------------------------------------
// 生成物を読むための小道具
// ---------------------------------------------------------------------------

type Action = Record<string, unknown>

function autoinstallOf(profile: AutoinstallProfile): Record<string, unknown> {
  // **YAML を実際に往復させる**。オブジェクトのまま見ると、YAML にしたときだけ
  // 壊れる形（`802.3ad` が数に見える等）を取り逃がす。
  const doc = parse(generateUserData(profile, { comments: 'ja' })) as { autoinstall?: Record<string, unknown> }
  return doc.autoinstall ?? {}
}

function storageConfigOf(ai: Record<string, unknown>): Action[] {
  const storage = ai['storage'] as Record<string, unknown> | undefined
  const config = storage?.['config']
  return Array.isArray(config) ? (config as Action[]) : []
}

function byType(config: Action[], type: string): Action[] {
  return config.filter((a) => a['type'] === type)
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

printRevisionBanner('scripts/e2e-raid-bond.mts')
console.log('構成  : boot 2 台 (ESP + RAID1 /boot) + data 4 台 (RAID10 → LVM → root)')
console.log('        NIC 2 枚を 802.3ad で束ねて固定 IP')

const profile = buildProfile('24.04')
const ai = autoinstallOf(profile)
const config = storageConfigOf(ai)

if (printYaml) {
  console.log('\n----- generated user-data -----')
  console.log(generateUserData(profile, { comments: 'ja' }))
  console.log('----- end -----')
}

// --- 1. プロファイル検証 ---------------------------------------------------

section('プロファイル検証（この構成で error が出ないこと）')
const validation = validateProfile(profile)
const errors = validation.issues.filter((i) => i.severity === 'error')
check(
  'error が 1 件も無い',
  errors.length === 0,
  errors.map((i) => `${i.field}: ${formatLocalized('ja', i.text)}`).join(' / '),
)
const warnings = validation.issues.filter((i) => i.severity === 'warning')
console.log(`       warning ${warnings.length} 件 / info ${validation.issues.filter((i) => i.severity === 'info').length} 件`)
for (const w of warnings) console.log(`         - [${w.field}] ${formatLocalized('ja', w.text)}`)
// 「選んだディスクが全部消える」は必ず出ていなければならない（落とし穴 65）。
check(
  '「全部消去される」警告が出ている',
  validation.issues.some((i) => i.field.startsWith('storage.raid')) &&
    warnings.some((i) => formatLocalized('ja', i.text).includes('消去')),
)

// --- 2. storage: layout と config は排他 -----------------------------------

section('storage: config を出し、layout は出さない（排他）')
const storage = ai['storage'] as Record<string, unknown>
check('storage.config がある', config.length > 0, `${config.length} 個`)
check('storage.layout を出していない', !('layout' in storage))
check('storage.version は 1', storage['version'] === 1)
console.log(`       アクション ${config.length} 個: ${config.map((a) => `${String(a['type'])}:${String(a['id'])}`).join(', ')}`)

// --- 3. アクションが依存の順に並び、参照が全部解決する ----------------------

section('アクション列の依存順と参照解決')

const seen = new Set<string>()
const dupes: string[] = []
const forwardRefs: string[] = []
const unresolved: string[] = []

/** そのアクションが参照している id を（キー名つきで）返す。 */
function refsOf(a: Action): { key: string; id: string }[] {
  const out: { key: string; id: string }[] = []
  for (const key of ['device', 'volume', 'volgroup']) {
    const v = a[key]
    if (typeof v === 'string') out.push({ key, id: v })
  }
  for (const key of ['devices', 'spare_devices']) {
    const v = a[key]
    if (Array.isArray(v)) for (const id of v) if (typeof id === 'string') out.push({ key, id })
  }
  return out
}

const allIds = new Set(config.map((a) => String(a['id'])))
for (const a of config) {
  const id = String(a['id'])
  if (seen.has(id)) dupes.push(id)
  for (const { key, id: ref } of refsOf(a)) {
    if (!allIds.has(ref)) unresolved.push(`${id}.${key} -> ${ref}`)
    // **前方参照（まだ出ていない id を指す）は curtin では成立しない。**
    else if (!seen.has(ref)) forwardRefs.push(`${id}.${key} -> ${ref}`)
  }
  seen.add(id)
}

check('id の重複が無い', dupes.length === 0, dupes.join(', '))
check('参照している id がすべて実在する', unresolved.length === 0, unresolved.join(', '))
check('前方参照が無い（依存の順に並んでいる）', forwardRefs.length === 0, forwardRefs.join(', '))

// 型ごとの参照先が「正しい種類」を指しているか。ここを取り違えると黙って壊れる。
const typeOfId = new Map(config.map((a) => [String(a['id']), String(a['type'])]))

const mounts = byType(config, 'mount')
const badMountDevice = mounts.filter((m) => typeOfId.get(String(m['device'])) !== 'format')
check(
  'mount.device がすべて format の id を指す',
  badMountDevice.length === 0,
  badMountDevice.map((m) => `${String(m['id'])} -> ${String(m['device'])}(${typeOfId.get(String(m['device'])) ?? '?'})`).join(', '),
)

const vgs = byType(config, 'lvm_volgroup')
const vgRefs = vgs.flatMap((v) => (Array.isArray(v['devices']) ? (v['devices'] as string[]) : []))
check(
  'lvm_volgroup.devices が raid の id を指す',
  vgRefs.length > 0 && vgRefs.every((id) => typeOfId.get(id) === 'raid'),
  vgRefs.map((id) => `${id}(${typeOfId.get(id) ?? '?'})`).join(', '),
)

const raids = byType(config, 'raid')
const raidRefs = raids.flatMap((r) => (Array.isArray(r['devices']) ? (r['devices'] as string[]) : []))
check(
  'raid.devices が partition の id を指す',
  raidRefs.length > 0 && raidRefs.every((id) => typeOfId.get(id) === 'partition'),
  raidRefs.map((id) => `${id}(${typeOfId.get(id) ?? '?'})`).join(', '),
)

const lvs = byType(config, 'lvm_partition')
check(
  'lvm_partition.volgroup が lvm_volgroup の id を指す',
  lvs.length > 0 && lvs.every((l) => typeOfId.get(String(l['volgroup'])) === 'lvm_volgroup'),
)

const partitions = byType(config, 'partition')
check(
  'partition.device が disk の id を指す',
  partitions.length > 0 && partitions.every((p) => typeOfId.get(String(p['device'])) === 'disk'),
)

// --- 4. RAID の構成そのもの -------------------------------------------------

section('RAID1 で /boot、RAID10 で LVM')

const bootRaid = raids.find((r) => r['raidlevel'] === 'raid1')
const dataRaid = raids.find((r) => r['raidlevel'] === 'raid10')
check('raid1 の配列がある', bootRaid !== undefined)
check('raid10 の配列がある', dataRaid !== undefined)
check('raid10 のメンバーが 4 台', (dataRaid?.['devices'] as string[] | undefined)?.length === 4)
check('raid1 のメンバーが 2 台', (bootRaid?.['devices'] as string[] | undefined)?.length === 2)

const formats = byType(config, 'format')
const bootFormat = formats.find((f) => f['volume'] === bootRaid?.['id'])
const bootMount = mounts.find((m) => m['device'] === bootFormat?.['id'])
check('raid1 が /boot にマウントされる', bootMount?.['path'] === '/boot', String(bootMount?.['path']))

const rootLv = lvs[0]
const rootFormat = formats.find((f) => f['volume'] === rootLv?.['id'])
const rootMount = mounts.find((m) => m['device'] === rootFormat?.['id'])
check('LVM の論理ボリュームが / にマウントされる', rootMount?.['path'] === '/', String(rootMount?.['path']))
check('root は残り全部（size: -1）', rootLv?.['size'] === -1, String(rootLv?.['size']))
check('root の fstype が ext4', rootFormat?.['fstype'] === 'ext4')

// mount はパスの浅い順（`/` より先に `/boot/efi` をマウントさせない）。
const mountPaths = mounts.map((m) => String(m['path']))
const sortedPaths = [...mountPaths].sort((a, b) => a.split('/').length - b.split('/').length)
check('mount がパスの浅い順に並ぶ', JSON.stringify(mountPaths) === JSON.stringify(sortedPaths), mountPaths.join(' → '))

// --- 5. ESP は各 boot ディスクに、マウントは 1 つだけ ----------------------

section('ESP は各 boot ディスクに作り、マウントは 1 つだけ')

const plan = buildRaidPlan(profile.storage.mode === 'raid' ? profile.storage.raid : createDefaultRaidStorage())
const espParts = partitions.filter((p) => p['flag'] === 'boot')
check('ESP パーティションが boot ディスクの数だけある', espParts.length === 2, `${espParts.length} 個 / plan.espCount=${plan.espCount}`)
check('buildRaidPlan の espCount と一致', plan.espCount === espParts.length)

const espFormats = formats.filter((f) => espParts.some((p) => p['id'] === f['volume']))
check('ESP は 2 つとも format される', espFormats.length === 2)
check('ESP は fat32', espFormats.every((f) => f['fstype'] === 'fat32'))

const espMounts = mounts.filter((m) => espFormats.some((f) => f['id'] === m['device']))
check('ESP のマウントは 1 つだけ', espMounts.length === 1, `${espMounts.length} 個`)
check('その 1 つが /boot/efi', espMounts[0]?.['path'] === '/boot/efi')

const grubDevices = byType(config, 'disk').filter((d) => d['grub_device'] === true)
check('grub_device は 1 台だけ（curtin の制約）', grubDevices.length === 1, `${grubDevices.length} 台`)

// data ディスクには ESP を作らない（boot: false）。
const dataDisks = byType(config, 'disk').filter((d) => {
  const match = d['match'] as Record<string, unknown> | undefined
  return typeof match?.['serial'] === 'string' && (match['serial'] as string).startsWith('DATA-')
})
check('data ディスクは 4 台とも disk アクションがある', dataDisks.length === 4)
check(
  'data ディスクに ESP を作っていない',
  espParts.every((p) => !dataDisks.some((d) => d['id'] === p['device'])),
)
check('使われないディスクが無い', plan.unusedDiskIndexes.length === 0, plan.unusedDiskIndexes.join(','))

// --- 6. late-commands に 2 台目への grub-install ---------------------------

section('late-commands に 2 台目への grub-install が入る')

const late = ai['late-commands']
const lateList = Array.isArray(late) ? late.map((c) => String(c)) : []
check('late-commands がある', lateList.length > 0, `${lateList.length} 件`)
const mirror = lateList.find((c) => c.includes('grub-install'))
check('grub-install を含むエントリがある', mirror !== undefined)
check('EFI 用の grub-install である', (mirror ?? '').includes('--target=x86_64-efi'), '')
check('NVRAM を書かない（--no-nvram）', (mirror ?? '').includes('--no-nvram'))
check('失敗しても必ず exit 0（落とし穴 28）', (mirror ?? '').includes('exit 0'))
check('ヒアドキュメントを使っていない（落とし穴 47）', !(mirror ?? '').includes('<<'))
check('利用者の入力が埋め込まれていない', !(mirror ?? '').includes('BOOT-SERIAL') && !(mirror ?? '').includes('bond0'))

// --- 7. netplan の bond ----------------------------------------------------

section('netplan: bonds にメンバーが並び、ethernets にも宣言がある')

const network = ai['network'] as Record<string, unknown>
check('network.version は 2', network['version'] === 2)
const bonds = network['bonds'] as Record<string, Record<string, unknown>> | undefined
const ethernets = network['ethernets'] as Record<string, Record<string, unknown>> | undefined
check('bonds がある', bonds !== undefined && Object.keys(bonds).length === 1)
const bond = bonds?.['bond0']
check('bond0 という名前で出ている', bond !== undefined)

const interfaces = (bond?.['interfaces'] as string[] | undefined) ?? []
check('interfaces が 2 枚', interfaces.length === 2, interfaces.join(', '))
check('ethernets に 2 枚とも宣言がある', interfaces.every((k) => ethernets !== undefined && k in ethernets))
check('ethernets の数が interfaces と一致', Object.keys(ethernets ?? {}).length === interfaces.length)

// **メンバーにアドレスを付けない。** 付くと bond が成立しない。
const memberKeys = Object.values(ethernets ?? {}).flatMap((e) => Object.keys(e))
check(
  'メンバーは match だけを持つ（アドレスが付いていない）',
  memberKeys.length > 0 && memberKeys.every((k) => k === 'match'),
  memberKeys.join(', '),
)

const params = bond?.['parameters'] as Record<string, unknown> | undefined
check('mode が 802.3ad', params?.['mode'] === '802.3ad', JSON.stringify(params?.['mode']))
check('802.3ad が YAML 往復で文字列のまま', typeof params?.['mode'] === 'string')
check('lacp-rate が fast', params?.['lacp-rate'] === 'fast')
check('mii-monitor-interval が 100', params?.['mii-monitor-interval'] === 100)
check('transmit-hash-policy が layer3+4', params?.['transmit-hash-policy'] === 'layer3+4')

// アドレス・経路・DNS は bond 側に付く。
check('アドレスが bond 側に付く', JSON.stringify(bond?.['addresses']) === JSON.stringify(['192.168.10.20/24']))
check('dhcp4 が false', bond?.['dhcp4'] === false)
const routes = bond?.['routes'] as Record<string, unknown>[] | undefined
check('既定経路が bond 側に付く', routes?.[0]?.['to'] === 'default' && routes?.[0]?.['via'] === '192.168.10.1')
const ns = bond?.['nameservers'] as Record<string, unknown> | undefined
check('DNS が bond 側に付く', JSON.stringify(ns?.['addresses']) === JSON.stringify(['192.168.10.1', '8.8.8.8']))
check('検索ドメインが bond 側に付く', JSON.stringify(ns?.['search']) === JSON.stringify(['example.test']))

// --- 8. subiquity 公式スキーマ（4 リリース） -------------------------------

section('subiquity 公式スキーマ検証（4 リリース）')
for (const series of ALL_SERIES) {
  const p = buildProfile(series)
  const obj = autoinstallOf(p)
  const errs = validatorFor(series)(obj)
  check(
    `${series} のスキーマを通る`,
    errs === null,
    (errs ?? []).slice(0, 4).map((e) => `${e.instancePath} ${e.message}`).join(' / '),
  )
  // storage がリリースによらず `{type: object}` であること（落とし穴 64）。
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8')) as {
    properties?: Record<string, unknown>
  }
  const storageSchema = schema.properties?.['storage']
  check(
    `${series} の storage スキーマが {type: object}（リリース差が無い）`,
    JSON.stringify(storageSchema) === JSON.stringify({ type: 'object' }),
    JSON.stringify(storageSchema),
  )
}

// --- 9. 台数不足はちゃんと止まる -------------------------------------------

section('RAID10 を 2 台で組もうとしたら検証が止める')

const tooFew: AutoinstallProfile = {
  ...profile,
  storage: {
    ...structuredStorage(profile),
    mode: 'raid',
    raid: {
      ...createDefaultRaidStorage(),
      disks: [
        { ...createRaidDisk('d0', { kind: 'serial', serial: 'S0' }), boot: true },
        { ...createRaidDisk('d1', { kind: 'serial', serial: 'S1' }), boot: true },
      ],
      arrays: [
        {
          ...createRaidArray('a0', 'md0', 'lvm-pv'),
          level: 'raid10',
          diskIds: ['d0', 'd1'],
        },
      ],
    },
  },
}
const tooFewIssues = validateProfile(tooFew).issues.filter((i) => i.severity === 'error')
check('error が出る', tooFewIssues.length > 0)
check(
  '「4 台から」と伝えている',
  tooFewIssues.some((i) => {
    const s = formatLocalized('ja', i.text)
    return s.includes('4') && i.field.startsWith('storage.raid')
  }),
  tooFewIssues.map((i) => `${i.field}: ${formatLocalized('ja', i.text)}`).join(' / '),
)

// 逆に 4 台なら通ること（境界の両側を見る）。
const justEnough: AutoinstallProfile = {
  ...tooFew,
  storage: {
    ...structuredStorage(tooFew),
    mode: 'raid',
    raid: {
      ...structuredStorage(tooFew).raid,
      disks: [0, 1, 2, 3].map((i) => ({
        ...createRaidDisk(`d${i}`, { kind: 'serial' as const, serial: `S${i}` }),
        boot: i < 2,
      })),
      arrays: [
        {
          ...createRaidArray('a0', 'md0', 'lvm-pv' as const),
          level: 'raid10' as const,
          diskIds: ['d0', 'd1', 'd2', 'd3'],
        },
      ],
    },
  },
}
check(
  '4 台なら台数の error は消える',
  !validateProfile(justEnough)
    .issues.filter((i) => i.severity === 'error')
    .some((i) => formatLocalized('ja', i.text).includes('台から')),
)

// --- 10. 既存モードを壊していない ------------------------------------------

section('既存の 3 モードの出力が変わっていない')
for (const mode of ['lvm', 'direct', 'zfs'] as const) {
  const p: AutoinstallProfile = {
    ...createDefaultProfile('24.04', 'e2e-raid-bond/0.1.0', '2026-09-07T00:00:00.000Z'),
    storage: { ...structuredStorage(createDefaultProfile()), mode },
  }
  const s = autoinstallOf(p)['storage'] as Record<string, unknown>
  check(`${mode}: layout を出し config を出さない`, 'layout' in s && !('config' in s))
}

// ---------------------------------------------------------------------------

console.log(`\n${checks} 件中 ${checks - failures} 件成功、${failures} 件失敗`)
if (failures > 0) {
  console.error('\n失敗:')
  for (const f of failed) console.error(`  - ${f}`)
  process.exit(1)
}
