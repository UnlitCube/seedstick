/**
 * 「設定から USB 書き込み用の `.img` を作る」経路の E2E 検証。
 *
 * `npm run smoke` も `.img` を書くが、あちらは **media パッケージを直接呼ぶ**
 * （`buildIsoPatches` → `planUsbLayout` → `executeWritePlan` を素で並べる）。
 * ここで通すのは **GUI が実際に通る経路** ——
 *
 *   ipc.ts の `startImageWrite` ハンドラがやること
 *     1. `checkImageDestination()`  保存先の許可（落とし穴 55）
 *     2. `prepareMedia()` 相当      `inspectIso` → `buildGrubPlan` → `buildIsoPatches`
 *                                   → `buildSeedBundle`
 *     3. `checkFreeSpace()`         書き始める前に空き容量を見る
 *     4. `WriteSupervisor.startImageWrite()`
 *   └ 進捗・完了・失敗は `WriteStatus` に流れる（renderer が購読しているもの）
 *
 * つまり **`WriteSupervisor` を実際に走らせて `.img` を作り、読み戻して照合する**。
 * ipcMain の配線と保存ダイアログだけが無い（それらは単体テストが見ている）。
 *
 *   npm run e2e:image                      # 既定の探索パスから ISO を探す
 *   npm run e2e:image -- <iso のパス>      # ISO を明示指定
 *
 * ISO が見つからなければスキップして正常終了する。
 * **作った `.img` は最後に必ず消す**（数 GB になる。落とし穴 86 と同じ理由）。
 *
 * このスクリプトは**昇格しない**。管理者権限なしで実行できることが、この機能の要点。
 */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat, readdir, statfs } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import {
  FileBlockDevice,
  buildIsoPatches,
  inspectIso,
  minimumDiskSize,
  formatSize,
  readIsoStructure,
  resolvePath,
  readFile as readIsoFile,
  readGpt,
  parseMbr,
  readFatImage,
  CIDATA_LABEL,
  SECTOR_SIZE,
} from '../packages/media/src/index.js'
import {
  buildGrubPlan,
  createDefaultProfile,
  formatLocalized,
  recognizeIso,
  validateProfile,
  type AutoinstallProfile,
  type WriteStatus,
} from '../packages/shared/src/index.js'
import { sha512Crypt } from '../packages/shared/src/crypt/sha512crypt.js'
// --- ここから下は main プロセスの実装そのもの ---
import { checkFreeSpace, checkImageDestination, suggestImageFileName } from '../apps/desktop/src/main/image-target.js'
import { buildSeedBundle } from '../apps/desktop/src/main/seed-builder.js'
import { WriteSupervisor } from '../apps/desktop/src/main/write-supervisor.js'

const HASH = sha512Crypt('image-e2e-password', { salt: 'imagesalt' })

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

/** ISO を探す。`smoke-media.mts` と同じ探索。引数優先、無ければ既定の場所を見る。 */
async function findLiveServerIsos(): Promise<string[]> {
  const args = process.argv.slice(2)
  if (args.length > 0) return args
  const dirs = [join(homedir(), 'images'), join(homedir(), 'Downloads'), 'C:/iso', '/var/lib/iso']
  const found: string[] = []
  for (const dir of dirs) {
    try {
      for (const name of await readdir(dir)) {
        if (/live-server.*\.iso$/i.test(name)) found.push(join(dir, name))
      }
    } catch {
      // ディレクトリが無いのは正常
    }
  }
  return found
}

/** `ipc.ts` の `freeSpaceAt()` と同じ。取れなければ null（分からないことを「足りない」と言わない）。 */
async function freeSpaceAt(path: string): Promise<number | null> {
  try {
    const fs = await statfs(dirname(path))
    const free = Number(fs.bavail) * Number(fs.bsize)
    return Number.isFinite(free) && free >= 0 ? free : null
  } catch {
    return null
  }
}

/** 終端（done / error / cancelled）まで待つ。 */
function waitForEnd(s: WriteSupervisor): Promise<WriteStatus[]> {
  const statuses: WriteStatus[] = []
  return new Promise((resolve) => {
    const off = s.onStatus((st) => {
      statuses.push(st)
      if (st.state === 'done' || st.state === 'error' || st.state === 'cancelled') {
        off()
        resolve(statuses)
      }
    })
  })
}

type UbuntuSeries = Parameters<typeof createDefaultProfile>[0]

