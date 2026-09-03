/**
 * 実 ISO ファイルに対する E2E スモークテスト。
 *
 * 単体テストは疎なフィクスチャ（実 ISO から抜いたセクタ）で回しているが、
 * ここでは本物の ISO ファイル全体を読み、実際に .img へ書き出して読み戻す。
 * 「USB に書く」以外のすべての経路を本物のデータで通す。
 *
 *   npm run smoke                      # 既定の探索パスから ISO を探す
 *   npm run smoke -- <iso> [<iso>...]  # ISO を明示指定
 *
 * ISO が 1 つも見つからない場合はスキップして正常終了する（CI でも落とさないため）。
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, basename } from 'node:path'
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
  CIDATA_LABEL,
  SECTOR_SIZE,
  IsoValidationError,
} from '../packages/media/src/index.js'
import {
  createDefaultProfile,
  generateUserData,
  generateMetaData,
  recognizeIso,
  validateProfile,
} from '../packages/shared/src/index.js'
import { sha512Crypt } from '../packages/shared/src/crypt/sha512crypt.js'

const HASH = sha512Crypt('smoke-test-password', { salt: 'smokesalt' })

let failures = 0
let checks = 0

function check(label: string, condition: boolean, detail = ''): void {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

/** ISO を探す。引数優先、無ければ既定の場所を見る。 */
async function findIsos(): Promise<string[]> {
  const args = process.argv.slice(2)
  if (args.length > 0) return args
  const dirs = [join(homedir(), 'images'), join(homedir(), 'Downloads'), 'C:/iso', '/var/lib/iso']
  const found: string[] = []
  for (const dir of dirs) {
    try {
      for (const name of await readdir(dir)) {
        if (name.toLowerCase().endsWith('.iso')) found.push(join(dir, name))
      }
    } catch {
      // ディレクトリが無いのは正常
    }
  }
  return found
}

/** 対応していない ISO が、原因の分かるエラーで拒否されることを確かめる。 */
async function checkRejection(path: string): Promise<void> {
  console.log(`\n[拒否されるべき] ${basename(path)}`)
  const dev = await FileBlockDevice.open(path, 'r')
  try {
    const inspection = await inspectIso(dev).catch((err: unknown) => err)
    if (inspection instanceof IsoValidationError) {
      check('分かるエラーで拒否される', true)
      console.log(`       理由: ${inspection.reason} — ${inspection.message}`)
      return
    }
    if (inspection instanceof Error) {
      check('分かるエラーで拒否される', false, inspection.message)
      return
    }
    // ISO9660 としては読めたが Ubuntu Server ではないケース
    const recognized = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
    check('Ubuntu Server として認識されない', recognized.kind === 'unsupported')
    if (recognized.kind === 'unsupported') {
      console.log(`       理由: ${recognized.reason} — ${recognized.detail}`)
    }
  } finally {
    await dev.close()
  }
}

