/**
 * **VM で本当にインストールが完走するかを確かめる。**
 *
 * これまでの検証は「生成した YAML が正しい形か」「USB に正しく書けたか」までで、
 * **その USB で起動して無人インストールが終わるか**は誰も確かめていなかった
 * （`docs/HANDOFF.md` の最初から残っている最大の未検証項目）。
 *
 * 仕組み:
 *   1. Windows 側（このスクリプト）で設定から `.img` を作る
 *   2. WSL2 の Ubuntu に持っていく（`/dev/kvm` が使えるのはあちら側）
 *   3. QEMU で **USB メモリとして挿して** UEFI 起動し、無人インストールを走らせる
 *   4. インストール後のディスクを **VM を起動せずに** 開いて、
 *      できた RAID / LVM / ファイルシステムを検査する
 *
 * **Windows には QEMU が無く、Windows 11 Home なので Hyper-V も無い。**
 * WSL2 の中に QEMU + OVMF を入れて使う（`scripts/vm/run-vm.sh`）。
 *
 * 使い方:
 *   npm run e2e:vm                     既定（単一ディスク・LVM）
 *   npm run e2e:vm:raid                利用者の実機構成（ディスク 2 台 + NVMe 2 台の RAID1）
 *   VM_DISKS="sda:450G sdb:450G" ...   ディスク構成を変える
 *
 * **`VM_MODE=raid` は既定を一切変えない。** 既定 (`single`) の経路は
 * 「単一ディスク・LVM で完走する」ことを実機相当で確かめた実績があるので、
 * 分岐は足すだけにしてある。
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  createDefaultProfile,
  createDefaultRaidStorage,
  createRaidArray,
  createRaidDisk,
  createBondMember,
  createDefaultBondNetwork,
  generateMetaData,
  generateUserData,
  validateProfile,
  formatLocalized,
  recognizeIso,
  migrateProfile,
  buildHostMenuEntries,
  baseKernelArgs,
} from '../packages/shared/src/index.js'
import type { AutoinstallProfile, UbuntuSeries } from '../packages/shared/src/index.js'
import {
  FileBlockDevice,
  buildIsoPatches,
  executeWritePlan,
  inspectIso,
  minimumDiskSize,
  planUsbLayout,
} from '../packages/media/src/index.js'
import { printRevisionBanner } from './lib/git-revision.mts'

const DISTRO = 'Ubuntu-24.04'
const LAB = '/root/vmlab'
const REPO_WSL = '/mnt/c/dev/autoinstall-ui'
/** このスクリプトから見たリポジトリのルート（`scripts/` の 1 つ上）。 */
const REPO_ROOT = join(import.meta.dirname, '..')

/**
 * どの構成を組むか。**既定は今までどおり単一ディスク・LVM**。
 *
 * npm script から渡すので **引数**を正とする（Windows の `npm run` は
 * `VM_MODE=raid tsx ...` の形を cmd.exe に渡すので env の前置きが効かない）。
 * 環境変数も受けるが、それは手で叩くときの都合。
 */
type VmMode = 'single' | 'raid' | 'mirror' | 'ip'
const ARGV = process.argv.slice(2)
const MODE: VmMode =
  ARGV.includes('--mirror') || process.env['VM_MODE'] === 'mirror'
    ? 'mirror'
    : ARGV.includes('--raid') || process.env['VM_MODE'] === 'raid'
      ? 'raid'
      : ARGV.includes('--ip') || process.env['VM_MODE'] === 'ip'
        ? 'ip'
        : 'single'

/** RAID 系（`raid` / `mirror`）か。ディスクの構成と検査を共有する。 */
const IS_RAID = MODE === 'raid' || MODE === 'mirror'

/**
 * `ip` モード: **配布しているサンプルそのもの**から USB を作り、
 * 起動メニューの項目を 1 つ選んだことにしてインストールし、
 * **選んだ IP が実際に入る**ことを確かめる。
 *
 * ここが確かめるのは、引き継ぎ資料が長く「未検証」と書いてきた連鎖である:
 * GRUB の menuentry のカーネル引数 → early-commands の python が `/proc/cmdline` を読む
 * → `/autoinstall.yaml` を PyYAML で書き換える → subiquity が適用する
 * → cloud-init が `/etc/netplan` に書き出す。
 *
 * 選ぶのは **VM のときだけ `set default=<n>` を入れる**形にする。
 * **実 USB に焼くときは入らない**（`console=ttyS0` と同じ扱い。落とし穴 105）。
 *
 * > メニューを**シリアルから操作すること自体はできる**（OVMF が EFI コンソールを
 * > シリアルに多重化するので、矢印キーと Enter を流し込めば選べる。実測）。
 * > それでも既定を書くのは、キー入力が**「メニューが出るまで何秒待つか」に依存する**からで、
 * > 負荷で描画が遅れると静かに別の項目を選ぶ。既定なら決定的になる（落とし穴 127）。
 */
const IP_SAMPLE = 'samples/ip-only.json'
/**
 * 選ぶ項目。0 は元の項目なので、プリセット i は `1 + i` 番。
 *
 * **わざと 1 番目ではなく 2 番目を選ぶ。** 1 番目 (`= 1`) を選ぶと、
 * 「添え字がずれていて常に先頭のプリセットを指す」壊れ方を見逃す
 * （どちらでも同じ結果になってしまう）。
 */
const IP_PRESET_INDEX = 2

/**
 * bond のメンバーを選ぶ MAC。**`scripts/vm/run-vm.sh` と同じ値**。
 *
 * 片方だけ変えると「NIC は 2 枚あるのにメンバーが 0 枚の bond」になり、
 * netplan は通るのにリンクが上がらない。**両方を一緒に直すこと。**
 */
const NIC_MACS = ['52:54:00:12:34:56', '52:54:00:12:34:57'] as const

/**
 * **利用者の実機構成を、容量だけ縮めて組む。**
 *
 * 実機:  SATA SSD 447.1GB x 2 (sda/sdb) + NVMe 3.5TB x 2 (nvme0n1/nvme1n1)
 * VM  :  60G x 2 + 20G x 2
 *
 * **縮めているのは容量だけで、構成（何が何台で、どの配列に入るか）は同じ。**
 * 3.5TB を実際に作ると qemu-img convert の時間が現実的でなくなる。
 * 容量に依存する挙動（`size: -1` の残り全部、LVM の伸び）は比率が保たれていれば同じに動くが、
 * **3.5TB そのものは試していない**（→ `docs/HANDOFF.md` §3.2）。
 */
