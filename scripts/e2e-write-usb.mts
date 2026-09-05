/**
 * 実 USB への書き込み E2E。**管理者権限で実行すること。**
 *
 *   Windows: 管理者の PowerShell で
 *            npx tsx scripts/e2e-write-usb.mts
 *   Linux/macOS:
 *            sudo npx tsx scripts/e2e-write-usb.mts
 *
 * オプション:
 *   --device <id>   書き込み先（省略時は唯一の USB を自動選択）
 *   --iso <path>    使う ISO（省略時は ~/images の live-server を新しい順に）
 *   --yes           確認プロンプトを出さない
 *
 * GUI と同じ設定（起動メニューでホストを選ぶ + 上級者向けキー）を作り、
 * 同じライブラリ経路で書いてから読み戻して検証する。
 * GUI からの書き込みは main の WriteSupervisor が昇格プロセスを起こして
 * これと同じ executeWritePlan を呼ぶので、書き込み結果は同じものになる。
 */
import { createInterface } from 'node:readline/promises'
import { randomBytes } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  FileBlockDevice,
  RawBlockDevice,
  buildIsoPatches,
  executeWritePlan,
  getPlatformOps,
  inspectIso,
  minimumDiskSize,
  planUsbLayout,
  parseMbr,
  readFatImage,
  readGpt,
  readIsoStructure,
  resolvePath,
  readFile as readIsoFile,
  CIDATA_LABEL,
  SECTOR_SIZE,
} from '../packages/media/src/index.js'
import {
  buildGrubPlan,
  createDefaultProfile,
  generateMetaData,
  generateUserData,
  recognizeIso,
  validateProfile,
  type AutoinstallProfile,
} from '../packages/shared/src/index.js'
import { sha512Crypt } from '../packages/shared/src/crypt/sha512crypt.js'

const HASH = sha512Crypt('E2e-Passw0rd!-long', { salt: 'e2eusb00' })

