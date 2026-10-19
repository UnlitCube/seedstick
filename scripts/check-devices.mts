/**
 * **本物の OS** でデバイス列挙を走らせ、起動ディスクが書き込み先の候補に出ないことを確かめる。
 *
 *   npx tsx scripts/check-devices.mts
 *
 * ユニットテストは diskutil / lsblk の出力を**こちらが書いた形**で与えているので、
 * 実際の OS が違う形を返したら素通りする（落とし穴 109 と同じ形）。CI の macOS / Linux
 * ランナーで走らせて、実物の出力で次を見る:
 *
 *   macOS : `diskutil info -plist /` から起動ディスクを 1 台以上特定できる
 *   Linux : `/` を載せたディスクが列挙され、selectable: false になっている
 *   共通  : 列挙が例外を投げない / 起動ディスクに当たるものが 1 台も selectable でない
 *
 * 書き込みはしない（読むだけ）。
 */
import { execFileSync } from 'node:child_process'
import { getPlatformOps } from '../packages/media/src/index.js'
import { bootWholeDisks, parsePlist, type DiskutilRootInfo } from '../packages/media/src/platform/darwin.js'

const failures: string[] = []
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const ops = getPlatformOps(process.platform)
const devices = await ops.listDevices()
console.log(JSON.stringify(devices, null, 2))

if (process.platform === 'darwin') {
  const root = parsePlist(execFileSync('diskutil', ['info', '-plist', '/'], { encoding: 'utf8' })) as DiskutilRootInfo
  const boot = bootWholeDisks(root)
  check('起動ディスクを特定できる', boot.size > 0, [...boot].join(', '))
  check(
    '起動ディスクに当たるものが候補に出ていない',
    devices.every((d) => !(boot.has(d.id.replace(/^\/dev\/r?/, '')) && d.selectable)),
  )
} else if (process.platform === 'linux') {
  const rootDisk = devices.find((d) => d.mountpoints.includes('/'))
  check('/ を載せたディスクが列挙される', rootDisk !== undefined, rootDisk?.id ?? '(無い)')
  check('/ を載せたディスクは選べない', rootDisk !== undefined && !rootDisk.selectable && rootDisk.isSystem)
} else {
  const system = devices.filter((d) => d.isSystem)
  check('システムディスクが列挙され、選べない', system.length > 0 && system.every((d) => !d.selectable))
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 件失敗`)
  process.exit(1)
}
console.log('\nall checks passed')
