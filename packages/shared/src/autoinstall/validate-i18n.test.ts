import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultProfile } from './defaults.js'
import { createDefaultRaidStorage } from './raid.js'
import { createDefaultBondNetwork } from './bond.js'
import { validateProfile } from './validate.js'
import { en, formatLocalized, ja, localized, LOCALES, placeholdersOf } from '../i18n/index.js'
import type { MsgKey } from '../i18n/index.js'
import type { AutoinstallProfile } from './model.js'
import type { ValidationIssue } from './validate.js'

// ===========================================================================
// 検証の指摘 (`ValidationIssue.text`) が辞書を通っていることの番人
// ===========================================================================
//
// 以前 `ValidationIssue` は `messageJa` / `messageEn` という**両方の言語の文字列**を
// 同時に持っていた。辞書を通らないので:
//   - `i18n.test.ts` のキー一致・差し込み名の集合・文字体系の検査が**効かなかった**。
//     英訳漏れも日本語の混入も、機械が 1 つも検出できない場所だった。
//   - 差し込み値を言語ごとに文字列連結していたので、**同じ間違いを 2 回書けた**。
//
// いまは辞書のキー + 差し込み値で運ぶ。壊れ方は 2 通りあり、両方をここで見る:
//   (A) 辞書に無いキーを渡す → 画面に `validate.fooBar` という英数字が出る。
//       「英語に日本語が残っていないか」だけを見る検査は**素通りする**。
//   (B) 差し込み値を渡し忘れる → 画面に `{name}` が残る。
//
// 静的な走査（下の describe）と、実際に `validateProfile` を呼んで集めた
// 指摘の両方で見る。走査だけだと「呼ばれない分岐のキー」を見逃さない代わりに
// 差し込み値の渡し忘れを見ないし、実行だけだと踏めない分岐が漏れる。

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

/** ソースを ASCII に保つため \u エスケープで書く（落とし穴 44）。 */
const JAPANESE = /[\u3041-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/

const dict = (locale: 'ja' | 'en'): Record<string, string | undefined> =>
  (locale === 'ja' ? ja : en) as unknown as Record<string, string | undefined>

function base(series: AutoinstallProfile['series'] = '24.04'): AutoinstallProfile {
  const p = createDefaultProfile(series)
  return {
    ...p,
    basics: { ...p.basics, hostname: 'h1' },
    user: { ...p.user, username: 'opsuser', passwordHash: HASH },
  }
}

/** 型を外して壊す。手で編集された JSON が届く前提の検証なので、これが現実の入力。 */
const broken = (p: unknown): AutoinstallProfile => p as AutoinstallProfile

function file(over: Record<string, unknown> = {}): unknown {
  return { name: 'app.conf', targetPath: '/etc/app.conf', mode: '0644', owner: 'root', content: 'x', ...over }
}

function deployment(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'd1',
    kind: 'archive',
    name: 'app.tar.gz',
    source: { kind: 'inline', content: 'x' },
    targetPath: '/opt/app',
    owner: 'root',
    group: 'root',
    mode: '0644',
    archiveFormat: 'tar.gz',
    postCommand: '',
    chownRecursive: false,
    ...over,
  }
}

function service(over: Record<string, unknown> = {}): unknown {
  return {
    id: 's1',
    name: 'myapp',
    description: '',
    execStart: '/usr/bin/true',
    execStartPre: '',
    workingDirectory: '',
    user: '',
    group: '',
    environment: [],
    environmentFile: '',
    serviceType: 'simple',
    restart: 'on-failure',
    restartSec: 5,
    after: [],
    wantedBy: 'multi-user.target',
    enabled: true,
    ...over,
  }
}

function user(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'u1',
    username: 'appuser',
    realname: '',
    passwordHash: HASH,
    sudo: 'none',
    groups: [],
    shell: '/bin/bash',
    sshAuthorizedKeys: [],
    createHome: true,
    systemAccount: false,
    ...over,
  }
}

function host(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'h1',
    label: 'web01',
    hostname: 'web01',
    ipv4: '192.168.1.11/24',
    gateway: '192.168.1.1',
    nameservers: '192.168.1.1',
    disk: 'SERIAL123',
    ...over,
  }
}

/** RAID の 1 行。判別可能ユニオン (`match`) を含むので、既定に重ねずに毎回書く。 */
function rdisk(over: Record<string, unknown> = {}): unknown {
  return { id: 'd1', match: { kind: 'serial', serial: 'S1' }, boot: true, ...over }
}

function rarray(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'a1',
    name: 'md0',
    level: 'raid1',
    role: 'lvm-pv',
    diskIds: ['d1', 'd2'],
    spareDiskIds: [],
    ...over,
  }
}