/** live-server ISO を実際に書き出し、読み戻して検証する。 */
async function checkFullWrite(path: string): Promise<void> {
  console.log(`\n[USB 作成] ${basename(path)}`)
  const fileStat = await stat(path)
  const iso = await FileBlockDevice.open(path, 'r')
  const workDir = await mkdtemp(join(tmpdir(), 'autoinstall-smoke-'))
  const imagePath = join(workDir, 'usb.img')

  try {
    // --- 1. 検査 ---
    const inspection = await inspectIso(iso)
    const recognized = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
    check('live-server として認識される', recognized.kind === 'supported', inspection.volumeId)
    if (recognized.kind !== 'supported') return
    console.log(
      `       ${recognized.identity.version} ${recognized.identity.arch}` +
        ` (${recognized.identity.codename ?? '?'}) / ${(fileStat.size / 1e9).toFixed(2)} GB`,
    )
    check('casper に vmlinuz と initrd がある', inspection.casperFiles.includes('vmlinuz') && inspection.casperFiles.includes('initrd'))
    check('md5sum.txt がある', inspection.md5sum !== null)
    check('Joliet ツリーにも grub.cfg がある', inspection.grubCfgJoliet !== null)

    // --- 2. 設定の生成 ---
    const base = createDefaultProfile(recognized.identity.series, 'smoke/0.1.0', '2026-09-03T00:00:00.000Z')
    const profile = {
      ...base,
      basics: { ...base.basics, hostname: 'smoke-host', locale: 'ja_JP.UTF-8', timezone: 'Asia/Tokyo' },
      user: { ...base.user, username: 'smoke', passwordHash: HASH },
      postInstall: {
        ...base.postInstall,
        presets: ['chrony-ntp' as const, 'qemu-guest-agent' as const],
        files: [
          { name: 'motd.txt', targetPath: '/etc/motd', mode: '0644', owner: 'root', content: 'smoke test\n' },
        ],
      },
    }
    const validation = validateProfile(profile)
    check('生成した設定が検証を通る', validation.ok, validation.issues.map((i) => i.messageJa).join(' / '))
    const userData = generateUserData(profile, { comments: 'ja' })
    const metaData = generateMetaData('autoinstall-smoke')
    check('user-data が #cloud-config で始まる', userData.startsWith('#cloud-config\n'))
    check('user-data に autoinstall キーがある', userData.includes('\nautoinstall:'))
    check('user-data にパスワードハッシュが入る', userData.includes(HASH))

    // --- 3. レイアウト計画 ---
    const patchPlan = buildIsoPatches(inspection, { args: ['autoinstall'], markTitle: true })
    eq('パッチ数', patchPlan.patches.length, 4)
    check('改変後 grub.cfg に autoinstall が入る', patchPlan.newGrubCfg.includes('autoinstall'))
    check('改変後 grub.cfg が 2048 バイト以内', Buffer.byteLength(patchPlan.newGrubCfg, 'utf8') <= 2048)

    const diskSize = Math.max(minimumDiskSize(fileStat.size), 8 * 1000 * 1000 * 1000)
    const plan = await planUsbLayout({
      isoDevice: iso,
      diskSizeBytes: diskSize,
      patches: patchPlan.patches,
      seedFiles: [
        { name: 'user-data', content: Buffer.from(userData, 'utf8') },
        { name: 'meta-data', content: Buffer.from(metaData, 'utf8') },
        { name: 'motd.txt', content: Buffer.from('smoke test\n', 'utf8') },
      ],
      random: () => randomBytes(16),
      timestamp: new Date('2026-09-03T00:00:00Z'),
    })
    check('CIDATA が 1 MiB 境界に置かれる', (plan.cidata.startLba * SECTOR_SIZE) % (1024 * 1024) === 0)
    check(
      '書き込み量が ISO + CIDATA 程度',
      plan.totalBytes > fileStat.size * 0.99 && plan.totalBytes < fileStat.size + 80 * 1024 * 1024,
      `${(plan.totalBytes / 1e9).toFixed(2)} GB`,
    )

    // --- 4. 書き込み（.img ファイルへ） ---
    // 実デバイスと同じコードパスを通す。sparse ファイルなので実際のディスク使用量は少ない。
    const target = await FileBlockDevice.open(imagePath, 'w+')
    let lastPct = -1
    const started = Date.now()
    const result = await executeWritePlan({
      plan,
      isoDevice: iso,
      targetDevice: target,
      patches: patchPlan.patches,
      verify: true,
      onProgress: (p) => {
        const pct = Math.floor((p.bytesDone / p.bytesTotal) * 10) * 10
        if (pct !== lastPct && p.phase === 'writing') {
          lastPct = pct
          process.stdout.write(`\r       書き込み ${pct}%   `)
        }
      },
    })
    process.stdout.write('\r'.padEnd(30) + '\r')
    console.log(
      `       ${(result.bytesWritten / 1e9).toFixed(2)} GB を ${((Date.now() - started) / 1000).toFixed(1)} 秒で書き込み`,
    )
    check('読み戻し検証に成功', result.verified)
    await target.close()

    // --- 5. 書き出した .img を読み戻して検証 ---
    const img = await FileBlockDevice.open(imagePath, 'r')
    try {
      const mbr = parseMbr(await img.read(0, SECTOR_SIZE))
      check('protective MBR がある', mbr.valid && mbr.isProtective)
      check('GRUB のブートコードが残っている', mbr.hasBootCode)
      eq('MBR の 0xEE エントリがディスク全体を覆う', mbr.entries[0]!.sectors, Math.floor(diskSize / SECTOR_SIZE) - 1)

      const gpt = await readGpt(img)
      check('GPT が読める', gpt !== null)
      check('GPT ヘッダの CRC が正しい', gpt!.headerCrcValid)
      check('GPT エントリの CRC が正しい', gpt!.entriesCrcValid)
      eq('パーティション数', gpt!.entries.length, 4)
      check(
        'パーティション構成が期待どおり',
        gpt!.entries.map((e) => e.name).join(',') === `ISO9660,Appended2,Gap1,${CIDATA_LABEL}`,
        gpt!.entries.map((e) => e.name).join(','),
      )

      const backup = await readGpt(img, Math.floor(diskSize / SECTOR_SIZE) - 1)
      check('バックアップ GPT がディスク末尾にある', backup !== null && backup.headerCrcValid)

      // ISO9660 を読み直す
      const structure = await readIsoStructure(img)
      eq('Volume ID が保たれている', structure.pvd.volumeId, inspection.volumeId)
      const grub = await resolvePath(img, structure.pvd.rootRecord, '/boot/grub/grub.cfg')
      check('grub.cfg が解決できる', grub !== null)
      const grubText = (await readIsoFile(img, grub!.record)).toString('utf8')
      eq('grub.cfg が改変後の内容と一致', grubText, patchPlan.newGrubCfg)
      check('grub.cfg に autoinstall が入っている', grubText.includes('autoinstall'))

      // Joliet 側も同じサイズになっているか
      const jolietGrub = await resolvePath(img, structure.joliet!.rootRecord, '/boot/grub/grub.cfg', true)
      eq(
        'Joliet 側のサイズも更新されている',
        jolietGrub!.record.size,
        Buffer.byteLength(patchPlan.newGrubCfg, 'utf8'),
      )

      // md5sum.txt
      const md5 = await resolvePath(img, structure.pvd.rootRecord, '/md5sum.txt')
      const md5Text = (await readIsoFile(img, md5!.record)).toString('utf8')
      const line = md5Text.split('\n').find((l) => l.endsWith('  ./boot/grub/grub.cfg'))
      const expectedMd5 = createHash('md5').update(Buffer.from(patchPlan.newGrubCfg, 'utf8')).digest('hex')
      eq('md5sum.txt の grub.cfg 行が更新されている', line?.slice(0, 32), expectedMd5)

      // CIDATA パーティション
      const cidata = gpt!.entries.find((e) => e.name === CIDATA_LABEL)!
      const fatBytes = (cidata.endLba - cidata.startLba + 1) * SECTOR_SIZE
      const fs = readFatImage(await img.read(cidata.startLba * SECTOR_SIZE, fatBytes))
      eq('CIDATA のボリュームラベル', fs.label, 'CIDATA')
      check(
        'CIDATA に user-data / meta-data / motd.txt がある',
        ['meta-data', 'motd.txt', 'user-data'].every((n) => fs.files.some((f) => f.name === n)),
        fs.files.map((f) => f.name).join(','),
      )
      eq(
        'user-data の内容が一致',
        fs.files.find((f) => f.name === 'user-data')!.content.toString('utf8'),
        userData,
      )
      eq(
        'meta-data の内容が一致',
        fs.files.find((f) => f.name === 'meta-data')!.content.toString('utf8'),
        metaData,
      )
    } finally {
      await img.close()
    }
  } finally {
    await iso.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const isos = await findIsos()
  if (isos.length === 0) {
    console.log('ISO ファイルが見つかりませんでした。スモークテストをスキップします。')
    console.log('（明示するには: npm run smoke -- <iso のパス>）')
    return
  }

  const liveServer = isos.filter((p) => /live-server.*\.iso$/i.test(basename(p)))
  const others = isos.filter((p) => !liveServer.includes(p))

  console.log(`ISO を ${isos.length} 個検出（live-server: ${liveServer.length}）`)

  for (const p of others) await checkRejection(p)
  for (const p of liveServer) await checkFullWrite(p)

  console.log(`\n${checks} 件中 ${checks - failures} 件成功、${failures} 件失敗`)
  if (failures > 0) process.exit(1)
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