const RAID_DISKS = 'sda:60G sdb:60G nvme0n1:20G nvme1n1:20G'

/**
 * `mirror` モードのディスク。**2 台だけ**。
 *
 * ESP を 2 台に置くことと bond が見たいだけなので、NVMe は要らない
 *（丸ごとメンバーは `raid` モードで確認済み）。台数を減らすと
 * `qemu-img convert` の時間がそのまま縮む。
 */
const MIRROR_DISKS = 'sda:40G sdb:40G'

/**
 * ディスクの指定。
 *
 * `run-vm.sh` は disk-spec の名前をそのまま QEMU の `serial=` に渡すので、
 * ゲストから見える ID_SERIAL は `sda` / `nvme0n1` になる。
 * ただし **NVMe の ID_SERIAL は `<model>_<serial>` に組み立てられる**ので
 * （udev の 60-persistent-storage.rules）、完全一致では引けない。
 * autoinstall の `match` は glob を受ける（リファレンスの例が `serial: CT*`）ので、
 * **前後にワイルドカードを付けた形**にしてどちらでも当たるようにする。
 */
function serialGlob(name: string): { readonly kind: 'serial'; readonly serial: string } {
  return { kind: 'serial', serial: `*${name}*` }
}

/**
 * 利用者の構成そのもの:
 *
 *   sda      パーティション: ESP 1G（**sda だけ**）/ boot 2G / 残り
 *   sdb      パーティション: boot 2G / 残り（ESP は作らない）
 *   nvme0n1  **ディスク丸ごと** md2 のメンバー
 *   nvme1n1  **ディスク丸ごと** md2 のメンバー
 *
 *   md0 = RAID1 /boot        (sda, sdb)
 *   md1 = RAID1 LVM PV       (sda, sdb) → vg0/lv-0 → ext4 → /
 *   md2 = RAID1 **作るだけ**  (nvme0n1, nvme1n1)  format も mount も出さない
 */
function raidProfile(base: AutoinstallProfile): AutoinstallProfile {
  const storage = base.storage
  if (storage.mode === 'raw') throw new Error('既定のプロファイルが raw になっている（想定外）')
  const disks = [
    { ...createRaidDisk('d-sda', serialGlob('sda')), usage: 'partitions' as const, esp: true },
    { ...createRaidDisk('d-sdb', serialGlob('sdb')), usage: 'partitions' as const, esp: false },
    { ...createRaidDisk('d-nvme0', serialGlob('nvme0n1')), usage: 'whole' as const, esp: false },
    { ...createRaidDisk('d-nvme1', serialGlob('nvme1n1')), usage: 'whole' as const, esp: false },
  ]
  const arrays = [
    { ...createRaidArray('a-boot', 'md0', 'boot' as const), level: 'raid1' as const, diskIds: ['d-sda', 'd-sdb'] },
    { ...createRaidArray('a-root', 'md1', 'lvm-pv' as const), level: 'raid1' as const, diskIds: ['d-sda', 'd-sdb'] },
    { ...createRaidArray('a-data', 'md2', 'data' as const), level: 'raid1' as const, diskIds: ['d-nvme0', 'd-nvme1'] },
  ]
  return {
    ...base,
    basics: { ...base.basics, hostname: 'vm-raid' },
    storage: {
      ...storage,
      mode: 'raid',
      raid: {
        ...createDefaultRaidStorage(),
        disks,
        arrays,
        volumeGroup: 'vg0',
        rootName: 'lv-0',
        rootSize: '',
        rootFstype: 'ext4',
        espSize: '1G',
        bootSize: '2G',
        mirrorBootloader: true,
      },
    },
  }
}

/**
 * 配布サンプル (`samples/ip-only.json`) を読んで、**VM に必要な最小限だけ**を上書きする。
 *
 * **サンプルそのものを検証したいので、書き換えるのは 2 つだけ**:
 *   1. パスワードハッシュ（サンプルは空。空のままだと検証が error を出して先へ進めない）
 *   2. リリース（ISO と設定を揃える。食い違うとそのリリースに無いキーを出しうる。落とし穴 104）
 *
 * **IP・ホスト名・プリセットは 1 文字も変えない。** ここを変えると
 * 「配布しているものを確かめた」と言えなくなる。
 */
function ipSampleProfile(base: AutoinstallProfile): AutoinstallProfile {
  const raw: unknown = JSON.parse(readFileSync(join(REPO_ROOT, IP_SAMPLE), 'utf8'))
  const { profile, notes } = migrateProfile(raw)
  // 移行の note が出るなら、サンプルが古い形式で書かれている。**黙って進めない。**
  if (notes.length > 0) {
    console.log(`  （note: サンプルの読み込みで ${notes.length} 件の移行が起きた）`)
    for (const n of notes) console.log(`    - ${n}`)
  }
  return {
    ...profile,
    series: base.series,
    user: { ...profile.user, passwordHash: base.user.passwordHash },
  }
}

/** 静的 IP の「予備の値」。選ばなかったときに入るもの。 */
function addressOf(profile: AutoinstallProfile): string {
  return profile.network.mode === 'static' ? profile.network.address : '(static ではない)'
}
/**
 * **残っていた 2 つの未検証項目を 1 本で確かめる構成。**
 *
 * `raid` モード（利用者の実機構成）は ESP が sda 1 台なので、
 * `needsRaidEspMirror()` が false になり **`late-commands` が 1 行も出ない**。
 * つまり「2 台目にも GRUB を入れて、どちらが壊れても起動する」という
 * このアプリ独自の補い（落とし穴 98）は**一度も走っていなかった**。
 *
 * ここでは:
 *   - **ESP を sda と sdb の両方**に作る → ミラーの late-commands が実際に走る
 *   - **NIC 2 枚を bond で束ねる** → bond は VM でも実機でも未検証だった
 *
 * ディスクは 2 台だけにする（NVMe は `raid` モードで確認済みで、
 * 台数を増やすと 1 本あたりの時間だけ延びる）。
 */