/** `mode: 'bond'` のネットワーク設定。指定しなかったキーは既定のまま。 */
function bondNetwork(over: Record<string, unknown> = {}): unknown {
  const base = createDefaultBondNetwork()
  const params = isRecord(over['parameters']) ? over['parameters'] : {}
  return {
    ...base,
    ...over,
    parameters: { ...base.parameters, ...params },
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** bond のメンバー 1 行。判別可能ユニオン (`selector`) を含むので毎回書く。 */
function bmember(id: string, selector: Record<string, unknown>): unknown {
  return { id, selector }
}

/** `mode: 'raid'` のストレージ設定。RAID 以外のキーは既定のまま。 */
function raidStorage(over: Record<string, unknown> = {}): unknown {
  const p = createDefaultProfile('24.04')
  if (p.storage.mode === 'raw') throw new Error('既定が raw になっている')
  return { ...p.storage, mode: 'raid', raid: { ...createDefaultRaidStorage(), ...over } }
}

/**
 * 壊し方の一覧。**網羅ではない**（分岐は 121 本ある）ので、下の走査のほうが
 * 「どのキーも辞書にある」を全部について見る。ここが見るのは
 * 「実際に組み立てた指摘が両方の言語で読める」ことと、差し込みの渡し忘れ。
 */
const MUTATIONS: Record<string, () => AutoinstallProfile> = {
  '空の既定': () => createDefaultProfile('24.04'),
  '固定値だけなのにホストを登録している': () =>
    broken({
      ...base(),
      runtimeValues: {
        ...base().runtimeValues,
        hostname: 'fixed',
        network: 'fixed',
        disk: 'fixed',
        presets: [
          { id: 'a', label: 'h1', hostname: 'a', ipv4: '', gateway: '', nameservers: '', disk: '' },
        ],
      },
    }),
  'ホスト名とユーザー名が不正': () =>
    broken({
      ...base(),
      basics: { ...base().basics, hostname: 'BAD_HOST!', locale: '', keyboard: { layout: '', variant: '', toggle: null } },
      user: { ...base().user, username: 'root', passwordHash: 'plaintext' },
    }),
  'ユーザー名とホスト名が同じ': () =>
    broken({ ...base(), basics: { ...base().basics, hostname: 'opsuser' } }),
  '予約ユーザー名': () => broken({ ...base(), user: { ...base().user, username: 'admin' } }),
  'SSH で締め出される': () =>
    broken({
      ...base(),
      ssh: { installServer: true, authorizedKeys: ['not a key'], allowPasswordAuth: false },
      postInstall: { ...base().postInstall, presets: ['ssh-harden', 'sudo-nopasswd', 'made-up-preset'] },
    }),
  'SSH 鍵はあるがサーバーを入れない': () =>
    broken({ ...base(), ssh: { installServer: false, authorizedKeys: ['ssh-ed25519 AAAAC3 x'], allowPasswordAuth: true } }),
  '固定 IP が壊れている': () =>
    broken({
      ...base(),
      network: { mode: 'static', target: { kind: 'name', name: '' }, address: 'nope', gateway: 'nope', nameservers: ['nope'], optional: true },
      software: { ...base().software, snaps: [{ name: 'hello' }] },
    }),
  'NIC の指定が壊れている': () =>
    broken({ ...base(), network: { mode: 'dhcp', target: { kind: 'name', name: '1bad' }, optional: true } }),
  'MAC が壊れている': () =>
    broken({ ...base(), network: { mode: 'dhcp', target: { kind: 'mac', macaddress: 'zz' }, optional: true } }),
  '生 YAML が壊れている': () =>
    broken({
      ...base(),
      network: { mode: 'raw', yaml: 'a: [' },
      storage: { ...base().storage, mode: 'raw', yaml: 'b: [' },
    }),
  'ディスク指定が空': () =>
    broken({ ...base(), storage: { ...base().storage, match: { kind: 'serial' } } }),
  'どのディスクでもよい': () =>
    broken({ ...base(), storage: { ...base().storage, match: { kind: 'any' } } }),
  '最大のディスク': () =>
    broken({ ...base(), storage: { ...base().storage, match: { kind: 'largest' } } }),
  '暗号化パスフレーズ': () =>
    broken({
      ...base(),
      storage: { ...base().storage, mode: 'zfs', encryptionPassphrase: 'ab', swap: { mode: 'size', size: 'nope' } },
    }),
  '暗号化を LVM 以外で': () =>
    broken({ ...base(), storage: { ...base().storage, mode: 'direct', encryptionPassphrase: 'longenough' } }),
  // ディスク全体を使う指定も `sizing-policy`（lvm 専用）にしかならない。
  // スイッチが LVM のときしか描画されないので、件数にも要約にも出ない。
  // ここで踏ませておかないと、検証だけが黙る形に戻っても誰も気づかない。
  'ディスク全体を LVM 以外で': () =>
    broken({ ...base(), storage: { ...base().storage, mode: 'zfs', useWholeDisk: true } }),
  'リセットパーティション (22.04)': () =>
    broken({
      ...base('22.04'),
      storage: { ...base('22.04').storage, resetPartition: { enabled: true, size: 'nope' } },
      apt: { ...base('22.04').apt, fallback: 'continue-anyway' },
      software: {
        ...base('22.04').software,
        sourceId: 'ubuntu-server-minimal',
        kernelCrashDumps: true,
        ubuntuProToken: 'nope',
        // 22.04 は features.source / features.codecsOemAd が false。
        // 例外表に足すのではなく踏ませる（落とし穴 81）。
        searchDrivers: false,
        codecs: true,
        oem: 'yes',
      },
      user: { ...base('22.04').user, groups: { mode: 'override', groups: ['users'] } },
      activeDirectory: { enabled: true, adminName: '', domainName: '' },
    }),
  'グループ上書きに sudo が無い (26.04)': () =>
    broken({
      ...base('26.04'),
      user: { ...base('26.04').user, groups: { mode: 'override', groups: ['users'] } },
      activeDirectory: { enabled: true, adminName: '', domainName: '' },
    }),
  '追加ファイルが壊れている': () =>
    broken({
      ...base(),
      postInstall: {
        ...base().postInstall,
        files: [
          file({ targetPath: 'etc/app.conf', mode: '999', name: 'bad/name', owner: 'ghost' }),
          file({ name: 'other.conf', owner: 'no owner!' }),
        ],
      },
    }),
  '展開が壊れている': () =>
    broken({
      ...base(),
      postInstall: {
        ...base().postInstall,
        deployments: [
          deployment({ kind: 'file', targetPath: 'opt/app', mode: '999', name: 'bad/name', owner: 'ghost', group: 'BAD!' }),
          deployment({ id: 'd0', name: 'e.rar', archiveFormat: 'rar' }),
          deployment({ id: 'd2', name: 'b.tar.gz', source: { kind: 'url', url: 'ftp://x', sha256: '' } }),
          deployment({ id: 'd3', name: 'c.tar.gz', source: { kind: 'url', url: 'https://x/y', sha256: 'zz' } }),
          deployment({ id: 'd4', name: 'd.tar.gz', source: { kind: 'host-file', path: '', sizeBytes: 0 } }),
        ],
      },
    }),
  '追加ユーザーが壊れている': () =>
    broken({
      ...base(),
      postInstall: {
        ...base().postInstall,
        additionalUsers: [
          user({ username: '' }),
          user({ id: 'u2', username: 'BAD NAME' }),
          user({ id: 'u3', username: 'root' }),
          user({ id: 'u4', username: 'opsuser' }),
          user({ id: 'u5', username: 'plainpw', passwordHash: 'plaintext', sudo: 'nopasswd' }),
          user({ id: 'u6', username: 'badkey', sshAuthorizedKeys: ['nope'] }),
          user({ id: 'u7', username: 'nologin', passwordHash: '' }),
        ],
      },
    }),
  'サービスが壊れている': () =>
    broken({
      ...base(),
      postInstall: {
        ...base().postInstall,
        services: [
          service({ name: 'bad name.service', execStart: '' }),
          service({ id: 's2', name: 'myapp', execStart: 'true', user: 'ghost', group: 'ghosts', environment: ['nope'] }),
          service({ id: 's3', name: 'myapp' }),
        ],
      },
    }),
  'GPU (25.10)': () =>
    broken({
      ...base('25.10'),
      software: {
        ...base('25.10').software,
        gpu: { enabled: true, driver: 'none', toolkit: 'BAD NAME', containerToolkit: true },
      },
    }),
  'GPU で何も選んでいない': () =>
    broken({
      ...base(),
      software: { ...base().software, gpu: { enabled: true, driver: 'none', toolkit: 'none', containerToolkit: false } },
    }),
  '追加リポジトリが壊れている': () =>
    broken({
      ...base(),
      apt: {
        ...base().apt,
        mode: 'custom',
        primaryUri: '',
        preserveSourcesList: true,
        sources: [
          { id: 'a1', name: 'bad name', source: '', key: '' },
          { id: 'a2', name: 'dup', source: 'nonsense', key: '' },
          { id: 'a3', name: 'dup', source: 'deb https://example.invalid/ jammy main', key: '' },
        ],
      },
    }),
  'カーネル指定が空': () =>
    broken({
      ...base(),
      software: { ...base().software, kernel: { mode: 'flavor', flavor: '' }, oem: 'yes' },
    }),
  'カーネルのパッケージ名が空': () =>
    broken({ ...base(), software: { ...base().software, kernel: { mode: 'package', package: '' } } }),
  'カーネル引数が危険': () =>
    broken({ ...base(), advanced: { rawOverlayYaml: '', extraKernelArgs: 'a="b" ; c | d' } }),
  '上書き YAML が storage を奪う': () =>
    broken({ ...base(), advanced: { rawOverlayYaml: 'storage:\n  layout:\n    name: lvm\nidentity: {}\n', extraKernelArgs: '' } }),
  '上書き YAML が壊れている': () =>
    broken({ ...base(), advanced: { rawOverlayYaml: 'a:\n  - b\n c: [', extraKernelArgs: '' } }),
  '起動メニューのホストが壊れている': () =>
    broken({
      ...base(),
      network: { mode: 'dhcp', target: { kind: 'any' }, optional: true },
      storage: { ...base().storage, match: { kind: 'largest' } },
      runtimeValues: {
        hostname: 'kernel-arg',
        network: 'kernel-arg',
        disk: 'kernel-arg',
        offerInteractiveEntry: true,
        presets: [
          host({ label: 'bad "label" $', hostname: 'BAD!', ipv4: 'nope', gateway: 'nope', nameservers: 'nope', disk: '/dev/sda' }),
          host({ id: 'h2', label: 'web01', hostname: '', ipv4: '', gateway: '', nameservers: '', disk: '' }),
          host({ id: 'h3', label: 'web02', disk: 'bad disk!' }),
          host({ id: 'h4', label: 'web02' }),
        ],
      },
    }),
  '起動メニューだがホストが 1 つも無い': () =>
    broken({
      ...base('22.04'),
      network: { mode: 'static', target: { kind: 'any' }, address: '10.0.0.2/24', gateway: '', nameservers: [], optional: true },
      runtimeValues: { hostname: 'kernel-arg', network: 'kernel-arg', disk: 'fixed', offerInteractiveEntry: true, presets: [] },
      behavior: { ...base('22.04').behavior, interactiveAll: true },
    }),
  '起動メニューで生 YAML と併用': () =>
    broken({
      ...base(),
      network: { mode: 'raw', yaml: 'network: {}' },
      storage: { ...base().storage, mode: 'raw', yaml: 'config: []' },
      runtimeValues: { hostname: 'fixed', network: 'kernel-arg', disk: 'kernel-arg', offerInteractiveEntry: true, presets: [] },
    }),
  '必須項目が空': () =>
    broken({
      ...base(),
      basics: { ...base().basics, hostname: '' },
      user: { ...base().user, username: '', passwordHash: '$6$short' },
    }),
  'ユーザー名の形が不正': () =>
    broken({ ...base(), user: { ...base().user, username: 'Bad Name' } }),
  'SSH の鍵が 1 つも無い': () =>
    broken({
      ...base(),
      ssh: { installServer: true, authorizedKeys: [], allowPasswordAuth: false },
      postInstall: { ...base().postInstall, presets: ['ssh-harden'] },
    }),
  'ゲートウェイ無しでパッケージを入れる': () =>
    broken({
      ...base(),
      network: { mode: 'static', target: { kind: 'any' }, address: '10.0.0.2/24', gateway: '', nameservers: ['10.0.0.1'], optional: true },
      software: { ...base().software, packages: ['htop'] },
    }),
  // 更新が無効なのに channel が残っている（手で編集した JSON / 古いプロファイル）。
  // 入力欄は `refreshInstaller` が true のときしか描画されないので、
  // 画面から直す先が無い。それでも YAML には出る。
  'インストーラ更新が無効なのにチャンネルが残っている': () =>
    broken({
      ...base(),
      behavior: { ...base().behavior, refreshInstaller: false, refreshInstallerChannel: 'stable/ubuntu-24.04' },
    }),
  'reporting が壊れている': () =>
    broken({ ...base(), behavior: { ...base().behavior, reporting: { kind: 'webhook', endpoint: 'nope' } } }),
  'rsyslog の送信先が空': () =>
    broken({
      ...base(),
      behavior: { ...base().behavior, interactiveSections: ['storage'], reporting: { kind: 'rsyslog', destination: '' } },
    }),

  // --- RAID + LVM ---
  // ここが「どのディスクが消えるか」を決める場所なので、壊し方を多めに置く。
  'RAID: 何も設定していない': () => broken({ ...base(), storage: raidStorage() }),
  'RAID: ディスクが 1 台だけ': () =>
    broken({ ...base(), storage: raidStorage({ disks: [rdisk()] }) }),
  'RAID: 起動に使うディスクが無い': () =>
    broken({
      ...base(),
      storage: raidStorage({
        disks: [rdisk({ boot: false }), rdisk({ id: 'd2', boot: false })],
      }),
    }),
  'RAID: 内部 ID が重複': () =>
    broken({ ...base(), storage: raidStorage({ disks: [rdisk(), rdisk()] }) }),
  'RAID: 台数不足と曖昧なディスク指定': () =>
    broken({
      ...base(),
      storage: raidStorage({
        disks: [
          rdisk({ match: { kind: 'largest' } }),
          rdisk({ id: 'd2', match: { kind: 'any' } }),
          rdisk({ id: 'd3', match: { kind: 'serial', serial: '' } }),
        ],
        arrays: [rarray({ level: 'raid10', diskIds: ['d1', 'd2', 'd3'] })],
      }),
    }),
  'RAID: 配列の名前と参照が壊れている': () =>
    broken({
      ...base(),
      storage: raidStorage({
        disks: [rdisk(), rdisk({ id: 'd2' })],
        arrays: [
          rarray({ name: '', diskIds: ['d1', 'd1'], spareDiskIds: ['d1'] }),
          rarray({ id: 'a2', name: 'bad name!', diskIds: ['d1', 'd2'] }),
          rarray({ id: 'a3', name: 'md1', diskIds: ['d1', 'd2'] }),
          rarray({ id: 'a4', name: 'md1', diskIds: ['dX'] }),
        ],
      }),
    }),
  'RAID: /boot 配列が 2 つ・サイズと名前が不正': () =>
    broken({
      ...base(),
      storage: raidStorage({
        disks: [rdisk(), rdisk({ id: 'd2', boot: false })],
        arrays: [
          rarray({ id: 'ab', name: 'md0', role: 'boot' }),
          rarray({ id: 'ab2', name: 'md1', role: 'boot' }),
          rarray({ id: 'ap', name: 'md2', role: 'lvm-pv' }),
        ],
        espSize: 'nope',
        bootSize: 'nope',
        rootSize: 'nope',
        volumeGroup: '-bad',
        rootName: '-bad',
      }),
    }),
  'RAID: RAID0 とスペア': () =>
    broken({
      ...base(),
      storage: raidStorage({
        disks: [rdisk(), rdisk({ id: 'd2' }), rdisk({ id: 'd3' })],
        arrays: [rarray({ level: 'raid0', spareDiskIds: ['d3'] })],
      }),
    }),
  'RAID: LVM の配列が無い': () =>
    broken({
      ...base(),
      storage: raidStorage({
        disks: [rdisk(), rdisk({ id: 'd2' })],
        arrays: [rarray({ role: 'boot' })],
      }),
    }),
  'RAID: ブートローダを複製しない': () =>
    broken({
      ...base(),
      storage: raidStorage({
        disks: [rdisk(), rdisk({ id: 'd2' })],
        arrays: [rarray()],
        mirrorBootloader: false,
      }),
    }),
  // --- bond ---
  // ここが「どの NIC が束ねられるか」を決める場所なので、壊し方を多めに置く。
  'bond: 何も設定していない': () => broken({ ...base(), network: bondNetwork() }),
  'bond: メンバーの指定が壊れている': () =>
    broken({
      ...base(),
      network: bondNetwork({
        name: '',
        members: [
          bmember('m1', { kind: 'name', name: '' }),
          bmember('m2', { kind: 'name', name: '1bad' }),
          bmember('m3', { kind: 'mac', macaddress: 'zz' }),
          bmember('m4', { kind: 'nonsense' }),
          bmember('m5', { kind: 'any' }),
        ],
      }),
    }),
  'bond: 同じ NIC を 2 回・パラメータが壊れている': () =>
    broken({
      ...base(),
      network: bondNetwork({
        target: { kind: 'name', name: 'eno1' },
        members: [
          bmember('m1', { kind: 'name', name: 'eth0' }),
          bmember('m2', { kind: 'name', name: 'eth0' }),
          bmember('m3', { kind: 'name', name: 'bond0' }),
        ],
        addressing: 'magic',
        parameters: {
          mode: 'nonsense',
          transmitHashPolicy: 'BAD POLICY',
          miiMonitorInterval: 1.5,
        },
      }),
    }),
  'bond: 効かないパラメータとリンク監視なし': () =>
    broken({
      ...base(),
      network: bondNetwork({
        name: 'bad name!',
        members: [
          bmember('m1', { kind: 'name', name: 'eth0' }),
          bmember('m2', { kind: 'name', name: 'eth1' }),
        ],
        parameters: {
          mode: 'balance-rr',
          lacpRate: 'fast',
          transmitHashPolicy: 'layer3+4',
          miiMonitorInterval: 0,
        },
      }),
    }),
  'bond: LACP + 固定 IP': () =>
    broken({
      ...base(),
      network: bondNetwork({
        members: [
          bmember('m1', { kind: 'mac', macaddress: '52:54:00:12:34:56' }),
          bmember('m2', { kind: 'mac', macaddress: '52:54:00:12:34:57' }),
        ],
        parameters: {
          mode: '802.3ad',
          lacpRate: 'fast',
          transmitHashPolicy: 'layer3+4',
          miiMonitorInterval: 100,
        },
        addressing: 'static',
        address: '10.0.0.5/24',
        gateway: '10.0.0.1',
        nameservers: ['10.0.0.1'],
      }),
    }),
  'bond: 固定 IP なのにゲートウェイが無い': () =>
    broken({
      ...base(),
      network: bondNetwork({
        members: [
          bmember('m1', { kind: 'name', name: 'eth0' }),
          bmember('m2', { kind: 'name', name: 'eth1' }),
        ],
        addressing: 'static',
        address: '10.0.0.5/24',
        gateway: '',
        nameservers: [],
      }),
      software: { ...base().software, packages: ['htop'] },
    }),

  'RAID: 効かない設定とカーネル引数': () =>
    broken({
      ...base(),
      storage: {
        ...(raidStorage({
          disks: [rdisk(), rdisk({ id: 'd2' })],
          arrays: [rarray()],
        }) as Record<string, unknown>),
        resetPartition: { enabled: true, size: '' },
      },
      runtimeValues: {
        ...base().runtimeValues,
        disk: 'kernel-arg',
        offerInteractiveEntry: false,
        presets: [host()],
      },
    }),
}

/**
 * 上の `MUTATIONS` では踏めないキーと、その理由。
 *
 * **踏めないものがあること自体は正常**（入れ子の項目名、GUI 側でしか作れない指摘、
 * 現行の 4 リリースでは成立しない組み合わせ）。書いていないキーが未到達なら落とす。
 * 逆に、ここに書いたキーが踏めるようになったら**この表から消す**（それも落ちる）。
 */
const NOT_REACHED_BY_BATTERY: Record<string, string> = {
  // 文の中に入れ子で差し込む項目名。指摘そのもののキーにはならない。
  'validate.fieldOwner': 'deploymentOwnerFieldInvalid の差し込み値',
  'validate.fieldGroup': 'deploymentOwnerFieldInvalid の差し込み値',
  'validate.hostFieldHostname': 'hostFieldEmpty / hostFieldInvalidChars の差し込み値',
  'validate.hostFieldIpv4': '同上',
  'validate.hostFieldGateway': '同上',
  'validate.hostFieldNameservers': '同上',
  'validate.hostFieldDisk': '同上',
  // RAID のサイズ欄の名前。`validate.raidSizeInvalid` の差し込み値。
  'validate.raidFieldEsp': 'raidSizeInvalid の差し込み値',
  'validate.raidFieldBoot': '同上',
  'validate.raidFieldRoot': '同上',
  // GUI 側でしか作れない。実際の grub.cfg のサイズが要るので validateProfile では出せない。
  'validate.grubMenuTooLarge': 'ipc.ts の generateConfig が足す（ISO を開いていないと計れない）',
  // 対応する分岐が現行のリリース定義では成立しない。
  'validate.interactiveSectionsUnsupported':
    'SERIES_FEATURES.interactiveSections が 4 リリースとも true。踏める series が無い',
}

function collectIssues(): { where: string; issue: ValidationIssue }[] {
  const out: { where: string; issue: ValidationIssue }[] = []
  for (const [where, make] of Object.entries(MUTATIONS)) {
    const result = validateProfile(make())
    for (const issue of result.issues) out.push({ where, issue })
  }
  return out
}

describe('検証の指摘は辞書を通る', () => {
  const collected = collectIssues()

  it('壊した設定から実際に指摘を集められている（0 件だと何も検証しない）', () => {
    // 走査が空振りしたまま緑になるのを防ぐ（落とし穴 57）。
    expect(collected.length).toBeGreaterThan(140)
    expect(new Set(collected.map((c) => c.issue.text.key)).size).toBeGreaterThan(110)
  })

  it('この battery が踏めないキーは、理由が書かれているものだけ', () => {
    // **番人が見ていない範囲を明記する**（落とし穴 78）。ここが空だと
    // 「全部見ている」と誤解され、実際には踏めていない分岐が増えていく。
    const seen = new Set<string>(collected.map((c) => c.issue.text.key))
    const uncovered = Object.keys(ja)
      .filter((k) => k.startsWith('validate.'))
      .filter((k) => !seen.has(k))
    expect(uncovered.sort()).toEqual(Object.keys(NOT_REACHED_BY_BATTERY).sort())
  })

  it('すべての指摘のキーが ja / en の両方に実在する', () => {
    // 辞書に無いキーは `createTranslator` がキー名をそのまま返すので、
    // 画面には `validate.fooBar` という英数字が出る。「英語に日本語が残って
    // いないか」だけを見る検査は**素通りする**。実在をここで見るのはそのため。
    const missing = collected
      .filter((c) => typeof dict('ja')[c.issue.text.key] !== 'string' || typeof dict('en')[c.issue.text.key] !== 'string')
      .map((c) => `${c.where}: ${c.issue.text.key}`)
    expect([...new Set(missing)]).toEqual([])
  })

  it('差し込み値を渡し忘れていない（画面に {name} が残らない）', () => {
    const leftover: string[] = []
    for (const { where, issue } of collected) {
      for (const locale of LOCALES) {
        const rendered = formatLocalized(locale, issue.text)
        // `validate.kernelArgsSpecialChars` のように、文中の `{ }` は
        // 差し込みではない（`{name}` の形だけが差し込み）。
        for (const name of placeholdersOf(rendered)) {
          leftover.push(`${where}: ${issue.text.key} (${locale}) に {${name}} が残っている`)
        }
      }
    }
    expect([...new Set(leftover)]).toEqual([])
  })

  it('英語に訳すと日本語が 1 文字も残らない（差し込み値を外したひな型で見る）', () => {
    // 差し込む値（ホスト名・ファイル名）は利用者が日本語で入れうるので、
    // ひな型だけを見る。ここで見たいのは「訳し忘れた文」だけ。
    const bad = [...new Set(collected.map((c) => c.issue.text.key))]
      .map((key) => ({ key, en: formatLocalized('en', localized(key)) }))
      .filter((x) => JAPANESE.test(x.en))
      .map((x) => `${x.key}: ${x.en}`)
    expect(bad).toEqual([])
  })

  it('総括に開発者向けの生の診断を連結していない', () => {
    // `detail` は訳さない生の診断。訳文に混ぜると English の画面に
    // 半分日本語の行が出る（5 巡目に実際に出ていた形）。
    for (const { where, issue } of collected) {
      if (issue.detail === undefined) continue
      expect(formatLocalized('en', issue.text), `${where}: ${issue.text.key}`).not.toContain(issue.detail)
    }
  })
})

// ---------------------------------------------------------------------------
// 危険な指摘の文言（落とし穴 65 / 67）
// ---------------------------------------------------------------------------
//
// `i18n.test.ts` が `write.confirmBody` に「消去 / erased」を要求しているのと同じ形。
// 「どのディスクでもよい」はこのツールで最も危険な指定なので、**両方の言語で
// 危険が伝わる**ことを固定する。訳を整えるつもりで意味を薄めた瞬間に落ちる。

/** 「複数ディスク機でどれが消えるか分からない」を伝えているか。 */
const DISK_ANY_JA = [/どのディスクでもよい/, /複数のディスク/, /消える/]
const DISK_ANY_EN = [/any disk/i, /several disks/i, /erased/i]
/** 「この設定は効きません」を伝えているか。 */
const IGNORED_JA = /無視されます|出力しません/
const IGNORED_EN = /ignored|omitted/i

/** そのシリーズでは効かない、と伝えるキー。 */
const IGNORED_KEYS = [
  'validate.resetPartitionUnsupported',
  'validate.aptFallbackUnsupported',
  'validate.sourceKeyUnsupported',
  'validate.kernelCrashDumpsUnsupported',
  'validate.identityGroupsUnsupported',
  'validate.activeDirectoryUnsupported',
  'validate.interactiveAllUnverified',
  'validate.searchDriversUnsupported',
  'validate.codecsUnsupported',
  'validate.oemUnsupported',
] as const satisfies readonly MsgKey[]

describe('危険な指摘の文言を薄めない', () => {
  it('「どのディスクでもよい」の警告が両方の言語で危険を伝えている', () => {
    for (const re of DISK_ANY_JA) expect(ja['validate.diskMatchAny']).toMatch(re)
    for (const re of DISK_ANY_EN) expect(en['validate.diskMatchAny']).toMatch(re)
  })

  it('効かない設定は「無視される」と両方の言語で言っている', () => {
    for (const key of IGNORED_KEYS) {
      expect(ja[key], `ja.${key}`).toMatch(IGNORED_JA)
      expect(en[key], `en.${key}`).toMatch(IGNORED_EN)
    }
  })

  it('暗号化パスフレーズが平文で書かれることを両方の言語で言っている', () => {
    // プロファイル JSON にも YAML にも平文で入る唯一の例外（CLAUDE.md の規約）。
    expect(ja['validate.encryptionPassphrasePlainInYaml']).toMatch(/平文/)
    expect(en['validate.encryptionPassphrasePlainInYaml']).toMatch(/plain text/i)
  })

  it('検査そのものが効く（薄めたら落ちることを確かめる）', () => {
    // この it が無いと、正規表現を書き間違えて「何も検出しない検査」になっても
    // 全部緑のままになる（落とし穴 57）。
    const weakJa = '\u30c7\u30a3\u30b9\u30af\u306e\u6307\u5b9a\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
    const weakEn = 'Please review the disk selection.'
    expect(DISK_ANY_JA.some((re) => !re.test(weakJa))).toBe(true)
    expect(DISK_ANY_EN.some((re) => !re.test(weakEn))).toBe(true)
    expect(IGNORED_JA.test('\u30b5\u30dd\u30fc\u30c8\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002')).toBe(false)
    expect(IGNORED_EN.test('This release is different.')).toBe(false)
    // 本物は通る（正規表現が厳しすぎて何も通さない、の裏返しも見る）
    expect(IGNORED_JA.test(ja['validate.resetPartitionUnsupported'])).toBe(true)
    expect(IGNORED_EN.test(en['validate.resetPartitionUnsupported'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 死んだキー / 知らないキー（ソース走査）
// ---------------------------------------------------------------------------
//
// `packages/media/src/localized-guard.test.ts` の同じ趣旨の検査は
// `packages/media/src` と `apps/desktop/src/main` しか走査しないので、
// `packages/shared` にある `validate.ts` の `validate.*` は**その検査の範囲外**。
// 接頭辞リストに `validate.` を足すと、走査していないファイルのキーが
// 全部「死んでいる」ことになる。だから範囲を広げるのではなく、
// キーの持ち主（ここ）に同じ検査を置く。

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
/** `validate.*` を引く場所。生成側と、GUI が 1 件だけ足す場所。 */
const SOURCES = ['packages/shared/src/autoinstall/validate.ts', 'apps/desktop/src/main/ipc.ts']

const sources = SOURCES.map((rel) => ({ rel, code: readFileSync(join(REPO_ROOT, rel), 'utf8') }))
const allCode = sources.map((s) => s.code).join('\n')
const validateKeys = Object.keys(ja).filter((k) => k.startsWith('validate.'))

describe('validate.* のキーとソースが食い違わない', () => {
  it('走査対象を実際に読めている（空だと何も検証しない）', () => {
    for (const s of sources) expect(s.code.length, s.rel).toBeGreaterThan(1000)
    expect(validateKeys.length).toBeGreaterThan(100)
  })

  it('辞書の validate.* が全部ソースから引かれている（死んだキーが無い）', () => {
    // 使われないキーが辞書に残っていると、「あるはずの文言」を探した人が
    // それを使い、実際には別の経路が生の文字列を出し続ける。
    const dead = validateKeys.filter((k) => !allCode.includes(`'${k}'`) && !allCode.includes(`"${k}"`))
    expect(
      dead,
      '辞書にあるのに validate.ts / ipc.ts のどこからも引かれていないキーです。\n' +
        '使う場所を足すか、ja.ts / en.ts から消してください。',
    ).toEqual([])
  })

  it('ソースに書かれた validate.* が全部辞書にある', () => {
    // 書き間違えたキーは画面にキー名がそのまま出る（例外にはならない）。
    const used = new Set<string>()
    for (const m of allCode.matchAll(/'(validate\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]!)
    expect(used.size).toBeGreaterThan(100)
    const unknown = [...used].filter((k) => typeof dict('ja')[k] !== 'string' || typeof dict('en')[k] !== 'string')
    expect(unknown).toEqual([])
  })

  it('指摘の総括に日本語のリテラルを直書きしていない', () => {
    // `add(...)` の第 3 引数は辞書のキーでなければならない。日本語を直に
    // 渡すと型では落ちるが、`as MsgKey` で抜けられるので実物も見ておく。
    const code = sources.find((s) => s.rel.endsWith('validate.ts'))!.code
    const bad: string[] = []
    for (const m of code.matchAll(/\badd\(\s*'(?:error|warning|info)',\s*[^,]+,\s*('(?:[^'\\]|\\.)*')/g)) {
      if (JAPANESE.test(m[1]!)) bad.push(m[1]!)
    }
    expect(bad).toEqual([])
  })
})

describe('効かない設定は「効かない」と伝える', () => {
  it('固定値だけなのにホストを登録していたら警告する', () => {
    // どの項目も「固定値」なら `buildRuntimePresets()` は空を返し、
    // 登録したホストは黙って捨てられる。UI からも表が消えるので、
    // 何も言わないと「設定したのに効かない」になる（落とし穴 67）。
    const base = createDefaultProfile()
    const withHosts = {
      ...base,
      runtimeValues: {
        ...base.runtimeValues,
        hostname: 'fixed' as const,
        network: 'fixed' as const,
        disk: 'fixed' as const,
        presets: [
          { id: 'a', label: 'h1', hostname: 'a', ipv4: '', gateway: '', nameservers: '', disk: '' },
          { id: 'b', label: 'h2', hostname: 'b', ipv4: '', gateway: '', nameservers: '', disk: '' },
        ],
      },
    } as unknown as Parameters<typeof validateProfile>[0]

    const hit = validateProfile(withHosts).issues.filter(
      (i) => i.text.key === 'validate.hostsWithoutKernelArgs',
    )
    expect(hit).toHaveLength(1)
    // 件数を差し込んでいること（「何件が使われないのか」が分からないと直せない）
    expect(formatLocalized('ja', hit[0]!.text)).toContain('2')
    expect(formatLocalized('en', hit[0]!.text)).toContain('2')
    expect(formatLocalized('en', hit[0]!.text)).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
  })

  it('ホストを 1 件も登録していなければ言わない（無用な警告を出さない）', () => {
    const issues = validateProfile(createDefaultProfile()).issues
    expect(issues.filter((i) => i.text.key === 'validate.hostsWithoutKernelArgs')).toHaveLength(0)
  })
})