let checks = 0
let failures = 0
const failed: string[] = []
function check(label: string, cond: boolean, detail = ''): void {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    failed.push(label)
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

/** GUI で作ったのと同じ設定（起動メニュー + 上級者向け）。 */
function buildProfile(series: AutoinstallProfile['series']): AutoinstallProfile {
  const b = createDefaultProfile(series, 'e2e-usb/0.1.0', new Date().toISOString())
  return {
    ...b,
    meta: { ...b.meta, name: 'e2e-usb' },
    basics: { ...b.basics, hostname: 'e2e-gui', locale: 'ja_JP.UTF-8', timezone: 'Asia/Tokyo' },
    user: { ...b.user, realname: 'E2E Admin', username: 'e2eadmin', passwordHash: HASH },
    network: {
      mode: 'static',
      target: { kind: 'any' },
      address: '192.168.1.50/24',
      gateway: '192.168.1.1',
      nameservers: ['1.1.1.1', '8.8.8.8'],
      searchDomains: [],
      optional: false,
    },
    storage:
      b.storage.mode === 'raw'
        ? b.storage
        : {
            ...b.storage,
            match: { kind: 'serial', serial: 'FALLBACKSERIAL01' },
            swap: { mode: 'size', size: '4G' },
          },
    postInstall: {
      ...b.postInstall,
      debconfSelections: 'postfix postfix/main_mailer_type select No configuration',
    },
    behavior: {
      ...b.behavior,
      reporting: { kind: 'webhook', endpoint: 'https://hooks.example.local/e2e' },
    },
    runtimeValues: {
      hostname: 'kernel-arg',
      network: 'kernel-arg',
      disk: 'kernel-arg',
      offerInteractiveEntry: true,
      presets: [
        { id: 'p1', label: 'web01', hostname: 'web01', ipv4: '192.168.1.11/24', gateway: '192.168.1.1', nameservers: '1.1.1.1,8.8.8.8', disk: 'S3Y1NB0K100001' },
        { id: 'p2', label: 'web02', hostname: 'web02', ipv4: '192.168.1.12/24', gateway: '192.168.1.1', nameservers: '1.1.1.1,8.8.8.8', disk: 'S3Y1NB0K100002' },
        { id: 'p3', label: 'db01', hostname: 'db01', ipv4: '192.168.1.21/24', gateway: '192.168.1.1', nameservers: '1.1.1.1', disk: 'S3Y1NB0K100003' },
      ],
    },
  }
}

async function findIso(): Promise<string> {
  const explicit = arg('iso')
  if (explicit) return explicit
  const dir = join(homedir(), 'images')
  const names = (await readdir(dir)).filter((n) => /live-server.*\.iso$/i.test(n)).sort()
  const last = names.at(-1)
  if (!last) throw new Error(`${dir} に live-server の ISO が見つかりません`)
  return join(dir, last)
}

async function main(): Promise<void> {
  const ops = getPlatformOps()
  if (!(await ops.hasWriteAccess())) {
    console.error('管理者権限がありません。管理者の PowerShell（または sudo）で実行してください。')
    process.exit(2)
  }

  const devices = await ops.listDevices()
  const explicit = arg('device')
  const target = explicit
    ? devices.find((d) => d.id === explicit)
    : devices.filter((d) => d.selectable && d.bus === 'usb')[0]
  if (!target) {
    console.error('書き込み先の USB が見つかりません。--device で指定してください。')
    console.error(devices.map((d) => `  ${d.id} ${d.description} selectable=${d.selectable}`).join('\n'))
    process.exit(2)
  }
  if (!target.selectable) {
    console.error(`${target.id} には書き込めません: ${target.blockedReason ?? '理由不明'}`)
    process.exit(2)
  }

  const isoPath = await findIso()
  console.log(`ISO   : ${basename(isoPath)}`)
  console.log(`書き込み先: ${target.id} ${target.description} ${(target.sizeBytes / 1e9).toFixed(2)} GB`)
  console.log(`マウント : ${target.mountpoints.join(', ') || 'なし'}`)

  if (!process.argv.includes('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const a = await rl.question('このデバイスの中身はすべて消えます。続けるには「消去」と入力: ')
    rl.close()
    if (a.trim() !== '消去') {
      console.log('中止しました。')
      process.exit(1)
    }
  }

  const iso = await FileBlockDevice.open(isoPath, 'r')
  try {
    const inspection = await inspectIso(iso)
    const recognized = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
    if (recognized.kind !== 'supported') {
      console.error(`live-server として認識できません: ${inspection.volumeId}`)
      process.exit(2)
    }
    const profile = buildProfile(recognized.identity.series)
    const v = validateProfile(profile)
    check('設定が検証を通る', v.ok, v.issues.filter((i) => i.severity === 'error').map((i) => i.messageJa).join(' / '))

    const userData = generateUserData(profile, { comments: 'ja' })
    const metaData = generateMetaData(`autoinstall-${profile.basics.hostname}`)
    const grubPlan = buildGrubPlan(profile)
    const patchPlan = buildIsoPatches(inspection, {
      args: grubPlan.args,
      markTitle: true,
      extraEntries: grubPlan.entries,
    })
    console.log(`grub.cfg: ${Buffer.byteLength(patchPlan.newGrubCfg, 'utf8')} バイト / メニュー ${grubPlan.entries.length} 件`)

    const plan = await planUsbLayout({
      isoDevice: iso,
      diskSizeBytes: target.sizeBytes,
      patches: patchPlan.patches,
      seedFiles: [
        { name: 'user-data', content: Buffer.from(userData, 'utf8') },
        { name: 'meta-data', content: Buffer.from(metaData, 'utf8') },
      ],
      random: (n) => randomBytes(n),
      timestamp: new Date(),
    })
    check('必要な容量に収まる', target.sizeBytes >= minimumDiskSize((await stat(isoPath)).size))

    console.log('\n書き込み準備（アンマウント / ボリュームのロック）…')
    await ops.prepareForWrite(target.id)

    // 実デバイスは RawBlockDevice を使う。FileBlockDevice の fs.open は Windows の
    // 物理ドライブ (\\.\PhysicalDriveN) に対して EINVAL を返す。
    // セクタ境界・セクタ長でしか I/O できないため専用の実装が要る。
    // 製品のワーカー (packages/media/src/worker/run.ts) も同じものを使う。
    const dev = await RawBlockDevice.open(target.id, { sizeBytes: target.sizeBytes })
    const started = Date.now()
    let lastPct = -1
    try {
      const result = await executeWritePlan({
        plan,
        isoDevice: iso,
        targetDevice: dev,
        patches: patchPlan.patches,
        verify: true,
        onProgress: (p) => {
          const pct = Math.floor((p.bytesDone / p.bytesTotal) * 100)
          if (pct !== lastPct) {
            lastPct = pct
            process.stdout.write(`\r  ${p.phase} ${pct}%   `)
          }
        },
      })
      process.stdout.write('\r'.padEnd(40) + '\r')
      console.log(
        `書き込み完了: ${(result.bytesWritten / 1e9).toFixed(2)} GB / ${((Date.now() - started) / 1000).toFixed(1)} 秒`,
      )
      check('読み戻し検証に成功', result.verified)
    } finally {
      await dev.close()
    }

    console.log('\n■ 実デバイスを読み戻して検証')
    const back = await RawBlockDevice.open(target.id, { sizeBytes: target.sizeBytes })
    try {
      const mbr = parseMbr(await back.read(0, SECTOR_SIZE))
      check('protective MBR がある', mbr.valid && mbr.isProtective)
      check('GRUB のブートコードが残っている', mbr.hasBootCode)

      const gpt = await readGpt(back)
      check('GPT が読める', gpt !== null && gpt.headerCrcValid && gpt.entriesCrcValid)
      const backup = await readGpt(back, Math.floor(target.sizeBytes / SECTOR_SIZE) - 1)
      check('バックアップ GPT が末尾にある', backup !== null && backup.headerCrcValid)
      if (!gpt) return
      console.log('       ' + gpt.entries.map((e) => e.name).join(', '))

      const structure = await readIsoStructure(back)
      check('Volume ID が保たれている', structure.pvd.volumeId === inspection.volumeId, structure.pvd.volumeId)
      const grub = await resolvePath(back, structure.pvd.rootRecord, '/boot/grub/grub.cfg')
      check('grub.cfg が解決できる', grub !== null)
      if (grub) {
        const text = (await readIsoFile(back, grub.record)).toString('utf8')
        check('grub.cfg が計画どおり', text === patchPlan.newGrubCfg)
        for (const h of ['web01', 'web02', 'db01']) {
          check(`grub.cfg に ${h} の menuentry がある`, text.includes(`ai.hostname=${h}`))
        }
        check('手入力のエントリがある', text.includes('ai.interactive=1'))
      }

      const cidata = gpt.entries.find((e) => e.name === CIDATA_LABEL)
      check('CIDATA パーティションがある', cidata !== undefined)
      if (cidata) {
        const bytes = (cidata.endLba - cidata.startLba + 1) * SECTOR_SIZE
        const fs = readFatImage(await back.read(cidata.startLba * SECTOR_SIZE, bytes))
        check('CIDATA のラベルが CIDATA', fs.label === 'CIDATA', fs.label)
        const ud = fs.files.find((f) => f.name === 'user-data')
        check('user-data がバイト単位で一致', ud?.content.toString('utf8') === userData)
        check('meta-data がバイト単位で一致',
          fs.files.find((f) => f.name === 'meta-data')?.content.toString('utf8') === metaData)
        check('パスワードが平文で入っていない', !(ud?.content.toString('utf8') ?? '').includes('E2e-Passw0rd'))
      }
    } finally {
      await back.close()
    }

    console.log('\n後始末（再スキャン / イジェクト）…')
    await ops.finishWrite(target.id)
  } finally {
    await iso.close()
  }

  console.log(`\n${checks} 件中 ${checks - failures} 件成功、${failures} 件失敗`)
  if (failures > 0) {
    console.error('失敗:\n' + failed.map((f) => `  - ${f}`).join('\n'))
    process.exit(1)
  }
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
