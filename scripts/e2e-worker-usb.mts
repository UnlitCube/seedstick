/**
 * 昇格ワーカー経路の E2E。**管理者権限で実行すること。**
 *
 *   管理者の PowerShell で:  npm run e2e:usb-worker
 *
 * `scripts/e2e-write-usb.mts` が `executeWritePlan` を直接呼ぶのに対し、
 * こちらは GUI と同じ「ジョブ JSON をワーカーに渡し、進捗を 127.0.0.1 の
 * TCP に NDJSON で受け取る」経路を通す。
 * つまり main の WriteSupervisor がやっていることを、UAC を挟まずに再現する。
 *
 * 確かめるもの:
 *   - ワーカーがジョブ JSON を解釈して実デバイスに書けること
 *   - NDJSON プロトコル（トークン認証・hello/progress/done）が実際に流れること
 *   - prepareForWrite / finishWrite がワーカー側で走ること
 *   - 書き上がった USB の中身が正しいこと
 */
import { createServer, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  FileBlockDevice,
  RawBlockDevice,
  buildIsoPatches,
  getPlatformOps,
  inspectIso,
  parseMbr,
  readFatImage,
  readGpt,
  readIsoStructure,
  resolvePath,
  readFile as readIsoFile,
  decodeMessages,
  encodeMessage,
  CIDATA_LABEL,
  SECTOR_SIZE,
  type WorkerJob,
  type WorkerMessage,
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
import { printRevisionBanner } from './lib/git-revision.mts'

const HASH = sha512Crypt('E2e-Passw0rd!-long', { salt: 'e2ework' })

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

/** 起動メニューでホストを選ぶ設定（GUI で作れるものと同じ）。 */
function buildProfile(series: AutoinstallProfile['series']): AutoinstallProfile {
  const b = createDefaultProfile(series, 'e2e-worker/0.1.0', new Date().toISOString())
  return {
    ...b,
    meta: { ...b.meta, name: 'e2e-worker' },
    basics: { ...b.basics, hostname: 'e2e-worker', locale: 'ja_JP.UTF-8', timezone: 'Asia/Tokyo' },
    user: { ...b.user, realname: 'E2E Worker', username: 'e2eworker', passwordHash: HASH },
    network: {
      mode: 'static',
      target: { kind: 'any' },
      address: '192.168.1.60/24',
      gateway: '192.168.1.1',
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
        { id: 'w1', label: 'node-a', hostname: 'node-a', ipv4: '192.168.1.71/24', gateway: '192.168.1.1', nameservers: '1.1.1.1', disk: 'SERIAL-A' },
        { id: 'w2', label: 'node-b', hostname: 'node-b', ipv4: '192.168.1.72/24', gateway: '192.168.1.1', nameservers: '1.1.1.1', disk: 'SERIAL-B' },
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

/** WriteSupervisor と同じ「一回限りのトークン付き NDJSON サーバー」。 */
function startReportServer(token: string, onMessage: (m: WorkerMessage) => void): Promise<{
  port: number
  close: () => void
  connections: () => number
}> {
  let connections = 0
  return new Promise((resolve, reject) => {
    const server = createServer((socket: Socket) => {
      connections++
      let buffer = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        buffer += chunk
        const { messages, rest } = decodeMessages(buffer, token)
        buffer = rest
        for (const m of messages) onMessage(m as WorkerMessage)
      })
      // WriteSupervisor と同じくソケットのエラーを握りつぶす。ワーカーが done を
      // 送ってから終了すると Windows は FIN ではなく RST を返すことがあり、
      // ハンドラが無いと unhandled 'error' でこちらのプロセスごと落ちる。
      // それでは「done のあとの検証」に一度も到達できない（実機で再現した）。
      socket.on('error', () => undefined)
    })
    server.on('error', reject)
    // 127.0.0.1 の動的ポート。固定ポートは使わない。
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('ポートを取得できませんでした'))
        return
      }
      resolve({ port: addr.port, close: () => server.close(), connections: () => connections })
    })
  })
}