function mirrorProfile(base: AutoinstallProfile): AutoinstallProfile {
  const storage = base.storage
  if (storage.mode === 'raw') throw new Error('既定のプロファイルが raw になっている（想定外）')
  const disks = [
    { ...createRaidDisk('d-sda', serialGlob('sda')), usage: 'partitions' as const, esp: true },
    // **ここが `raid` モードとの違い。** 2 台目にも ESP を作る。
    { ...createRaidDisk('d-sdb', serialGlob('sdb')), usage: 'partitions' as const, esp: true },
  ]
  const arrays = [
    { ...createRaidArray('a-boot', 'md0', 'boot' as const), level: 'raid1' as const, diskIds: ['d-sda', 'd-sdb'] },
    { ...createRaidArray('a-root', 'md1', 'lvm-pv' as const), level: 'raid1' as const, diskIds: ['d-sda', 'd-sdb'] },
  ]
  return {
    ...base,
    basics: { ...base.basics, hostname: 'vm-mirror' },
    network: {
      ...createDefaultBondNetwork(),
      members: NIC_MACS.map((mac, i) =>
        createBondMember(`m-${i}`, { kind: 'mac', macaddress: mac }),
      ),
      // **`active-backup` を使う。** QEMU の user-mode networking には
      // LACP を話す相手が居ないので `802.3ad` は上がらない（落とし穴 102 のとおり
      // スイッチ側の設定が要るモード）。「VM で確かめられるのは
      // スイッチを必要としないモードだけ」という制約はそのまま残る。
      parameters: { mode: 'active-backup', lacpRate: '', miiMonitorInterval: 100, transmitHashPolicy: '' },
      addressing: 'dhcp',
    },
    storage: {
      ...storage,
      mode: 'raid',
      raid: {
        ...createDefaultRaidStorage(),
        disks,
        arrays,
        volumeGroup: 'vg0',
        rootName: 'lv-0',
        rootSize: '',
        rootFstype: 'ext4',
        espSize: '1G',
        bootSize: '2G',
        mirrorBootloader: true,
      },
    },
  }
}

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** WSL の中でコマンドを走らせる。 */
function wsl(script: string, timeoutMs = 300_000): string {
  return execFileSync('wsl.exe', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-lc', script], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** WSL の中で長時間のコマンドを走らせ、出力を 1 行ずつ渡す。 */
function wslStream(script: string, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('wsl.exe', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-lc', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    const feed = (chunk: Buffer): void => {
      buf += chunk.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) onLine(l)
    }
    p.stdout.on('data', feed)
    p.stderr.on('data', feed)
    p.on('close', (code) => {
      if (buf.length > 0) onLine(buf)
      resolve(code ?? -1)
    })
  })
}

