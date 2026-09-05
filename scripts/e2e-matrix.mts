/**
 * 実 ISO・実デバイスに対する E2E テストマトリクス。
 *
 * scripts/smoke-media.mts が「代表的な 1 構成を端から端まで通す」のに対し、
 * こちらは「作れる設定パターンを網羅して、どれもインストール可能な成果物になるか」を見る。
 *
 *   npx tsx scripts/e2e-matrix.mts              # .img への書き込みまで
 *   npx tsx scripts/e2e-matrix.mts --full       # 全ケースを .img に書いて読み戻す（遅い）
 *   npx tsx scripts/e2e-matrix.mts --list       # ケース一覧だけ出す
 *
 * 実 USB への書き込みは管理者権限が要るのでこのスクリプトでは行わない。
 * GUI（本物のアプリ）から実施し、結果を scripts/e2e-verify-usb.mts で読み戻す。
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import Ajv2020, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import {
  FileBlockDevice,
  buildIsoPatches,
  inspectIso,
  minimumDiskSize,
  planUsbLayout,
  executeWritePlan,
  readIsoStructure,
  resolvePath,
  readFile as readIsoFile,
  readGpt,
  parseMbr,
  readFatImage,
  getPlatformOps,
  remainingGrubBytes,
  CIDATA_LABEL,
  SECTOR_SIZE,
  IsoValidationError,
} from '../packages/media/src/index.js'
import {
  KERNEL_ARG,
  buildAutoinstallObject,
  buildGrubPlan,
  createDefaultProfile,
  generateUserData,
  generateMetaData,
  interactiveSectionsFor,
  recognizeIso,
  validateProfile,
  type AutoinstallProfile,
  type UbuntuSeries,
} from '../packages/shared/src/index.js'
import { sha512Crypt } from '../packages/shared/src/crypt/sha512crypt.js'

const HASH = sha512Crypt('e2e-test-password', { salt: 'e2esalt00' })
const SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample e2e@example'
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../docs/research/schema')
const SCHEMA_FILES: Record<UbuntuSeries, string> = {
  '22.04': 'autoinstall-schema.22.04.2.json',
  '24.04': 'autoinstall-schema.24.04.4.json',
  '25.10': 'autoinstall-schema.25.10.json',
  '26.04': 'autoinstall-schema.26.04.1.json',
}

let failures = 0
let checks = 0
/** 実際に処理できた ISO の本数。0 のまま終わったら成功にしない。 */
let isosProcessed = 0
const failed: string[] = []

