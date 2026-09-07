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
 *   VM_DISKS="sda:450G sdb:450G" ...   ディスク構成を変える
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  createDefaultProfile,
  generateMetaData,
  generateUserData,
  validateProfile,
  formatLocalized,
  recognizeIso,
} from '../packages/shared/src/index.js'
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

/** 対応している ISO を 1 本探す。 */
async function findIso(): Promise<string | null> {
  const explicit = process.argv.slice(2).find((a) => a.toLowerCase().endsWith('.iso'))
  if (explicit !== undefined) return explicit
  for (const dir of [join(homedir(), 'images'), join(homedir(), 'Downloads'), 'C:/iso']) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.iso')) continue
      const path = join(dir, name)
      let dev: FileBlockDevice | null = null
      try {
        dev = await FileBlockDevice.open(path, 'r')
        const info = await inspectIso(dev)
        if (recognizeIso(info.volumeId, info.diskInfo ?? undefined).kind === 'supported') return path
      } catch {
        // 対応していない ISO は飛ばす
      } finally {
        await dev?.close().catch(() => undefined)
      }
    }
  }
  return null
}

async function main(): Promise<void> {
  printRevisionBanner('scripts/e2e-vm.mts')

  const isoPath = await findIso()
  if (isoPath === null) {
    console.log('対応する ISO が見つからないのでスキップします（異常ではありません）。')
    return
  }
  console.log(`ISO   : ${basename(isoPath)}`)

  // --- 1. 設定 -----------------------------------------------------------
  // インストール後に見分けられる値にする。
  const base = createDefaultProfile('24.04')
  const profile = {
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
  const validation = validateProfile(profile)
  check(
    '設定が検証を通る',
    validation.ok,
    validation.issues.map((i) => formatLocalized('ja', i.text)).join(' / '),
  )

  // --- 2. イメージを作る --------------------------------------------------
  const workDir = join(process.env['TEMP'] ?? '/tmp', `vm-e2e-${randomBytes(4).toString('hex')}`)
  await mkdir(workDir, { recursive: true })
  const imgPath = join(workDir, 'usb.img')
  const iso = await FileBlockDevice.open(isoPath, 'r')
  try {
    const inspection = await inspectIso(iso)
    const patchPlan = buildIsoPatches(inspection, { args: ['autoinstall'], markTitle: true })
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
        { name: 'meta-data', content: Buffer.from(generateMetaData('vm-e2e'), 'utf8') },
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
  const disks = process.env['VM_DISKS'] ?? 'sda:20G'
  console.log(`\n■ 無人インストールを開始します（ディスク: ${disks}）`)
  console.log('  シリアルの出力で進行を追います。数分〜十数分かかります。\n')

  // 前回のディスクが残っていると「前の結果」を見てしまう。必ず消してから始める。
  wsl(`rm -f ${LAB}/*.qcow2 ${LAB}/OVMF_VARS.fd`)

  let sawInstaller = false
  let sawComplete = false
  let lastShown = 0
  const rc = await wslStream(
    `bash ${REPO_WSL}/scripts/vm/run-vm.sh install ${wslImg} ${LAB} ${disks}`,
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
  check('ESP と /boot が fstab に載っている', /\/boot\/efi/.test(report))

  // --- 6. **インストールしたシステムを実際に起動する** --------------------
  // ここまでは「インストールが終わった」ことしか見ていない。
  // **起動するか**は別の話で、引き継ぎ資料が最初から残している項目そのもの。
  // ログインプロンプトには**ホスト名が出る**ので、
  // 「起動した」と「ホスト名が効いた」を同時に確かめられる。
  console.log('\n■ インストールしたシステムを起動します')
  let sawLogin = false
  let sawKernel = false
  const bootRc = await wslStream(
    `VM_TIMEOUT=420 bash ${REPO_WSL}/scripts/vm/run-vm.sh boot ${LAB} ${disks}`,
    (line) => {
      if (/Linux version|systemd\[1\]/i.test(line)) sawKernel = true
      if (new RegExp(`${profile.basics.hostname}\s+login:`, 'i').test(line)) sawLogin = true
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

  console.log(`\n${pass + fail} 件中 ${pass} 件成功、${fail} 件失敗`)
  console.log(`VM のディスク: \\\\wsl$\\${DISTRO}${LAB.replace(/\//g, '\\')}`)
  await rm(workDir, { recursive: true, force: true })
  process.exit(fail > 0 ? 1 : 0)
}

await main()