/** Windows のパスを WSL から見えるパスにする。 */
function toWslPath(winPath: string): string {
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/mnt/${d.toLowerCase()}`)
}

/**
 * 対応している ISO を 1 本選ぶ。
 *
 * **見つけた順ではなく、リリースの新しい順に選ぶ。**
 * `~/images` を上から見るだけだと `ubuntu-22.04.5-live-server` が先に当たるが、
 * この構成 (`storage.config` の `disk` アクションに `match:` を書く形) は
 * **22.04 の subiquity では動かない**ことを実測した
 * （15 分待ってディスクに 1 バイトも書かれず、シリアルにも何も出ない）。
 * 選んだ ISO のリリースは**そのままプロファイルの `series` にする**
 * （ISO と設定のリリースが食い違うと、そのリリースに無いキーを出しうる）。
 */
async function findIso(): Promise<{ readonly path: string; readonly series: UbuntuSeries } | null> {
  const found: { path: string; series: UbuntuSeries }[] = []
  const explicit = process.argv.slice(2).find((a) => a.toLowerCase().endsWith('.iso'))
  const dirs = explicit !== undefined ? [] : [join(homedir(), 'images'), join(homedir(), 'Downloads'), 'C:/iso']
  const candidates: string[] = explicit !== undefined ? [explicit] : []
  for (const dir of dirs) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.toLowerCase().endsWith('.iso')) candidates.push(join(dir, name))
    }
  }
  for (const path of candidates) {
    let dev: FileBlockDevice | null = null
    try {
      dev = await FileBlockDevice.open(path, 'r')
      const info = await inspectIso(dev)
      const rec = recognizeIso(info.volumeId, info.diskInfo ?? undefined)
      if (rec.kind === 'supported') found.push({ path, series: rec.identity.series })
    } catch {
      // 対応していない ISO は飛ばす
    } finally {
      await dev?.close().catch(() => undefined)
    }
  }
  if (found.length === 0) return null
  // 新しいリリースを優先する（`series` は "22.04" のような文字列なので単純な比較でよい）。
  found.sort((a, b) => b.series.localeCompare(a.series))
  return found[0] ?? null
}

async function main(): Promise<void> {
  printRevisionBanner('scripts/e2e-vm.mts')

  const iso0 = await findIso()
  if (iso0 === null) {
    console.log('対応する ISO が見つからないのでスキップします（異常ではありません）。')
    return
  }
  const isoPath = iso0.path
  console.log(`ISO   : ${basename(isoPath)}（${iso0.series}）`)

  // --- 1. 設定 -----------------------------------------------------------
  // インストール後に見分けられる値にする。
  // **ISO と設定のリリースを揃える。** 食い違うと、そのリリースに無いキーを出しうる。
  const base = createDefaultProfile(iso0.series)
  const common: AutoinstallProfile = {
    ...base,
    basics: { ...base.basics, hostname: 'vm-e2e' },
    user: {
      ...base.user,
      username: 'vmadmin',
      realname: 'VM E2E',
      // VM の中だけで使う使い捨て。平文は持たない（規約）。
      passwordHash: '$6$vme2e$Qv1sKq4bWbG3hQeYwZ7YyQ0cQ9hQb1s2Y3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6.',
    },
  }
  const profile: AutoinstallProfile =
    MODE === 'mirror'
      ? mirrorProfile(common)
      : MODE === 'raid'
        ? raidProfile(common)
        : MODE === 'ip'
          ? ipSampleProfile(common)
          : common
  if (MODE === 'ip') {
    const chosen = profile.runtimeValues.presets[IP_PRESET_INDEX - 1]
    console.log(`構成  : 配布サンプル ${IP_SAMPLE}（IP だけ起動メニューで切り替える）`)
    console.log(`        起動メニューの ${IP_PRESET_INDEX} 番（${chosen?.label}）を選んだことにして入れる`)
    console.log(`        期待する IP: ${chosen?.ipv4}（予備の ${addressOf(profile)} ではなく）`)
  } else if (MODE === 'mirror') {
    console.log('構成  : ESP を 2 台に置き（GRUB のミラーが走る）、NIC 2 枚を bond で束ねる')
    console.log('        **残っていた 2 つの未検証項目**（2 台目への grub-install / bond）を 1 本で見る')
  } else if (MODE === 'raid') {
    console.log('構成  : 利用者の実機構成（sda/sdb = ESP は sda のみ + /boot md0 + LVM md1 / nvme x2 = 丸ごと md2）')
    console.log('        **容量だけ縮めてある**（実機 447.1GB x2 + 3.5TB x2 → 60G x2 + 20G x2）')
  } else {
    console.log('構成  : 既定（単一ディスク・LVM）')
  }
  const validation = validateProfile(profile)
  check(
    '設定が検証を通る',
    validation.ok,
    validation.issues.map((i) => formatLocalized('ja', i.text)).join(' / '),
  )
  if (IS_RAID) {
    // 出した YAML をそのまま残す。**通らなかったときに最初に見る物**。
    console.log('\n--- 生成した user-data（storage 部分の抜粋）---')
    const yaml = generateUserData(profile, { comments: 'none' })
    const from = yaml.indexOf('  storage:')
    const to = yaml.indexOf('\n  identity:')
    console.log(yaml.slice(from, to > from ? to : from + 4000))
    console.log('--- ここまで ---\n')
  }

  // --- 2. イメージを作る --------------------------------------------------
  const workDir = join(process.env['TEMP'] ?? '/tmp', `vm-e2e-${randomBytes(4).toString('hex')}`)
  await mkdir(workDir, { recursive: true })
  const imgPath = join(workDir, 'usb.img')
  const iso = await FileBlockDevice.open(isoPath, 'r')
  try {
    const inspection = await inspectIso(iso)
    // **`console=ttyS0` は VM の都合であって、製品の既定ではない。**
    // Ubuntu の ISO の grub.cfg は console= を付けないので、カーネルが起きた瞬間に
    // シリアルへの出力が止まる。GRUB のエラーだけが見えて、そのあとは
    // 「ディスクが 1 バイトも増えないまま無音」になり、
    // **失敗しているのか時間がかかっているのかが区別できない**。
    // 実機の USB に焼くときは付けない（`e2e-vm.mts` だけが足す）。
    // **`ip` モードだけ、起動メニューの項目を実際に作って 1 つ選ぶ。**
    // `set default=<n>` を入れて「人が選んだ」状態を**決定的に**再現する
    // （シリアルから矢印キーで選ぶこともできるが、待ち時間に依存する。落とし穴 127）。
    // 他のモードでは `extraEntries` も `defaultEntry` も出さない（今までどおり）。
    const menuEntries = MODE === 'ip' ? buildHostMenuEntries(profile.runtimeValues, []) : []
    if (MODE === 'ip') {
      console.log('\n--- 起動メニューに出る項目 ---')
      console.log('  [0] （元の項目。予備の値で入る）')
      menuEntries.forEach((e, i) => {
        const mark = i + 1 === IP_PRESET_INDEX ? ' ← これを選ぶ' : ''
        console.log(`  [${i + 1}] ${e.title}${mark}`)
        console.log(`       ${e.args.join(' ') || '(引数なし)'}`)
      })
      console.log('--- ここまで ---\n')
      check(
        `選ぶ項目 (${IP_PRESET_INDEX}) がメニューに存在する`,
        menuEntries.length >= IP_PRESET_INDEX,
        `メニューは ${menuEntries.length + 1} 項目`,
      )
    }
    const patchPlan = buildIsoPatches(inspection, {
      args: ['autoinstall', 'console=tty0', 'console=ttyS0,115200n8'],
      markTitle: true,
      ...(MODE === 'ip'
        ? {
            extraEntries: menuEntries.map((e) => ({ title: e.title, args: e.args })),
            defaultEntry: IP_PRESET_INDEX,
          }
        : {}),
    })
    if (MODE === 'ip') {
      // **選んだ項目のカーネル行に、期待した引数が入っているか。**
      // ここが違うと、あとの検査は「反映されなかった」ではなく
      // 「そもそも渡していなかった」を見ることになる。
      const grub = patchPlan.newGrubCfg
      const chosen = profile.runtimeValues.presets[IP_PRESET_INDEX - 1]
      check(
        'grub.cfg に `set default=` が入った',
        new RegExp(`^set default=${IP_PRESET_INDEX}$`, 'm').test(grub),
        `実際 "${/^set default=.*$/m.exec(grub)?.[0] ?? '(無い)'}"`,
      )
      check(
        '選ぶ項目のカーネル行に期待した IP の引数がある',
        chosen !== undefined && grub.includes(`ai.ipv4=${chosen.ipv4}`),
        `期待 ai.ipv4=${chosen?.ipv4}`,
      )
    }
    const isoSize = (await stat(isoPath)).size
    const plan = await planUsbLayout({
      isoDevice: iso,
      diskSizeBytes: minimumDiskSize(isoSize),
      patches: patchPlan.patches,
      seedFiles: [
        {
          name: 'user-data',
          content: Buffer.from(generateUserData(profile, { comments: 'ja' }), 'utf8'),
        },
        { name: 'meta-data', content: Buffer.from(generateMetaData(profile.basics.hostname), 'utf8') },
      ],
      random: () => randomBytes(16),
      timestamp: new Date('2026-09-07T00:00:00Z'),
    })
    const target = await FileBlockDevice.open(imgPath, 'w+')
    const result = await executeWritePlan({
      plan,
      isoDevice: iso,
      targetDevice: target,
      patches: patchPlan.patches,
      verify: true,
    })
    await target.close()
    check(
      'イメージを書いて読み戻せた',
      result.verified,
      `${(result.bytesWritten / 1e9).toFixed(2)} GB`,
    )
  } finally {
    await iso.close()
  }

  // --- 3. WSL へ運ぶ ------------------------------------------------------
  // /mnt/c 越しに QEMU から読むと遅いので、WSL の ext4 に写す。
  const wslImg = `${LAB}/usb.img`
  console.log('イメージを WSL へ複製しています…')
  wsl(`mkdir -p ${LAB} && cp ${JSON.stringify(toWslPath(imgPath))} ${JSON.stringify(wslImg)}`, 900_000)
  check('WSL 側にイメージがある', wsl(`test -f ${wslImg} && echo yes`).trim() === 'yes')

  // --- 4. 無人インストール ------------------------------------------------
  const disks =
    process.env['VM_DISKS'] ??
    (MODE === 'mirror' ? MIRROR_DISKS : MODE === 'raid' ? RAID_DISKS : 'sda:20G')
  console.log(`\n■ 無人インストールを開始します（ディスク: ${disks}）`)
  console.log('  シリアルの出力で進行を追います。数分〜十数分かかります。\n')

  // 前回のディスクが残っていると「前の結果」を見てしまう。必ず消してから始める。
  wsl(`rm -f ${LAB}/*.qcow2 ${LAB}/OVMF_VARS.fd`)

  let sawInstaller = false
  let sawComplete = false
  let lastShown = 0
  const rc = await wslStream(
    `${MODE === 'mirror' ? 'VM_NICS=2 ' : ''}bash ${REPO_WSL}/scripts/vm/run-vm.sh install ${wslImg} ${LAB} ${disks}`,
    (line) => {
      if (/subiquity|curtin|cloud-init|Ubuntu Server/i.test(line)) sawInstaller = true
      if (/installation complete|subiquity\/Shutdown|Reached target.*ower.?ff/i.test(line)) {
        sawComplete = true
      }
      // 全部出すと数万行になる。意味のある行と、生きていることが分かる間隔だけ。
      const interesting = /error|fail|Traceback|installation complete|curtin command|subiquity\/(Install|Late|Shutdown)/i
      const now = Date.now()
      if (interesting.test(line) || now - lastShown > 30_000) {
        lastShown = now
        console.log(`  | ${line.trim().slice(0, 160)}`)
      }
    },
  )
  console.log(`\nQEMU の終了コード: ${rc}`)
  check('インストーラが起動した', sawInstaller)
  // **シリアルの文言で完了を判定しない。** リリースによって出る語が変わるし、
  // 出ていなくてもインストールは終わっている（最初の実行がまさにそれだった）。
  // 完了の証拠は**できあがったディスクの中身**で見る（下）。
  if (!sawComplete) {
    console.log('  （note: シリアルに完了の語は出なかった。ディスクの中身で判定します）')
  }

  // --- 5. できたディスクを検査する（VM を起動せずに）----------------------
  // **ここが本番。**「Ubuntu が入った」ではなく
  // 「**私たちの user-data が効いた**」ことを確かめる。
  console.log('\n■ インストール後のディスクを検査します')
  let report = ''
  try {
    report = wsl(`bash ${REPO_WSL}/scripts/vm/inspect-disks.sh ${LAB}`, 300_000)
  } catch (err) {
    const e = err as { stdout?: string; message?: string }
    report = `${e.stdout ?? ''}\n${e.message ?? ''}`
  }
  console.log(report)

  const field = (name: string): string => {
    const m = new RegExp(`^${name}=(.*)$`, 'm').exec(report)
    return m?.[1]?.trim() ?? ''
  }
  check('ルートファイルシステムができている', /^ルート: /m.test(report))
  check(
    'ホスト名が設定どおり',
    field('HOSTNAME') === profile.basics.hostname,
    `期待 ${profile.basics.hostname} / 実際 "${field('HOSTNAME')}"`,
  )
  // **ユーザーはインストール時にはまだ存在しない。**
  // subiquity は `/etc/cloud/cloud.cfg.d/99-installer.cfg` に書くだけで、
  // 実際に作るのは**初回起動時の cloud-init**。
  // 最初この段階で `/etc/passwd` を見て「作られていない」と判定してしまった
  // ——検証する層を間違えていた。ここでは「設定が渡ったか」を見る。
  check(
    '管理ユーザーが cloud-init に渡っている',
    field('CLOUDINIT_USER') === profile.user.username,
    `期待 ${profile.user.username} / 実際 "${field('CLOUDINIT_USER')}"`,
  )
  check('sudo グループ指定つきで渡っている', field('CLOUDINIT_SUDO') === 'yes')
  check('autoinstall の user-data が読まれた', field('AUTOINSTALL_USER_DATA') === 'yes')
  // **レポート全体を grep しない。**
  // 以前は `/\/boot\/efi/.test(report)` だったが、ESP ミラーのログにも
  // `/target/boot/efi` の文字列が出るので、**fstab が空でも通る**（偽 PASS）。
  // 機械可読な `FSTAB_MOUNTS=` だけを見る。
  {
    const mounts = field('FSTAB_MOUNTS').split(/\s+/).filter(Boolean)
    check(
      'ESP と /boot が fstab に載っている',
      mounts.includes('/boot/efi') && mounts.includes('/boot'),
      `実際 "${field('FSTAB_MOUNTS')}"`,
    )
  }

  // --- 5b. RAID 構成のときだけ見ること ------------------------------------
  // **「Ubuntu が入った」ではなく「この構成が組まれた」を見る。**
  // md の番号と名前はホストが変わると当てにならない
  // （別ホストで組み立て直すと `/dev/md127` になる）ので、
  // **レベル・台数・その md の上に何が載っているか**で見分ける。
  if (MODE === 'raid') {
    interface Md {
      readonly name: string
      readonly level: string
      readonly devices: number
      readonly fstype: string
      readonly dev: string
      /** メンバーのデバイス（`/dev/loop2` = ディスク丸ごと / `/dev/loop4p3` = パーティション） */
      readonly members: readonly string[]
    }
    const lines = report.split('\n')
    const mds: Md[] = lines
      .filter((l) => l.startsWith('MD='))
      .map((l) => l.slice(3).split('|'))
      .map((c) => ({
        name: c[0] ?? '',
        level: c[1] ?? '',
        devices: Number(c[2] ?? '0'),
        fstype: c[3] ?? '',
        dev: c[4] ?? '',
        members: (c[5] ?? '').split(',').filter(Boolean),
      }))
    const show = mds.map((m) => `${m.dev}(${m.name} ${m.level} ${m.devices}台 fs="${m.fstype}")`).join(' ')
    check('md の配列が 3 つできている', mds.length === 3, show)

    const bootMd = mds.find((m) => m.fstype === 'ext4')
    const pvMd = mds.find((m) => m.fstype === 'LVM2_member')
    // **「何も載っていない」ことが仕様**の配列。`role: 'data'` がそのとおりに出たか。
    const dataMd = mds.find((m) => m.fstype === '')
    check('/boot 用の md が RAID1 2 台で ext4', bootMd?.level === 'raid1' && bootMd.devices === 2, show)
    check('LVM PV 用の md が RAID1 2 台', pvMd?.level === 'raid1' && pvMd.devices === 2, show)
    check(
      'md2 は組み立てられているが、フォーマットもマウントもされていない',
      dataMd !== undefined && dataMd.level === 'raid1' && dataMd.devices === 2,
      show,
    )
    // **`raid.name` がそのまま残るのは `/etc/mdadm/mdadm.conf` の ARRAY 行**。
    // md のメタデータの `Name:` は `<homehost>:0` のように**数字になる**
    // （mdadm は `/dev/mdN` から名前を N と決めるので、`md0` と付けても metadata は `0`）。
    // ここを取り違えると「名前が消えた」という嘘の失敗を出す（実際に出した）。
    const confDevs = field('MDADM_CONF_DEVS').split(/\s+/).filter(Boolean)
    check(
      'mdadm.conf の ARRAY が /dev/md0 /dev/md1 /dev/md2',
      ['/dev/md0', '/dev/md1', '/dev/md2'].every((d) => confDevs.includes(d)),
      confDevs.join(' '),
    )
    // メタデータ側は `<homehost>:0` `:1` `:2` になる（上の理由）。
    const names = mds.map((m) => m.name).join(' ')
    check(
      'md のメタデータ名が 0 / 1 / 2（mdadm が /dev/mdN から決める形）',
      ['0', '1', '2'].every((n) => names.split(/\s+/).some((v) => v.endsWith(`:${n}`))),
      names,
    )

    const pvs = lines.filter((l) => l.startsWith('LVM_PV=')).map((l) => l.slice(7).trim())
    const lvs = lines.filter((l) => l.startsWith('LVM_LV=')).map((l) => l.slice(7).trim())
    check('vg0 の PV が md（RAID）である', pvs.some((v) => /^\/dev\/md\d+\|vg0$/.test(v)), pvs.join(' / '))
    check('vg0/lv-0 がある', lvs.includes('lv-0|vg0'), lvs.join(' / '))
    const rootLine = lines.find((l) => l.startsWith('ルート: ')) ?? '(見つからない)'
    check('ルートが vg0/lv-0 の LV', rootLine.includes('vg0-lv--0'), rootLine)

    // **丸ごとメンバー (`usage: 'whole'`) が意図どおり出たか。**
    // これは「md2 の上に何も無い」とは別の性質で、ここでしか機械で言えない。
    // メンバー名が `/dev/loopN`（末尾に `pN` が無い）ならディスク丸ごと。
    const isWholeDisk = (d: string): boolean => /^\/dev\/loop\d+$/.test(d)
    check(
      'md2 のメンバーはディスク丸ごと（パーティションを 1 つも切っていない）',
      dataMd !== undefined && dataMd.members.length === 2 && dataMd.members.every(isWholeDisk),
      dataMd?.members.join(' ') ?? '(md2 が無い)',
    )
    // 逆に、パーティションを切るディスクの配列は**パーティション**をメンバーにする。
    check(
      '/boot と LVM PV の md はパーティションをメンバーにしている',
      [bootMd, pvMd].every(
        (m) => m !== undefined && m.members.length === 2 && m.members.every((d) => !isWholeDisk(d)),
      ),
      `${bootMd?.members.join(' ') ?? '?'} / ${pvMd?.members.join(' ') ?? '?'}`,
    )

    // ESP は RAID に置けないので、**作った台数がそのまま「起動を支える台数」**（落とし穴 97）。
    check('ESP は 1 つだけ', field('ESP_PARTS') === '1', `実際 "${field('ESP_PARTS')}"`)
    check('ESP があるのは sda だけ', field('ESP_DISKS') === 'sda', `実際 "${field('ESP_DISKS')}"`)

    const mounts = field('FSTAB_MOUNTS').split(/\s+/).filter(Boolean)
    check(
      'fstab に / と /boot と /boot/efi がある',
      ['/', '/boot', '/boot/efi'].every((m) => mounts.includes(m)),
      mounts.join(' '),
    )
    // **無いことの確認**。md2 用のマウントが紛れ込んでいたら「作るだけ」になっていない。
    // `FSTAB_MOUNTS` は `/` で始まる列だけを出す（swap の行は 2 列目が `none`）。
    check('fstab に余分なマウントが無い（md2 はマウントされない）', mounts.length === 3, mounts.join(' '))
    check(
      '/etc/mdadm/mdadm.conf に ARRAY 行が 3 本',
      field('MDADM_CONF_ARRAYS') === '3',
      `実際 "${field('MDADM_CONF_ARRAYS')}"`,
    )
  }

  // --- 5b-ip. `ip` モードだけ: 起動メニューで選んだ IP が反映されたか ------
  //
  // **層を分けて見る**（落とし穴 93 / 112）:
  //   1. early-commands が「反映した」と記録したか（`RUNTIME_APPLIED`）
  //   2. その結果が実際に設定に入っているか（`NETPLAN_ADDRESSES`）
  //   3. **選ばなかった値が入っていないこと**（「たまたま何か入っていた」を排除する）
  //
  // 1 を見ないと「プロファイルの既定値がたまたま同じ」でも通ってしまう。
  // 3 を見ないと「全部の IP が入っている」壊れ方を見逃す。
  if (MODE === 'ip') {
    const chosen = profile.runtimeValues.presets[IP_PRESET_INDEX - 1]
    const notChosen = profile.runtimeValues.presets
      .filter((_, i) => i !== IP_PRESET_INDEX - 1)
      .map((p) => p.ipv4)
    const fallback = addressOf(profile)
    const addrs = field('NETPLAN_ADDRESSES').split(/\s+/).filter(Boolean)
    console.log(`    netplan のアドレス: ${addrs.join(' ') || '(空)'}`)
    console.log(`    early-commands の記録: ${field('RUNTIME_APPLIED_LINE') || '(無い)'}`)

    check(
      'early-commands が「反映した」と記録している',
      field('RUNTIME_APPLIED').split(/\s+/).filter(Boolean).includes('ai.ipv4'),
      `実際 "${field('RUNTIME_APPLIED')}"`,
    )
    check(
      `**選んだ IP (${chosen?.ipv4}) が入っている**`,
      chosen !== undefined && addrs.includes(chosen.ipv4),
      `実際 "${addrs.join(' ')}"`,
    )
    check(
      `**予備の値 (${fallback}) は入っていない**`,
      addrs.length > 0 && !addrs.includes(fallback),
      '入っていたら、起動メニューの指定が届いていない',
    )
    check(
      '**選ばなかった IP は入っていない**',
      addrs.length > 0 && notChosen.every((ip) => !addrs.includes(ip)),
      `選ばなかった: ${notChosen.join(' ')} / 実際: ${addrs.join(' ')}`,
    )
    check(
      'アドレスがちょうど 1 つ',
      addrs.length === 1,
      `実際 ${addrs.length} 個: ${addrs.join(' ')}`,
    )
    // **「IP だけ別」なので、ホスト名はサンプルのまま**でなければならない。
    check(
      'ホスト名はサンプルのまま（IP だけが変わる）',
      field('HOSTNAME') === profile.basics.hostname,
      `期待 ${profile.basics.hostname} / 実際 "${field('HOSTNAME')}"`,
    )
  }

  // --- 5c. `mirror` モードだけ: ESP のミラーと bond ------------------------
  // **ここが「残っていた 2 つの未検証項目」そのもの。**
  if (MODE === 'mirror') {
    // (1) ESP は 2 台に作られたか
    check('ESP が 2 つある', field('ESP_PARTS') === '2', `実際 "${field('ESP_PARTS')}"`)
    check(
      'ESP が sda と sdb の両方にある',
      ['sda', 'sdb'].every((d) => field('ESP_DISKS').split(/\s+/).includes(d)),
      `実際 "${field('ESP_DISKS')}"`,
    )
    // (2) **2 台目への GRUB 導入が実際に走ったか。**
    //     `grub_device` は 1 台目にしか付かないので（落とし穴 98）、
    //     2 台目は late-commands の複製に頼っている。
    //     ログが無い＝**コマンドが 1 行も出ていない**（`raid` モードがその状態だった）。
    check(
      '2 台目への GRUB 導入が走った（ログがある）',
      field('ESP_MIRROR_RESULT') !== 'none' && field('ESP_MIRROR_RESULT') !== '',
      `実際 "${field('ESP_MIRROR_RESULT')}"`,
    )
    check(
      '2 台目への GRUB 導入が成功した',
      field('ESP_MIRROR_RESULT') === 'ok',
      `実際 "${field('ESP_MIRROR_RESULT')}"（incomplete なら複製に落ちている）`,
    )
    // (3) **ログが ok でも、中身が空なら起動しない。** 実際に開いて確かめる。
    check(
      '両方の ESP に起動できるものが入っている',
      field('ESP_WITH_LOADER') === '2',
      `実際 "${field('ESP_WITH_LOADER')}" / 2`,
    )

    // (4) bond の設定が subiquity に渡ったか
    //
    // **この時点で見えるのは `/etc/cloud/cloud.cfg.d/90-installer-network.cfg` だけ。**
    // `/etc/netplan/50-cloud-init.yaml` を書き出すのは**初回起動時の cloud-init** なので、
    // インストール直後には存在しない。以前ここで `/etc/netplan` だけを見て
    // 「bonds が無い」と 4 件の偽 FAIL を出した（落とし穴 112。管理ユーザーの
    // 落とし穴 93 とまったく同じ形）。**実際に描画される層は起動後にもう一度見る**（6b）。
    console.log(`    netplan の出どころ: ${field('NETPLAN_SOURCE')}`)
    check(
      'bond の設定が読める（インストール直後は installer-cfg）',
      field('NETPLAN_SOURCE') !== 'none' && field('NETPLAN_SOURCE') !== '',
      `実際 "${field('NETPLAN_SOURCE')}"`,
    )
    check('netplan に bonds がある', field('NETPLAN_HAS_BONDS') === 'yes')
    check(
      'bond の名前が設定どおり',
      field('BOND_NAMES').split(/\s+/).includes('bond0'),
      `実際 "${field('BOND_NAMES')}"`,
    )
    check(
      'bond のメンバーが 2 枚',
      field('BOND_MEMBERS').split(/\s+/).filter(Boolean).length === 2,
      `実際 "${field('BOND_MEMBERS')}"`,
    )
    check(
      'bond のモードが active-backup',
      field('BOND_MODE') === 'active-backup',
      `実際 "${field('BOND_MODE')}"`,
    )
    // **落とし穴 100**: メンバー側にアドレスを付けない（付けるのは bond 側）。
    //
    // これは「無いこと」の確認なので、**素直に書くと空文字でも通る**
    // ——インストールが 1 バイトも書けていないときにこの 1 件だけ ok になり、
    // 「何かは動いている」ように見える（実際に 24 件中これだけ ok になった）。
    // **読めた設定に対する判定であること**を前提に付ける。
    check(
      'メンバー側にアドレスが付いていない',
      field('NETPLAN_SOURCE') !== '' &&
        field('NETPLAN_SOURCE') !== 'none' &&
        field('ETHERNETS_HAS_ADDRESSES') !== 'yes',
      `source="${field('NETPLAN_SOURCE')}" addresses="${field('ETHERNETS_HAS_ADDRESSES')}"`,
    )
  }

  // --- 6. **インストールしたシステムを実際に起動する** --------------------
  // ここまでは「インストールが終わった」ことしか見ていない。
  // **起動するか**は別の話で、引き継ぎ資料が最初から残している項目そのもの。
  // ログインプロンプトには**ホスト名が出る**ので、
  // 「起動した」と「ホスト名が効いた」を同時に確かめられる。
  console.log('\n■ インストールしたシステムを起動します')
  let sawLogin = false
  let sawKernel = false
  const bootRc = await wslStream(
    `VM_TIMEOUT=420 ${MODE === 'mirror' ? 'VM_NICS=2 ' : ''}bash ${REPO_WSL}/scripts/vm/run-vm.sh boot ${LAB} ${disks}`,
    (line) => {
      if (/Linux version|systemd\[1\]/i.test(line)) sawKernel = true
      // **テンプレートリテラルの中の `\s` は正規表現の `\s` にならない**（`s` 1 文字になる）。
      // この形だと「vm-raid s+login:」を探すことになり、**永久に一致しない**。
      // `RegExp` に渡す文字列では二重にエスケープする。
      if (new RegExp(`${profile.basics.hostname}\\s+login:`, 'i').test(line)) sawLogin = true
      if (/error|fail|panic|login:/i.test(line)) console.log(`  | ${line.trim().slice(0, 160)}`)
    },
  )
  check('インストールしたシステムのカーネルが起動した', sawKernel, `rc=${bootRc}`)
  check('ログインプロンプトがホスト名つきで出た', sawLogin, `期待 "${profile.basics.hostname} login:"`)

  // --- 7. 起動後にユーザーができたかを見る --------------------------------
  // cloud-init は初回起動で走る。**起動したあとなら居るはず。**
  console.log('\n■ 起動後のディスクをもう一度検査します')
  let after = ''
  try {
    after = wsl(`bash ${REPO_WSL}/scripts/vm/inspect-disks.sh ${LAB}`, 300_000)
  } catch (err) {
    const e = err as { stdout?: string; message?: string }
    after = `${e.stdout ?? ''}
${e.message ?? ''}`
  }
  const afterField = (name: string): string => {
    const m = new RegExp(`^${name}=(.*)$`, 'm').exec(after)
    return m?.[1]?.trim() ?? ''
  }
  console.log(
    after
      .split('\n')
      .filter((l) => /^(HOSTNAME|USERS|SUDO)=/.test(l))
      .join('\n'),
  )
  check(
    '初回起動で管理ユーザーが作られた',
    afterField('USERS').split(/\s+/).includes(profile.user.username),
    `実際 "${afterField('USERS')}"`,
  )
  check(
    '管理ユーザーが sudo に入っている',
    afterField('SUDO').split(',').includes(profile.user.username),
    `実際 "${afterField('SUDO')}"`,
  )

  // --- 7b-ip. 起動後にもう一度、IP を見る --------------------------------
  // 5b-ip で見たのは **subiquity が書いた設定**（installer-cfg か、
  // 運が良ければ netplan）。ここで見るのは **cloud-init が初回起動で
  // 書き出した `/etc/netplan/50-cloud-init.yaml`**。別の層なので両方見る。
  if (MODE === 'ip') {
    const chosen = profile.runtimeValues.presets[IP_PRESET_INDEX - 1]
    const after = afterField('NETPLAN_ADDRESSES').split(/\s+/).filter(Boolean)
    console.log(`    起動後のアドレス: ${after.join(' ') || '(空)'} (出どころ ${afterField('NETPLAN_SOURCE')})`)
    check(
      '初回起動で cloud-init が netplan を書き出した',
      afterField('NETPLAN_SOURCE') === 'netplan',
      `実際 "${afterField('NETPLAN_SOURCE')}"`,
    )
    check(
      `**書き出された netplan にも選んだ IP (${chosen?.ipv4}) が入っている**`,
      chosen !== undefined && after.includes(chosen.ipv4),
      `実際 "${after.join(' ')}"`,
    )
  }

  // --- 7b. bond は「渡ったか」と「描画されたか」を別々に見る --------------
  // 5c で見たのは subiquity が書いた `90-installer-network.cfg`（＝設定が渡った）。
  // ここで見るのは **cloud-init が初回起動で書き出した `/etc/netplan/50-cloud-init.yaml`**
  // （＝実際にその形で描画された）。**別の層なので両方見る**（落とし穴 93 / 112）。
  // なお cloud-init は値をクォートして書き出す（`mode: "active-backup"`）ので、
  // 検査側はクォートを落として読む（`inspect-disks.sh`）。
  if (MODE === 'mirror') {
    console.log(`    起動後の netplan の出どころ: ${afterField('NETPLAN_SOURCE')}`)
    check(
      '初回起動で cloud-init が netplan を書き出した',
      afterField('NETPLAN_SOURCE') === 'netplan',
      `実際 "${afterField('NETPLAN_SOURCE')}"`,
    )
    check(
      '書き出された netplan にも bond がある',
      afterField('NETPLAN_HAS_BONDS') === 'yes' &&
        afterField('BOND_NAMES').split(/\s+/).includes('bond0'),
      `bonds="${afterField('NETPLAN_HAS_BONDS')}" names="${afterField('BOND_NAMES')}"`,
    )
    check(
      '書き出された netplan のメンバーが 2 枚でモードが active-backup',
      afterField('BOND_MEMBERS').split(/\s+/).filter(Boolean).length === 2 &&
        afterField('BOND_MODE') === 'active-backup',
      `members="${afterField('BOND_MEMBERS')}" mode="${afterField('BOND_MODE')}"`,
    )

    // **第 3 の層: 実際にリンクが上がったか。**
    // ここまでは「そう書かれた」だけで、bond が成立したかは 1 度も見ていない
    // （引き継ぎ資料が「bond が実際にリンクを上げるか。VM でも実機でも未検証」と
    // 書き続けてきた項目そのもの）。起動したシステムのログにしか残らない。
    console.log(
      `    bond0 のログ: seen=${afterField('BOND_LOG_SEEN')} carrier=${afterField(
        'BOND_CARRIER',
      )} address=${afterField('BOND_ADDRESS')}`,
    )
    check(
      'bond0 のログが残っている',
      afterField('BOND_LOG_SEEN') === 'yes',
      'rsyslog も journal も読めないと空になる（＝「上がらなかった」ではない）',
    )
    check(
      '**bond0 のリンクが上がった**',
      afterField('BOND_CARRIER') === 'yes',
      `実際 "${afterField('BOND_CARRIER')}"`,
    )
    check(
      '**bond0 に IPv4 アドレスが付いた**',
      /^\d+\.\d+\.\d+\.\d+/.test(afterField('BOND_ADDRESS')),
      `実際 "${afterField('BOND_ADDRESS')}"`,
    )
    // **落とし穴 100 をここで捕まえる。**
    // netplan に 2 枚と書いてあることと、カーネルが実際に 2 枚束ねたことは別。
    // 「2 枚あるつもりの冗長化が 1 枚」は実機で片方を抜くまで気づけないので、
    // カーネルの `Enslaving as ...` の行を数える。
    check(
      '**カーネルが 2 枚とも束ねた**（1 枚だけの冗長化になっていない）',
      afterField('BOND_SLAVES') === '2',
      `実際 "${afterField('BOND_SLAVES')}" 枚`,
    )
    check(
      'active-backup として active 1 枚 + backup 1 枚になった',
      afterField('BOND_ACTIVE_SLAVES') === '1' && afterField('BOND_BACKUP_SLAVES') === '1',
      `active=${afterField('BOND_ACTIVE_SLAVES')} backup=${afterField('BOND_BACKUP_SLAVES')}`,
    )
  }

  console.log(`\n${pass + fail} 件中 ${pass} 件成功、${fail} 件失敗`)
  console.log(`VM のディスク: \\\\wsl$\\${DISTRO}${LAB.replace(/\//g, '\\')}`)
  await rm(workDir, { recursive: true, force: true })
  process.exit(fail > 0 ? 1 : 0)
}

await main()