/** 実運用に近い設定を組む（追加ユーザー・ファイル配置・プリセット）。 */
function buildProfile(series: UbuntuSeries): AutoinstallProfile {
  const base = createDefaultProfile(series, 'image-e2e/0.1.0', '2026-09-03T00:00:00.000Z')
  return {
    ...base,
    basics: { ...base.basics, hostname: 'image-host', locale: 'ja_JP.UTF-8', timezone: 'Asia/Tokyo' },
    user: { ...base.user, username: 'imguser', passwordHash: HASH },
    postInstall: {
      ...base.postInstall,
      presets: ['chrony-ntp', 'qemu-guest-agent'],
      files: [
        { name: 'motd.txt', targetPath: '/etc/motd', mode: '0644', owner: 'root', content: 'made from an .img\n' },
      ],
      additionalUsers: [
        {
          id: 'u1',
          username: 'deploy',
          realname: 'Deploy account',
          passwordHash: HASH,
          sudo: 'nopasswd',
          groups: ['sudo'],
          shell: '/bin/bash',
          sshAuthorizedKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample deploy@image'],
          createHome: true,
          systemAccount: false,
        },
      ],
    },
  }
}

async function run(isoPath: string): Promise<void> {
  console.log(`\n[イメージファイル作成] ${basename(isoPath)}`)
  const isoStat = await stat(isoPath)
  const workDir = await mkdtemp(join(tmpdir(), 'autoinstall-image-e2e-'))
  // 保存ダイアログが作る既定名も本物を通す（利用者の自由入力から作られる）。
  const imageName = suggestImageFileName('image-host')
  eq('保存ダイアログの既定名が .img になる', imageName, 'image-host.img')
  const imagePath = join(workDir, imageName)
  let created = false

  try {
    // --- 1. ISO の検査（prepareMedia と同じ） ---
    const isoDev = await FileBlockDevice.open(isoPath, 'r')
    let patches: { offset: number; data: string; label: string }[]
    let newGrubCfg: string
    let volumeId: string
    let isoSizeBytes: number
    let series: UbuntuSeries
    try {
      const inspection = await inspectIso(isoDev)
      const recognized = recognizeIso(inspection.volumeId, inspection.diskInfo ?? undefined)
      check('live-server として認識される', recognized.kind === 'supported', inspection.volumeId)
      if (recognized.kind !== 'supported') return
      series = recognized.identity.series
      volumeId = inspection.volumeId
      isoSizeBytes = inspection.sizeBytes
      console.log(
        `       ${recognized.identity.version} ${recognized.identity.arch} / ${formatSize(isoStat.size)}`,
      )

      const profileForGrub = buildProfile(series)
      const grubPlan = buildGrubPlan(profileForGrub)
      const plan = buildIsoPatches(inspection, {
        args: grubPlan.args,
        markTitle: true,
        extraEntries: grubPlan.entries,
      })
      patches = plan.patches.map((p) => ({
        offset: p.offset,
        data: p.data.toString('base64'),
        label: p.label,
      }))
      newGrubCfg = plan.newGrubCfg
      eq('ISO パッチは 4 か所', patches.length, 4)
      check('改変後 grub.cfg に autoinstall が入る', newGrubCfg.includes('autoinstall'))
    } finally {
      await isoDev.close()
    }

    // --- 2. 設定と CIDATA の中身（prepareMedia の後半と同じ） ---
    const profile = buildProfile(series)
    const validation = validateProfile(profile)
    check(
      '設定が検証を通る',
      validation.ok,
      validation.issues.map((i) => formatLocalized('ja', i.text)).join(' / '),
    )
    const isoFingerprint = createHash('sha256').update(`${volumeId}|${isoSizeBytes}|`).digest('hex')
    const bundle = await buildSeedBundle({
      profile,
      generateOptions: { comments: 'ja' },
      // **false にしてある。** 監査記録の組み立ては `app.getName()` を呼ぶので、
      // Electron の外（tsx）では動かせない。ここで見たいのは書き出し経路なので
      // 記録は外す。監査記録そのものは `seed-builder` の単体テストが見ている。
      auditRecord: false,
      isoFileName: basename(isoPath),
      isoFingerprint,
      minimumCidataSize: 64 * 1024 * 1024,
    })
    eq('欠けているペイロードは無い', bundle.missingSources.length, 0)
    check(
      'CIDATA に user-data と meta-data が入る',
      ['user-data', 'meta-data'].every((n) => bundle.files.some((f) => f.name === n)),
      bundle.files.map((f) => f.name).join(','),
    )

    // --- 3. 保存先の許可（落とし穴 55）。**通らないことも確かめる。** ---
    const allowedImagePaths = new Set<string>()
    check(
      'ダイアログを通っていないパスは断られる',
      checkImageDestination({
        imagePath,
        allowedImagePaths,
        isoPaths: [isoPath],
        payloadPaths: [],
      })?.key === 'image.pathNotChosen',
    )
    // 保存ダイアログを通った、という状態を作る（ipc.ts の chooseImagePath がやること）。
    allowedImagePaths.add(imagePath)
    check(
      '開いた実績のある ISO を上書きしようとすると断られる',
      checkImageDestination({
        imagePath: isoPath,
        allowedImagePaths: [...allowedImagePaths, isoPath],
        isoPaths: [isoPath],
        payloadPaths: [],
      })?.key === 'image.sameAsIso',
    )
    check(
      '許可されたパスは通る',
      checkImageDestination({ imagePath, allowedImagePaths, isoPaths: [isoPath], payloadPaths: [] }) === null,
    )

    // --- 4. 空き容量（書き始める前に見る） ---
    const requiredBytes = minimumDiskSize(isoSizeBytes, bundle.cidataSizeBytes)
    const free = await freeSpaceAt(imagePath)
    const spaceFailure = checkFreeSpace(requiredBytes, free)
    check(
      '空き容量が足りている',
      spaceFailure === null,
      spaceFailure ? formatLocalized('ja', spaceFailure) : '',
    )
    if (spaceFailure !== null) return
    check(
      '足りなければ断る（判定が生きている）',
      checkFreeSpace(requiredBytes, 1024)?.key === 'image.noSpace',
    )

    // --- 5. 実際に書く（WriteSupervisor 経由。昇格しない） ---
    const supervisor = new WriteSupervisor()
    const ended = waitForEnd(supervisor)
    let lastPct = -1
    const offProgress = supervisor.onStatus((st) => {
      if (st.state === 'writing') {
        const pct = Math.floor((st.bytesDone / st.bytesTotal) * 10) * 10
        if (pct !== lastPct) {
          lastPct = pct
          process.stdout.write(`\r       ${st.phase} ${pct}%   `)
        }
      }
    })
    const started = Date.now()
    const accepted = await supervisor.startImageWrite({
      isoPath,
      imagePath,
      patches,
      seedFiles: bundle.files.map((f) => ({ name: f.name, content: f.content.toString('base64') })),
      cidataSizeBytes: bundle.cidataSizeBytes,
      hideIsoPartitionFromWindows: true,
      verify: true,
      timestampIso: new Date('2026-09-03T00:00:00Z').toISOString(),
    })
    check('書き出しが受け付けられる', accepted.started, accepted.message?.key ?? '')
    created = true
    const statuses = await ended
    offProgress()
    process.stdout.write('\r'.padEnd(40) + '\r')

    const first = statuses[0]
    check(
      '最初の状態は image 専用の「準備しています」',
      first?.state === 'preparing' && 'message' in first && first.message?.key === 'image.statusPreparing',
      first && 'message' in first ? String(first.message?.key) : String(first?.state),
    )
    const keys = statuses.map((st) => ('message' in st && st.message ? st.message.key : null))
    check(
      '権限まわりの文言が 1 度も出ない（昇格していない）',
      !keys.includes('write.statusCheckingPrivileges') && !keys.includes('write.statusWaitingElevation'),
    )

    const last = statuses.at(-1)!
    if (last.state !== 'done') {
      const detail = 'detail' in last ? last.detail : ''
      const msg = 'message' in last && last.message ? formatLocalized('ja', last.message) : ''
      check('書き出しが done で終わる', false, `${last.state}: ${msg} ${detail ?? ''}`)
      return
    }
    check('書き出しが done で終わる', true)
    check('読み戻し検証に成功', last.verified)
    eq('done が保存先を運ぶ', last.outputPath, imagePath)
    console.log(
      `       ${formatSize(last.bytesWritten)} を ${((Date.now() - started) / 1000).toFixed(1)} 秒で書き出し`,
    )

    // --- 6. サイズが最小限か（デバイス容量に水増ししていない） ---
    const imgStat = await stat(imagePath)
    eq('ファイルサイズが minimumDiskSize と一致する', imgStat.size, requiredBytes)
    check(
      'ISO + CIDATA + α に収まる（水増ししていない）',
      imgStat.size < isoStat.size + bundle.cidataSizeBytes + 2 * 1024 * 1024,
      `${formatSize(imgStat.size)} vs ISO ${formatSize(isoStat.size)} + CIDATA ${formatSize(bundle.cidataSizeBytes)}`,
    )
    // 31 GB の USB 向けでも出来上がりは ISO 相当、という一番の売り。
    console.log(
      `       出来上がり ${formatSize(imgStat.size)}（31 GB の USB に書いた場合との差 ${formatSize(31 * 1000 * 1000 * 1000 - imgStat.size)}）`,
    )

    // --- 7. 読み戻して構造を確かめる ---
    const img = await FileBlockDevice.open(imagePath, 'r')
    try {
      const mbr = parseMbr(await img.read(0, SECTOR_SIZE))
      check('protective MBR がある', mbr.valid && mbr.isProtective)
      check('GRUB のブートコードが残っている', mbr.hasBootCode)
      eq(
        'MBR の 0xEE エントリがディスク全体を覆う',
        mbr.entries[0]!.sectors,
        Math.floor(imgStat.size / SECTOR_SIZE) - 1,
      )

      const gpt = await readGpt(img)
      check('GPT が読める', gpt !== null)
      check('GPT ヘッダの CRC が正しい', gpt!.headerCrcValid)
      check('GPT エントリの CRC が正しい', gpt!.entriesCrcValid)
      check(
        'CIDATA パーティションがある',
        gpt!.entries.some((e) => e.name === CIDATA_LABEL),
        gpt!.entries.map((e) => e.name).join(','),
      )
      const backup = await readGpt(img, Math.floor(imgStat.size / SECTOR_SIZE) - 1)
      check('バックアップ GPT がファイル末尾にある', backup !== null && backup.headerCrcValid)

      // ISO9660
      const structure = await readIsoStructure(img)
      eq('Volume ID が保たれている', structure.pvd.volumeId, volumeId)
      const grub = await resolvePath(img, structure.pvd.rootRecord, '/boot/grub/grub.cfg')
      check('grub.cfg が解決できる', grub !== null)
      const grubText = (await readIsoFile(img, grub!.record)).toString('utf8')
      eq('grub.cfg が改変後の内容と一致', grubText, newGrubCfg)
      // 落とし穴 1: この引数が無いと subiquity が「Continue with autoinstall?」で止まる。
      const casperLines = grubText.split('\n').filter((l) => /\blinux\b.*\/casper\/vmlinuz/.test(l))
      check('casper の linux 行が見つかる', casperLines.length > 0)
      check(
        'すべての casper エントリにカーネル引数 autoinstall が付く',
        casperLines.every((l) => /\bautoinstall\b/.test(l)),
        casperLines.find((l) => !/\bautoinstall\b/.test(l)) ?? '',
      )
      const jolietGrub = await resolvePath(img, structure.joliet!.rootRecord, '/boot/grub/grub.cfg', true)
      eq(
        'Joliet 側のサイズも更新されている',
        jolietGrub!.record.size,
        Buffer.byteLength(newGrubCfg, 'utf8'),
      )

      const md5 = await resolvePath(img, structure.pvd.rootRecord, '/md5sum.txt')
      const md5Text = (await readIsoFile(img, md5!.record)).toString('utf8')
      const line = md5Text.split('\n').find((l) => l.endsWith('  ./boot/grub/grub.cfg'))
      eq(
        'md5sum.txt の grub.cfg 行が更新されている',
        line?.slice(0, 32),
        createHash('md5').update(Buffer.from(newGrubCfg, 'utf8')).digest('hex'),
      )

      // CIDATA
      const cidata = gpt!.entries.find((e) => e.name === CIDATA_LABEL)!
      const fatBytes = (cidata.endLba - cidata.startLba + 1) * SECTOR_SIZE
      const fs = readFatImage(await img.read(cidata.startLba * SECTOR_SIZE, fatBytes))
      eq('CIDATA のボリュームラベル', fs.label, 'CIDATA')
      // **バンドルの全ファイルがバイト単位で一致すること。**
      for (const want of bundle.files) {
        const got = fs.files.find((f) => f.name === want.name)
        check(
          `CIDATA の ${want.name} がバイト単位で一致`,
          got !== undefined && got.content.equals(want.content),
          got === undefined ? 'ファイルが無い' : `${got.content.length} vs ${want.content.length} バイト`,
        )
      }
      check('CIDATA に .disk/info を置いていない（落とし穴 12）', !fs.files.some((f) => f.name === '.disk'))
    } finally {
      await img.close()
    }
  } finally {
    // **数 GB を残さない。** 消したことを必ず出力に出す。
    let removedBytes = 0
    try {
      removedBytes = (await stat(imagePath)).size
    } catch {
      // 作られていなければ 0
    }
    await rm(workDir, { recursive: true, force: true })
    let stillThere = true
    try {
      await stat(imagePath)
    } catch {
      stillThere = false
    }
    if (created) {
      check('作った .img を削除した', !stillThere, imagePath)
      console.log(`       削除: ${imagePath} (${formatSize(removedBytes)} を解放)`)
    } else {
      console.log(`       作業ディレクトリを削除: ${workDir}`)
    }
  }
}

async function main(): Promise<void> {
  const isos = await findLiveServerIsos()
  if (isos.length === 0) {
    console.log('live-server の ISO が見つかりませんでした。スキップします。')
    console.log('（明示するには: npm run e2e:image -- <iso のパス>）')
    return
  }
  console.log(`live-server ISO を ${isos.length} 個検出`)
  for (const p of isos) await run(p)

  console.log(`\n${checks} 件中 ${checks - failures} 件成功、${failures} 件失敗`)
  if (failures > 0) process.exit(1)
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