function check(label: string, condition: boolean, detail = ''): void {
  checks++
  if (!condition) {
    failures++
    failed.push(label)
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

// ---------------------------------------------------------------------------
// スキーマ検証
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

/** 生成した user-data から autoinstall 部分を取り出す（YAML を実際に往復させる）。 */
function autoinstallFromUserData(userData: string): unknown {
  const doc = parse(userData) as { autoinstall?: unknown }
  return doc.autoinstall
}

// ---------------------------------------------------------------------------
// ケース定義
// ---------------------------------------------------------------------------

interface Case {
  readonly id: string
  readonly title: string
  /** 実 .img への書き込みまで行うか（全ケースやると時間がかかるので代表だけ） */
  readonly heavy: boolean
  readonly build: (base: AutoinstallProfile, ctx: CaseContext) => AutoinstallProfile
  /** 生成物に対する追加の検査 */
  readonly expect?: (r: CaseResult) => void
}

interface CaseContext {
  readonly series: UbuntuSeries
  readonly payloadPath: string
  readonly payloadSize: number
}

interface CaseResult {
  readonly profile: AutoinstallProfile
  readonly userData: string
  readonly autoinstall: Record<string, unknown>
  readonly grubCfg: string
  readonly grubFree: number
}

function has(o: Record<string, unknown>, path: string): boolean {
  let cur: unknown = o
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return false
    cur = (cur as Record<string, unknown>)[seg]
    if (cur === undefined) return false
  }
  return true
}

function at(o: Record<string, unknown>, path: string): unknown {
  let cur: unknown = o
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

const CASES: Case[] = [
  {
    id: 'C1-minimal',
    title: '既定のまま（完全無人・固定値）',
    heavy: true,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-min' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
    }),
    expect: (r) => {
      check('C1: interactive-sections を出さない', !has(r.autoinstall, 'interactive-sections'))
      check('C1: early-commands を出さない', !has(r.autoinstall, 'early-commands'))
      check('C1: grub にホスト項目を足さない', !r.grubCfg.includes('ai.hostname='))
    },
  },
  {
    id: 'C2-static-net',
    title: '固定 IP + シリアル指定ディスク + swap 無効',
    heavy: false,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-static' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
      network: {
        mode: 'static',
        target: { kind: 'name', name: 'enp0s3' },
        address: '192.168.10.50/24',
        gateway: '192.168.10.1',
        nameservers: ['1.1.1.1', '8.8.8.8'],
        searchDomains: ['example.local'],
        optional: false,
      },
      storage:
        b.storage.mode === 'raw'
          ? b.storage
          : {
              ...b.storage,
              match: { kind: 'serial', serial: 'CE0538F1D353' },
              swap: { mode: 'none', size: '' },
              partitionTable: 'gpt',
            },
    }),
    expect: (r) => {
      eq('C2: swap size 0', at(r.autoinstall, 'storage.swap.size'), 0)
      eq('C2: ptable gpt', at(r.autoinstall, 'storage.layout.ptable'), 'gpt')
      eq('C2: 固定 IP が入る', JSON.stringify(at(r.autoinstall, 'network.ethernets.enp0s3.addresses')), '["192.168.10.50/24"]')
    },
  },
  {
    id: 'C3-kernel-arg',
    title: '起動メニューでホストを選ぶ（kernel-arg 3 項目 + プリセット 4 件）',
    heavy: true,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'fallback-host' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
      network: {
        mode: 'static',
        target: { kind: 'any' },
        address: '10.0.0.9/24',
        gateway: '10.0.0.1',
        nameservers: ['1.1.1.1'],
        searchDomains: [],
        optional: false,
      },
      storage:
        b.storage.mode === 'raw'
          ? b.storage
          : { ...b.storage, match: { kind: 'serial', serial: 'FALLBACKSERIAL01' } },
      runtimeValues: {
        hostname: 'kernel-arg',
        network: 'kernel-arg',
        disk: 'kernel-arg',
        offerInteractiveEntry: true,
        presets: [
          { id: 'p1', label: 'web01', hostname: 'web01', ipv4: '192.168.1.11/24', gateway: '192.168.1.1', nameservers: '1.1.1.1,8.8.8.8', disk: 'S3Y1NB0K123456' },
          { id: 'p2', label: 'web02', hostname: 'web02', ipv4: '192.168.1.12/24', gateway: '192.168.1.1', nameservers: '1.1.1.1,8.8.8.8', disk: 'S3Y1NB0K123457' },
          { id: 'p3', label: 'db01', hostname: 'db01', ipv4: '192.168.1.21/24', gateway: '192.168.1.1', nameservers: '1.1.1.1', disk: 'S3Y1NB0K123458' },
          { id: 'p4', label: 'gpu01', hostname: 'gpu01', ipv4: '192.168.1.31/24', gateway: '192.168.1.1', nameservers: '1.1.1.1', disk: 'S3Y1NB0K123459' },
        ],
      },
    }),
    expect: (r) => {
      // プレースホルダは廃止。YAML には既定値が入り、early-commands が差し替える。
      check('C3: hostname は既定値のまま', at(r.autoinstall, 'identity.hostname') === 'fallback-host')
      check('C3: プレースホルダが残らない', !JSON.stringify(at(r.autoinstall, 'identity')).includes('@@AI_'))
      check('C3: early-commands で置換する', JSON.stringify(at(r.autoinstall, 'early-commands')).includes(KERNEL_ARG.hostname))
      for (const h of ['web01', 'web02', 'db01', 'gpu01']) {
        check(`C3: grub に ${h} の項目がある`, r.grubCfg.includes(`${KERNEL_ARG.hostname}=${h}`))
      }
      check('C3: 手入力の項目もある', r.grubCfg.includes(`${KERNEL_ARG.interactive}=1`))
      check('C3: grub が 2048 バイトに収まる', r.grubFree >= 0, `残り ${r.grubFree}`)
      check('C3: 元の menuentry も残る', r.grubCfg.includes('Try or Install Ubuntu Server'))
    },
  },
  {
    id: 'C4-interactive',
    title: 'インストーラ画面で手入力（interactive-sections）',
    heavy: false,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-interactive' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
      runtimeValues: { ...b.runtimeValues, hostname: 'interactive', network: 'interactive', disk: 'interactive' },
    }),
    expect: (r) => {
      const sections = at(r.autoinstall, 'interactive-sections')
      check('C4: identity/network/storage が対話になる', JSON.stringify(sections) === '["identity","network","storage"]', JSON.stringify(sections))
    },
  },
  {
    id: 'C5-interactive-all',
    title: '全項目を画面で確認する（["*"]）',
    heavy: false,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-all' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
      behavior: { ...b.behavior, interactiveAll: true },
    }),
    expect: (r) => {
      // 22.04 は ["*"] の展開が確認できていないので出さない（警告を出して黙って落とさない）
      const supported = r.profile.series !== '22.04'
      eq(
        'C5: interactive-sections が ["*"]',
        JSON.stringify(at(r.autoinstall, 'interactive-sections')),
        supported ? '["*"]' : undefined,
      )
      if (!supported) {
        check(
          'C5: 22.04 では警告が出る',
          validateProfile(r.profile).issues.some((i) => i.field === 'behavior.interactiveAll'),
        )
      }
    },
  },
  {
    id: 'C6-advanced',
    title: '上級者向けキー総当たり（kernel/apt/swap/reset/error/debconf/reporting/AD）',
    heavy: true,
    build: (b, ctx) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-adv' },
      user: {
        ...b.user,
        username: 'e2e',
        passwordHash: HASH,
        groups: ctx.series === '26.04' ? { mode: 'append', groups: ['docker', 'libvirt'] } : { mode: 'default' },
      },
      software: {
        ...b.software,
        kernel: { mode: 'flavor', flavor: 'hwe' },
        searchDrivers: true,
        codecs: true,
        oem: 'no',
      },
      apt: {
        ...b.apt,
        mode: 'country-mirror',
        sources: [
          { id: 'a1', name: 'ondrej-php', source: 'ppa:ondrej/php', key: '' },
          {
            id: 'a2',
            name: 'internal.list',
            source: 'deb [signed-by=/etc/apt/keyrings/internal.gpg] https://apt.example.local/ubuntu $RELEASE main',
            key: '',
          },
        ],
        fallback: 'offline-install',
        preserveSourcesList: false,
      },
      storage:
        b.storage.mode === 'raw'
          ? b.storage
          : { ...b.storage, swap: { mode: 'size', size: '4G' }, resetPartition: { enabled: true, size: '12G' } },
      postInstall: {
        ...b.postInstall,
        errorCommands: ['curl -fsS -m 10 -X POST https://hooks.example.local/failed || true'],
        collectLogsOnError: true,
        debconfSelections: 'postfix postfix/main_mailer_type select No configuration',
      },
      activeDirectory: { enabled: true, adminName: 'Administrator', domainName: 'corp.example.com' },
      behavior: {
        ...b.behavior,
        refreshInstaller: true,
        refreshInstallerChannel: 'stable/ubuntu-24.04',
        reporting: { kind: 'webhook', endpoint: 'https://hooks.example.local/install' },
      },
      advanced: { ...b.advanced, extraKernelArgs: 'net.ifnames=0 fsck.mode=skip' },
    }),
    expect: (r) => {
      eq('C6: kernel.flavor', at(r.autoinstall, 'kernel.flavor'), 'hwe')
      check('C6: apt.sources に PPA が入る', JSON.stringify(at(r.autoinstall, 'apt.sources')).includes('ppa:ondrej/php'))
      // apt.fallback は 22.04 のスキーマに無いので出さない（黙って無視されるため）。
      // 24.04 以降は既定に頼らず必ず明示する（公式リファレンスが同じ文書の中で
      // 「default: offline-install」と「既定は fallback: abort」で食い違っている）。
      eq(
        'C6: apt.fallback',
        at(r.autoinstall, 'apt.fallback'),
        r.profile.series === '22.04' ? undefined : 'offline-install',
      )
      eq('C6: swap size', at(r.autoinstall, 'storage.swap.size'), '4G')
      check('C6: error-commands がある', Array.isArray(at(r.autoinstall, 'error-commands')))
      check('C6: 失敗時ログ収集が入る', JSON.stringify(at(r.autoinstall, 'error-commands')).includes('installer-logs.tar.gz'))
      check('C6: debconf-selections がある', has(r.autoinstall, 'debconf-selections'))
      eq('C6: reporting は webhook', at(r.autoinstall, 'reporting.hook.type'), 'webhook')
      eq('C6: refresh-installer.channel', at(r.autoinstall, 'refresh-installer.channel'), 'stable/ubuntu-24.04')
      check('C6: 追加のカーネル引数が grub に入る', r.grubCfg.includes('net.ifnames=0') && r.grubCfg.includes('fsck.mode=skip'))
    },
  },
  {
    id: 'C7-provisioning',
    title: 'プロビジョニング一式（追加ユーザー/展開/サービス/GPU/ファイル）',
    heavy: true,
    build: (b, ctx) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-prov', locale: 'ja_JP.UTF-8', timezone: 'Asia/Tokyo' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH, sudoNoPassword: true },
      ssh: { installServer: true, authorizedKeys: [SSH_KEY], allowPasswordAuth: false },
      software: {
        ...b.software,
        packages: ['git', 'curl', 'build-essential'],
        snaps: [{ name: 'lxd', channel: '5.21/stable' }],
        gpu: { ...b.software.gpu, enabled: true, driver: 'open', toolkit: 'latest', setupPath: true, containerToolkit: true },
      },
      postInstall: {
        ...b.postInstall,
        presets: ['chrony-ntp', 'qemu-guest-agent', 'docker-ce', 'ssh-harden', 'sudo-nopasswd'],
        aptFullUpgrade: true,
        lateCommands: ['echo e2e >> /etc/issue'],
        firstBootCommands: ['echo first-boot >> /var/log/e2e.log'],
        files: [{ name: 'motd.txt', targetPath: '/etc/motd', mode: '0644', owner: 'root', content: 'e2e\n' }],
        additionalUsers: [
          {
            id: 'u1',
            username: 'deploy',
            realname: 'Deploy',
            passwordHash: HASH,
            sudo: 'nopasswd',
            groups: ['docker'],
            shell: '/bin/bash',
            sshAuthorizedKeys: [SSH_KEY],
            createHome: true,
            systemAccount: false,
          },
          {
            id: 'u2',
            username: 'svcacct',
            realname: 'Service account',
            passwordHash: '',
            sudo: 'none',
            groups: [],
            shell: '/usr/sbin/nologin',
            sshAuthorizedKeys: [],
            createHome: false,
            systemAccount: true,
          },
        ],
        deployments: [
          {
            id: 'd1',
            kind: 'archive',
            name: 'myapp.tar.gz',
            source: { kind: 'host-file', path: ctx.payloadPath, sizeBytes: ctx.payloadSize },
            targetPath: '/opt/myapp',
            owner: 'deploy',
            group: 'deploy',
            mode: '0644',
            archiveFormat: 'tar.gz',
            postCommand: 'chmod +x bin/server',
            chownRecursive: true,
          },
        ],
        services: [
          {
            id: 's1',
            name: 'myapp',
            description: 'E2E service',
            execStart: '/opt/myapp/bin/server',
            execStartPre: '',
            workingDirectory: '/opt/myapp',
            user: 'deploy',
            group: 'deploy',
            environment: ['NODE_ENV=production'],
            environmentFile: '',
            serviceType: 'simple',
            restart: 'on-failure',
            restartSec: 5,
            after: ['network-online.target'],
            wantedBy: 'multi-user.target',
            enabled: true,
          },
        ],
      },
    }),
    expect: (r) => {
      const late = JSON.stringify(at(r.autoinstall, 'late-commands'))
      check('C7: 追加ユーザーを作る', late.includes('useradd'))
      check('C7: システムアカウントは useradd -r', /useradd [^"]*-r /.test(late))
      check('C7: アーカイブを展開する', late.includes('tar -xzf'))
      // サービス名も自由入力なのでクォートされた形で出る
      check('C7: サービスを有効化する', late.includes("systemctl enable 'myapp.service'"))
      check('C7: CIDATA を自前でマウントする', late.includes('mount -L CIDATA'))
      check('C7: /cdrom を seed に使わない', !late.includes('/cdrom'))
    },
  },
  {
    id: 'C8-raw',
    title: '生の curtin/netplan/YAML 上書き',
    heavy: false,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-raw' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
      network: { mode: 'raw', yaml: 'version: 2\nethernets:\n  enp1s0:\n    dhcp4: true\n    dhcp6: false\n' },
      storage: {
        mode: 'raw',
        yaml: [
          'config:',
          '  - {type: disk, id: disk0, ptable: gpt, match: {size: largest}, wipe: superblock-recursive, grub_device: false, preserve: false}',
          '  - {type: partition, id: p-esp, device: disk0, size: 1G, flag: boot, grub_device: true, preserve: false}',
          '  - {type: format, id: f-esp, volume: p-esp, fstype: fat32, preserve: false}',
          '  - {type: partition, id: p-root, device: disk0, size: -1, preserve: false}',
          '  - {type: format, id: f-root, volume: p-root, fstype: ext4, preserve: false}',
          '  - {type: mount, id: m-root, device: f-root, path: /}',
          '  - {type: mount, id: m-esp, device: f-esp, path: /boot/efi}',
          '',
        ].join('\n'),
      },
      advanced: { ...b.advanced, rawOverlayYaml: 'shutdown: poweroff\ntimezone: Etc/UTC\n' },
    }),
    expect: (r) => {
      check('C8: 生の curtin config が入る', Array.isArray(at(r.autoinstall, 'storage.config')))
      eq('C8: netplan が置き換わる', at(r.autoinstall, 'network.ethernets.enp1s0.dhcp4'), true)
      eq('C8: 上書き YAML が効く', at(r.autoinstall, 'shutdown'), 'poweroff')
      eq('C8: 上書き YAML が効く (timezone)', at(r.autoinstall, 'timezone'), 'Etc/UTC')
    },
  },
  {
    id: 'C9-mixed-runtime',
    title: 'ホスト名だけ起動メニュー、ディスクだけ手入力（モード混在）',
    heavy: false,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'mixed-default' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
      storage:
        b.storage.mode === 'raw'
          ? b.storage
          : { ...b.storage, match: { kind: 'serial', serial: 'FALLBACKSERIAL01' } },
      runtimeValues: {
        hostname: 'kernel-arg',
        network: 'fixed',
        disk: 'interactive',
        offerInteractiveEntry: false,
        presets: [
          { id: 'm1', label: 'node-a', hostname: 'node-a', ipv4: '', gateway: '', nameservers: '', disk: '' },
          { id: 'm2', label: 'node-b', hostname: 'node-b', ipv4: '', gateway: '', nameservers: '', disk: '' },
        ],
      },
    }),
    expect: (r) => {
      check('C9: hostname は既定値のまま', at(r.autoinstall, 'identity.hostname') === 'mixed-default')
      eq('C9: storage だけ対話', JSON.stringify(at(r.autoinstall, 'interactive-sections')), '["storage"]')
      check('C9: 手入力の項目は出さない', !r.grubCfg.includes(`${KERNEL_ARG.interactive}=1`))
      check('C9: node-a / node-b がメニューにある', r.grubCfg.includes('ai.hostname=node-a') && r.grubCfg.includes('ai.hostname=node-b'))
    },
  },
  {
    id: 'C10-grub-overflow',
    title: 'ホストを詰め込みすぎたときに 2048 バイト制限で止まる',
    heavy: false,
    build: (b) => ({
      ...b,
      basics: { ...b.basics, hostname: 'e2e-overflow' },
      user: { ...b.user, username: 'e2e', passwordHash: HASH },
      storage:
        b.storage.mode === 'raw'
          ? b.storage
          : { ...b.storage, match: { kind: 'serial', serial: 'FALLBACKSERIAL01' } },
      runtimeValues: {
        hostname: 'kernel-arg',
        network: 'kernel-arg',
        disk: 'kernel-arg',
        offerInteractiveEntry: true,
        presets: Array.from({ length: 40 }, (_, i) => ({
          id: `o${i}`,
          label: `very-long-host-name-${String(i).padStart(3, '0')}`,
          hostname: `very-long-host-name-${String(i).padStart(3, '0')}`,
          ipv4: `192.168.${Math.floor(i / 254)}.${(i % 254) + 1}/24`,
          gateway: '192.168.0.1',
          nameservers: '1.1.1.1,8.8.8.8,9.9.9.9',
          disk: `SERIALNUMBER${String(i).padStart(8, '0')}`,
        })),
      },
    }),
    // grub があふれるケースなので expect ではなく専用の検査を main 側で行う
  },
]