async function main(): Promise<void> {
  // **何より先に出す。** このログがどのコードに対する結果なのかが分からないと、
  // あとからコードを変えたときに乖離が見えない（`docs/HANDOFF.md` 3.2）。
  // 権限チェックやビルド成果物の確認より前に置いて、必ずログの先頭に残す。
  printRevisionBanner('scripts/e2e-worker-usb.mts')

  const ops = getPlatformOps()
  if (!(await ops.hasWriteAccess())) {
    console.error('管理者権限がありません。管理者の PowerShell（または sudo）で実行してください。')
    process.exit(2)
  }

  // ワーカーの実体はビルド成果物。`npm run build` を通していないと存在しない。
  // **ISO を開く前に確かめる。** 後ろで気づくと、数十秒待たせたうえに
  // "Cannot find module" だけが出て、原因が「ビルドしていない」ことだと分からない
  // （UAC を挟んだ別窓なら尚更）。
  const workerEntry = join(process.cwd(), 'apps/desktop/out/main/worker.js')
  if (!existsSync(workerEntry)) {
    console.error(
      `ワーカーが見つかりません: ${workerEntry}\n` +
        '先に `npm run build` を実行してください（このスクリプトはビルド成果物を使います）。',
    )
    process.exit(2)
  }

  const devices = await ops.listDevices()
  const explicit = arg('device')
  const target = explicit
    ? devices.find((d) => d.id === explicit)
    : devices.filter((d) => d.selectable && d.bus === 'usb')[0]
  if (!target || !target.selectable) {
    console.error('書き込める USB が見つかりません。--device で指定してください。')
    process.exit(2)
  }

  const isoPath = await findIso()
  console.log(`ISO   : ${basename(isoPath)}`)
  console.log(`書き込み先: ${target.id} ${target.description} ${(target.sizeBytes / 1e9).toFixed(2)} GB`)

  const iso = await FileBlockDevice.open(isoPath, 'r')
  const workDir = await mkdtemp(join(tmpdir(), 'autoinstall-worker-'))
  let userData = ''
  let metaData = ''
  let newGrubCfg = ''
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

    userData = generateUserData(profile, { comments: 'ja' })
    metaData = generateMetaData(`autoinstall-${profile.basics.hostname}`)
    const grubPlan = buildGrubPlan(profile)
    const patchPlan = buildIsoPatches(inspection, {
      args: grubPlan.args,
      markTitle: true,
      extraEntries: grubPlan.entries,
    })
    newGrubCfg = patchPlan.newGrubCfg
    console.log(`grub.cfg: ${Buffer.byteLength(newGrubCfg, 'utf8')} バイト / メニュー ${grubPlan.entries.length} 件`)

    // --- NDJSON の受け口を用意する（main の WriteSupervisor と同じ） ---
    const token = randomBytes(24).toString('hex')
    const seen = new Set<string>()
    let helloPid: number | null = null
    let lastPhase = ''
    let doneMessage: Extract<WorkerMessage, { type: 'done' }> | null = null
    let errorMessage: Extract<WorkerMessage, { type: 'error' }> | null = null
    const server = await startReportServer(token, (m) => {
      seen.add(m.type)
      if (m.type === 'hello') helloPid = m.pid
      if (m.type === 'progress' && m.phase !== lastPhase) {
        lastPhase = m.phase
        process.stdout.write(`\n  [${m.phase}] `)
      }
      if (m.type === 'progress') process.stdout.write('.')
      if (m.type === 'done') doneMessage = m
      if (m.type === 'error') errorMessage = m
    })
    console.log(`進捗の受け口: 127.0.0.1:${server.port}（トークン ${token.length} 文字）`)

    const job: WorkerJob = {
      jobId: 'e2e-worker-1',
      isoPath,
      devicePath: target.id,
      deviceSizeBytes: target.sizeBytes,
      deviceSerial: target.serial,
      deviceDescription: target.description,
      patches: patchPlan.patches.map((p) => ({
        offset: p.offset,
        data: p.data.toString('base64'),
        label: p.label,
      })),
      seedFiles: [
        { name: 'user-data', content: Buffer.from(userData, 'utf8').toString('base64') },
        { name: 'meta-data', content: Buffer.from(metaData, 'utf8').toString('base64') },
      ],
      cidataSizeBytes: 64 * 1024 * 1024,
      hideIsoPartitionFromWindows: true,
      verify: true,
      timestampIso: new Date().toISOString(),
      randomSeedBase64: randomBytes(32).toString('base64'),
      reportPort: server.port,
      reportToken: token,
    }
    const jobPath = join(workDir, 'job.json')
    await writeFile(jobPath, JSON.stringify(job), { mode: 0o600 })

    // --- ワーカーを起動する（既に昇格しているので直接 spawn する） ---
    console.log(`ワーカー: ${workerEntry}`)
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [workerEntry, jobPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString('utf8')
      })
      child.on('exit', (code) => {
        if (stderr.trim()) console.log(`\nワーカーの stderr:\n${stderr.trim()}`)
        resolve(code ?? -1)
      })
    })
    console.log('')
    server.close()

    check('ワーカーが正常終了した', exitCode === 0, `exit=${exitCode}`)
    check('NDJSON の接続が 1 本だけ来た', server.connections() === 1, String(server.connections()))
    check('hello を受け取った', seen.has('hello') && helloPid !== null, `pid=${String(helloPid)}`)
    check('progress を受け取った', seen.has('progress'))
    check('done を受け取った', doneMessage !== null)
    check('error は来ていない', errorMessage === null, JSON.stringify(errorMessage))
    if (doneMessage !== null) {
      const d: Extract<WorkerMessage, { type: 'done' }> = doneMessage
      check('ワーカーが読み戻し検証に成功した', d.verified === true)
      console.log(`       ${(d.bytesWritten / 1e9).toFixed(2)} GB / ${(d.elapsedMs / 1000).toFixed(1)} 秒`)
    }
  } finally {
    await iso.close()
    await rm(workDir, { recursive: true, force: true })
  }

  // --- 書き上がった USB を独立に読み戻す ---
  console.log('\n■ 実デバイスを読み戻して検証')
  const back = await RawBlockDevice.open(target.id, { sizeBytes: target.sizeBytes })
  try {
    const mbr = parseMbr(await back.read(0, SECTOR_SIZE))
    check('protective MBR がある', mbr.valid && mbr.isProtective)
    check('GRUB のブートコードが残っている', mbr.hasBootCode)
    const gpt = await readGpt(back)
    check('GPT が読める', gpt !== null && gpt.headerCrcValid && gpt.entriesCrcValid)
    if (!gpt) return
    const structure = await readIsoStructure(back)
    const grub = await resolvePath(back, structure.pvd.rootRecord, '/boot/grub/grub.cfg')
    check('grub.cfg が解決できる', grub !== null)
    if (grub) {
      const text = (await readIsoFile(back, grub.record)).toString('utf8')
      check('grub.cfg が計画どおり', text === newGrubCfg)
      for (const h of ['node-a', 'node-b']) {
        check(`grub.cfg に ${h} の menuentry がある`, text.includes(`ai.hostname=${h}`))
      }
    }
    const cidata = gpt.entries.find((e) => e.name === CIDATA_LABEL)
    check('CIDATA パーティションがある', cidata !== undefined)
    if (cidata) {
      const bytes = (cidata.endLba - cidata.startLba + 1) * SECTOR_SIZE
      const fs = readFatImage(await back.read(cidata.startLba * SECTOR_SIZE, bytes))
      const ud = fs.files.find((f) => f.name === 'user-data')
      check('user-data がバイト単位で一致', ud?.content.toString('utf8') === userData)
      check(
        'meta-data がバイト単位で一致',
        fs.files.find((f) => f.name === 'meta-data')?.content.toString('utf8') === metaData,
      )
    }
  } finally {
    await back.close()
  }

}

/**
 * 結果を出して終了コードを決める。**必ず main の外から呼ぶ。**
 *
 * 以前は main の末尾に置いていたが、途中の `if (!gpt) return` のような
 * 早期 return がそこを飛ばしてしまい、**本物の失敗が exit 0 になっていた**。
 * 早期 return が増えても壊れないよう、呼び出し側の then/catch から呼ぶ。
 */
function report(): void {
  console.log(`\n${checks} 件中 ${checks - failures} 件成功、${failures} 件失敗`)
  if (failures > 0) {
    console.error('失敗:\n' + failed.map((f) => `  - ${f}`).join('\n'))
    process.exit(1)
  }
  if (checks === 0) {
    // 1 件も検査していないのに成功扱いにしない
    console.error('検査が 1 件も実行されませんでした。')
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
