/**
 * GUI から実 USB に書いたあと、その USB を読み戻して中身を確かめる。
 *
 *   npx tsx scripts/e2e-verify-usb.mts                 # 自動で USB を探す
 *   npx tsx scripts/e2e-verify-usb.mts \\\\.\\PhysicalDrive1
 *
 * raw デバイスの読み取りには管理者権限が要る（Windows）。
 * 権限が無い場合は、マウントされた CIDATA ボリュームだけを見る縮退モードで動く。
 * 縮退モードでも「cloud-init が読む user-data が正しいか」は確認できる。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  RawBlockDevice,
  getPlatformOps,
  parseMbr,
  readGpt,
  readIsoStructure,
  resolvePath,
  readFile as readIsoFile,
  readFatImage,
  CIDATA_LABEL,
  SECTOR_SIZE,
} from '../packages/media/src/index.js'

let checks = 0
let failures = 0
const failed: string[] = []

function check(label: string, cond: boolean, detail = ''): void {
  checks++
  if (cond) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    failed.push(label)
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

/** cloud-init が読むファイルとして user-data が妥当かを見る。 */
function checkUserData(userData: string, where: string): void {
  check(`${where}: #cloud-config で始まる`, userData.startsWith('#cloud-config\n'))
  check(`${where}: autoinstall キーがある`, userData.includes('\nautoinstall:'))
  check(`${where}: version: 1 がある`, /^\s+version:\s*1\s*$/m.test(userData))
  check(`${where}: パスワードが平文で入っていない`, !userData.includes('E2e-Passw0rd'))
  check(`${where}: パスワードハッシュが入っている`, /password:\s*["']?\$6\$/.test(userData))
  // 起動メニューでホストを決める設定になっているか。
  //
  // `@@AI_HOSTNAME@@` のようなプレースホルダは**廃止した**（落とし穴 18・21）。
  // subiquity は設定を PyYAML で書き直すのでこちらの引用形式は残らず、
  // 置換に失敗した YAML が残る設計自体が成立しない。
  // いまは既定値をそのまま書き、early-commands が python + PyYAML で上書きする。
  check(`${where}: プレースホルダが残っていない`, !/@@AI_[A-Z0-9_]+@@/.test(userData))
  // **実装の形ではなく、성立していなければならない性質を見る**（落とし穴 56）。
  // 以前は `userData.includes('ai.hostname=')` だったが、
  // **その literal はもう出力に存在しない**——値をシェルに連結せず
  // base64 の JSON (`AI_DATA=`) で渡し、Python 側は `args["ai.hostname"]` と
  // 辞書で引く形になったため（落とし穴 19）。
  // 実装は正しいのに 1 件だけ FAIL していた（実 USB の読み戻しで判明）。
  check(
    `${where}: early-commands が起動時の指定を読む`,
    userData.includes('/proc/cmdline') && userData.includes('AI_DATA='),
  )
  // **落とし穴 27**: 反映できなかった指定があれば止める。
  // 黙って続けると全台が同じ IP / 同じディスクを掴む。
  check(
    `${where}: 反映できなかった指定があれば止める`,
    userData.includes('applied') && userData.includes('sys.exit'),
  )
  check(
    `${where}: early-commands が python で YAML を読み書きする`,
    userData.includes('yaml.safe_load'),
  )
  check(`${where}: seed を /cdrom から読ませていない`, !userData.includes('/cdrom'))
}

/** 管理者権限があるときの完全な検証。 */
async function verifyRaw(deviceId: string, sizeBytes: number): Promise<void> {
  console.log(`\n■ raw デバイスを読み戻す: ${deviceId}`)
  // 物理ドライブはセクタ単位でしか読めないので RawBlockDevice を使う
  // （FileBlockDevice の素の fs.open は EINVAL になる）。
  const dev = await RawBlockDevice.open(deviceId, { sizeBytes })
  try {
    const mbr = parseMbr(await dev.read(0, SECTOR_SIZE))
    check('protective MBR がある', mbr.valid && mbr.isProtective)
    check('GRUB のブートコードが残っている', mbr.hasBootCode)

    const gpt = await readGpt(dev)
    check('GPT が読める', gpt !== null)
    check('GPT ヘッダの CRC が正しい', gpt !== null && gpt.headerCrcValid)
    check('GPT エントリの CRC が正しい', gpt !== null && gpt.entriesCrcValid)
    if (!gpt) return
    console.log('       ' + gpt.entries.map((e) => `${e.name}(${e.startLba}-${e.endLba})`).join(' '))
    check(
      'CIDATA パーティションがある',
      gpt.entries.some((e) => e.name === CIDATA_LABEL),
      gpt.entries.map((e) => e.name).join(','),
    )

    // ISO9660 を読み直して grub.cfg を検証する
    const structure = await readIsoStructure(dev)
    console.log(`       Volume ID: ${structure.pvd.volumeId}`)
    const grub = await resolvePath(dev, structure.pvd.rootRecord, '/boot/grub/grub.cfg')
    check('grub.cfg が解決できる', grub !== null)
    if (grub) {
      const text = (await readIsoFile(dev, grub.record)).toString('utf8')
      check('grub.cfg に autoinstall がある', text.includes('autoinstall'))
      check('grub.cfg が 2048 バイト以内', Buffer.byteLength(text, 'utf8') <= 2048)
      for (const h of ['web01', 'web02', 'db01']) {
        check(`grub.cfg に ${h} の menuentry がある`, text.includes(`ai.hostname=${h}`))
      }
      check('手入力のエントリがある', text.includes('ai.interactive=1'))
      console.log(`       grub.cfg ${Buffer.byteLength(text, 'utf8')} バイト`)
    }

    const cidata = gpt.entries.find((e) => e.name === CIDATA_LABEL)
    if (cidata) {
      const bytes = (cidata.endLba - cidata.startLba + 1) * SECTOR_SIZE
      const fs = readFatImage(await dev.read(cidata.startLba * SECTOR_SIZE, bytes))
      eq('CIDATA のラベル', fs.label, 'CIDATA')
      console.log('       CIDATA: ' + fs.files.map((f) => f.name).join(', '))
      const ud = fs.files.find((f) => f.name === 'user-data')
      check('CIDATA に user-data がある', ud !== undefined)
      check('CIDATA に meta-data がある', fs.files.some((f) => f.name === 'meta-data'))
      if (ud) checkUserData(ud.content.toString('utf8'), 'CIDATA')
    }
  } finally {
    await dev.close()
  }
}

/** 権限が無いときに、マウントされた CIDATA ボリュームだけ見る。 */
async function verifyMounted(): Promise<boolean> {
  console.log('\n■ マウントされた CIDATA を読む（権限が無いので縮退モード）')
  const letters = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  for (const l of letters) {
    const root = `${l}:\\`
    try {
      const names = await readdir(root)
      if (!names.includes('user-data') || !names.includes('meta-data')) continue
      console.log(`       ${root} に seed を発見: ${names.join(', ')}`)
      const userData = await readFile(`${root}user-data`, 'utf8')
      checkUserData(userData, root)
      const meta = await readFile(`${root}meta-data`, 'utf8')
      check(`${root}: meta-data に instance-id がある`, meta.includes('instance-id:'))
      if (names.includes('autoinstall-usb.json')) {
        const rec = JSON.parse(await readFile(`${root}autoinstall-usb.json`, 'utf8')) as Record<string, unknown>
        check(`${root}: 作成記録にパスワードが入っていない`, !JSON.stringify(rec).includes('$6$'))
        console.log('       作成記録: ' + JSON.stringify(rec).slice(0, 200))
      }
      return true
    } catch {
      // そのドライブが無い / 読めないのは正常
    }
  }
  return false
}

async function main(): Promise<void> {
  const arg = process.argv[2]
  let deviceId = arg ?? null
  let sizeBytes = 0
  if (!deviceId) {
    const devices = await getPlatformOps().listDevices()
    const usb = devices.find((d) => d.bus === 'usb' && !d.isSystem)
    if (usb) {
      deviceId = usb.id
      sizeBytes = usb.sizeBytes
    }
    if (usb) console.log(`対象: ${usb.id} ${usb.description} (${(usb.sizeBytes / 1e9).toFixed(1)} GB)`)
  }

  if (deviceId && sizeBytes === 0) {
    const found = (await getPlatformOps().listDevices()).find((d) => d.id === deviceId)
    sizeBytes = found?.sizeBytes ?? 0
  }

  let rawOk = false
  if (deviceId && sizeBytes > 0) {
    try {
      await verifyRaw(deviceId, sizeBytes)
      rawOk = true
    } catch (err) {
      // **「権限が無くて開けない」と「読めたが中身が壊れている」は別物。**
      // 何でも握り潰すと、本物の欠陥が「権限不足」に化けて緑になる。
      // 権限まわりのエラーだけマウント経由の検証にフォールバックし、
      // それ以外は失敗として数える。
      const e = err as NodeJS.ErrnoException
      const permission = e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EBUSY'
      if (!permission) {
        check(`raw デバイスの読み戻し (${deviceId})`, false, e.message)
      } else {
        console.log(`  (raw 読み取りができません: ${e.message})`)
      }
    }
  }
  if (!rawOk) {
    const found = await verifyMounted()
    if (!found) {
      console.error('CIDATA が見つかりませんでした。USB がマウントされているか確認してください。')
      process.exit(1)
    }
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