// ---------------------------------------------------------------------------
// 1 ケースの実行
// ---------------------------------------------------------------------------

interface IsoContext {
  readonly path: string
  readonly series: UbuntuSeries
  readonly device: FileBlockDevice
  readonly inspection: Awaited<ReturnType<typeof inspectIso>>
  readonly sizeBytes: number
}

async function runCase(
  c: Case,
  iso: IsoContext,
  ctx: CaseContext,
  workDir: string,
  fullWrite: boolean,
): Promise<void> {
  const base = createDefaultProfile(iso.series, 'e2e/0.1.0', '2026-09-04T00:00:00.000Z')
  const profile = c.build(base, ctx)

  // --- 検証 ---
  const validation = validateProfile(profile)
  if (c.id !== 'C10-grub-overflow') {
    check(
      `${c.id}: プロファイル検証を通る`,
      validation.issues.every((i) => i.severity !== 'error'),
      validation.issues.filter((i) => i.severity === 'error').map((i) => i.messageJa).join(' / '),
    )
  }

  // --- 生成 ---
  const userData = generateUserData(profile, { comments: 'ja' })
  check(`${c.id}: user-data が #cloud-config で始まる`, userData.startsWith('#cloud-config\n'))
  const ai = autoinstallFromUserData(userData) as Record<string, unknown>
  check(`${c.id}: autoinstall セクションが取り出せる`, ai !== undefined && typeof ai === 'object')
  if (!ai) return

  // --- 公式スキーマ ---
  const errors = validatorFor(iso.series)(ai)
  check(
    `${c.id}: subiquity ${iso.series} のスキーマを通る`,
    errors === null,
    errors?.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join(' / '),
  )

  // --- grub ---
  const grubPlan = buildGrubPlan(profile)
  let grubCfg = ''
  let grubFree = 0
  let overflowed = false
  try {
    const patchPlan = buildIsoPatches(iso.inspection, {
      args: grubPlan.args,
      markTitle: true,
      extraEntries: grubPlan.entries,
    })
    grubCfg = patchPlan.newGrubCfg
    grubFree = remainingGrubBytes(grubCfg)
  } catch (err) {
    if (err instanceof IsoValidationError && err.reason === 'grub-too-large') overflowed = true
    else throw err
  }

  if (c.id === 'C10-grub-overflow') {
    check(`${c.id}: 収まらない設定は分かるエラーで止まる`, overflowed)
    return
  }
  check(`${c.id}: grub.cfg が 1 セクタに収まる`, !overflowed && grubFree >= 0, `残り ${grubFree} バイト`)
  if (overflowed) return

  const result: CaseResult = { profile, userData, autoinstall: ai, grubCfg, grubFree }
  c.expect?.(result)

  // --- CIDATA の中身（書き込みなしで検証できる） ---
  const seedFiles = [
    { name: 'user-data', content: Buffer.from(userData, 'utf8') },
    { name: 'meta-data', content: Buffer.from(generateMetaData(`autoinstall-${profile.basics.hostname}`), 'utf8') },
  ]
  for (const f of profile.postInstall.files) {
    seedFiles.push({ name: f.name, content: Buffer.from(f.content, 'utf8') })
  }
  for (const d of profile.postInstall.deployments) {
    if (d.source.kind === 'host-file') {
      seedFiles.push({ name: d.name, content: Buffer.from(readFileSync(d.source.path)) })
    }
  }

  const patches = buildIsoPatches(iso.inspection, {
    args: grubPlan.args,
    markTitle: true,
    extraEntries: grubPlan.entries,
  }).patches
  const diskSize = Math.max(minimumDiskSize(iso.sizeBytes), 8 * 1000 * 1000 * 1000)
  const plan = await planUsbLayout({
    isoDevice: iso.device,
    diskSizeBytes: diskSize,
    patches,
    seedFiles,
    random: () => randomBytes(16),
    timestamp: new Date('2026-09-04T00:00:00Z'),
  })
  check(`${c.id}: CIDATA が 1 MiB 境界に載る`, (plan.cidata.startLba * SECTOR_SIZE) % (1024 * 1024) === 0)

  // 書き込みを待たずに CIDATA の FAT を読み戻す
  const cidataOp = plan.ops.find((o) => o.kind === 'bytes' && o.diskOffset === plan.cidata.startLba * SECTOR_SIZE)
  check(`${c.id}: CIDATA イメージが計画に含まれる`, cidataOp !== undefined)
  if (cidataOp && cidataOp.kind === 'bytes') {
    const fs = readFatImage(cidataOp.data)
    eq(`${c.id}: CIDATA のラベル`, fs.label, 'CIDATA')
    for (const want of seedFiles) {
      const got = fs.files.find((f) => f.name === want.name)
      check(`${c.id}: CIDATA に ${want.name} がある`, got !== undefined)
      if (got) check(`${c.id}: ${want.name} がバイト一致`, got.content.equals(want.content))
    }
  }

  if (!(c.heavy || fullWrite)) return

  // --- 実書き込み（.img）と読み戻し ---
  const imagePath = join(workDir, `${c.id}-${iso.series}.img`)
  const target = await FileBlockDevice.open(imagePath, 'w+')
  const started = Date.now()
  try {
    const wrote = await executeWritePlan({
      plan,
      isoDevice: iso.device,
      targetDevice: target,
      patches,
      verify: true,
    })
    check(`${c.id}: 読み戻し検証に成功`, wrote.verified)
    process.stdout.write(
      `       ${c.id} … ${(wrote.bytesWritten / 1e9).toFixed(2)} GB / ${((Date.now() - started) / 1000).toFixed(1)} 秒\n`,
    )
  } finally {
    await target.close()
  }

  const img = await FileBlockDevice.open(imagePath, 'r')
  try {
    const mbr = parseMbr(await img.read(0, SECTOR_SIZE))
    check(`${c.id}: protective MBR がある`, mbr.valid && mbr.isProtective)
    check(`${c.id}: GRUB のブートコードが残る`, mbr.hasBootCode)
    const gpt = await readGpt(img)
    check(`${c.id}: GPT の CRC が正しい`, gpt !== null && gpt.headerCrcValid && gpt.entriesCrcValid)
    const backup = await readGpt(img, Math.floor(diskSize / SECTOR_SIZE) - 1)
    check(`${c.id}: バックアップ GPT が末尾にある`, backup !== null && backup.headerCrcValid)

    const structure = await readIsoStructure(img)
    const grub = await resolvePath(img, structure.pvd.rootRecord, '/boot/grub/grub.cfg')
    check(`${c.id}: grub.cfg が解決できる`, grub !== null)
    const grubText = (await readIsoFile(img, grub!.record)).toString('utf8')
    eq(`${c.id}: grub.cfg が計画どおり`, grubText, grubCfg)

    const md5 = await resolvePath(img, structure.pvd.rootRecord, '/md5sum.txt')
    const md5Text = (await readIsoFile(img, md5!.record)).toString('utf8')
    const line = md5Text.split('\n').find((l) => l.endsWith('  ./boot/grub/grub.cfg'))
    eq(
      `${c.id}: md5sum.txt が更新されている`,
      line?.slice(0, 32),
      createHash('md5').update(Buffer.from(grubText, 'utf8')).digest('hex'),
    )

    const gptRead = (await readGpt(img))!
    const cidata = gptRead.entries.find((e) => e.name === CIDATA_LABEL)!
    const fs = readFatImage(
      await img.read(cidata.startLba * SECTOR_SIZE, (cidata.endLba - cidata.startLba + 1) * SECTOR_SIZE),
    )
    eq(
      `${c.id}: 書き戻した user-data が一致`,
      fs.files.find((f) => f.name === 'user-data')!.content.toString('utf8'),
      userData,
    )
  } finally {
    await img.close()
    await rm(imagePath, { force: true })
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const REJECT_ISOS = [
  'ubuntu-22.04.5-desktop-amd64.iso',
  'ubuntu-24.04.3-desktop-amd64.iso',
  'proxmox-ve_9.1-1.iso',
  'Windows Vista Ultimate 64bit.iso',
]
const SERVER_ISOS: { name: string; series: UbuntuSeries }[] = [
  { name: 'ubuntu-22.04.5-live-server-amd64.iso', series: '22.04' },
  { name: 'ubuntu-24.04.3-live-server-amd64.iso', series: '24.04' },
]

async function main(): Promise<void> {
  const fullWrite = process.argv.includes('--full')
  if (process.argv.includes('--list')) {
    for (const c of CASES) console.log(`${c.id}\t${c.heavy ? '書き込みあり' : '検証のみ'}\t${c.title}`)
    return
  }
  const imagesDir = join(homedir(), 'images')

  // --- 0. デバイス列挙と安全判定（実機） ---
  console.log('■ デバイス列挙と安全判定')
  const devices = await getPlatformOps().listDevices()
  check('デバイスを列挙できる', devices.length > 0)
  const system = devices.filter((d) => d.isSystem)
  check('システムディスクが 1 台以上見つかる', system.length > 0)
  for (const d of system) {
    check(`システムディスク ${d.id} は選べない`, !d.selectable, d.blockedReason ?? '')
  }
  const usb = devices.filter((d) => d.bus === 'usb' && !d.isSystem)
  check('USB デバイスが見つかる', usb.length > 0)
  for (const d of usb) {
    console.log(`  ${d.id} ${d.description} ${(d.sizeBytes / 1e9).toFixed(1)} GB selectable=${d.selectable}`)
    check(`USB ${d.id} が書き込み候補になる`, d.selectable, d.blockedReason ?? '')
  }

  // --- 1. ISO の受理・拒否（実 ISO） ---
  console.log('\n■ ISO の受理と拒否')
  for (const name of REJECT_ISOS) {
    const p = join(imagesDir, name)
    try {
      await stat(p)
    } catch {
      continue
    }
    const dev = await FileBlockDevice.open(p, 'r')
    try {
      const inspection = await inspectIso(dev).catch((e: unknown) => e)
      if (inspection instanceof IsoValidationError) {
        check(`拒否: ${name}`, true)
        console.log(`  ${name} → ${inspection.reason}`)
      } else if (inspection instanceof Error) {
        check(`拒否: ${name} が分かるエラーになる`, false, inspection.message)
      } else {
        const r = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
        check(`拒否: ${name}`, r.kind === 'unsupported', inspection.volumeId)
        if (r.kind === 'unsupported') console.log(`  ${name} → ${r.reason}`)
      }
    } finally {
      await dev.close()
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), 'autoinstall-e2e-'))
  const payloadPath = join(workDir, 'myapp.tar.gz')
  const payload = Buffer.from(`e2e-archive-${'x'.repeat(64 * 1024)}`, 'utf8')
  await writeFile(payloadPath, payload)

  try {
    for (const { name, series } of SERVER_ISOS) {
      const path = join(imagesDir, name)
      try {
        await stat(path)
      } catch {
        console.log(`\n(見つからないので飛ばす) ${name}`)
        continue
      }
      isosProcessed++
      console.log(`\n■ ${basename(path)} (${series})`)
      const device = await FileBlockDevice.open(path, 'r')
      try {
        const inspection = await inspectIso(device)
        const recognized = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
        check(`${series}: live-server として認識される`, recognized.kind === 'supported', inspection.volumeId)
        if (recognized.kind !== 'supported') continue
        eq(`${series}: シリーズが一致`, recognized.identity.series, series)
        const size = (await stat(path)).size
        const ctx: CaseContext = { series, payloadPath, payloadSize: payload.length }
        const isoCtx: IsoContext = { path, series, device, inspection, sizeBytes: size }
        for (const c of CASES) {
          await runCase(c, isoCtx, ctx, workDir, fullWrite)
          console.log(`  ✓ ${c.id} ${c.title}`)
        }
      } finally {
        await device.close()
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }

}

/**
 * 結果を出して終了コードを決める。**必ず main の外から呼ぶ。**
 * 早期 return や例外がここを飛ばすと、失敗が exit 0 になる。
 */
function report(): void {
  console.log(`\n${checks} 件中 ${checks - failures} 件成功、${failures} 件失敗`)
  if (failures > 0) {
    console.error('失敗:\n' + failed.map((f) => `  - ${f}`).join('\n'))
    process.exit(1)
  }
  // **ISO が 1 本も無いとループが 0 回まわって緑になる。**
  // 「10 パターンを網羅した」と読める出力を出しておきながら
  // 1 ケースも実行していない、という状態を成功にしない。
  if (isosProcessed === 0) {
    console.error(
      `\n実 ISO が 1 本も見つかりませんでした（${SERVER_ISOS.map((i) => i.name).join(' / ')}）。\n` +
        'ケースを 1 件も実行していないので、この結果は「通った」ことを意味しません。',
    )
    process.exit(1)
  }
}

void main()
  .then(report)
  .catch((err: unknown) => {
    console.error(err)
    failures++
    failed.push('スクリプトが例外で終了した')
    report()
  })
