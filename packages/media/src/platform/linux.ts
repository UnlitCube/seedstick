import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { classifyDevice, type DeviceBus, type PlatformOps, type RemovableDevice } from './types.js'

const exec = promisify(execFile)

// Linux のデバイス列挙と書き込み準備。
//  - `lsblk -J -b` の JSON をそのまま使う（追加の依存が要らない）。
//  - 書き込み前に、そのディスク上の全パーティションをアンマウントする。
//  - 書き込み後は partprobe / udevadm settle でカーネルにテーブルを読み直させる。

interface LsblkDevice {
  name: string
  path?: string
  size?: number
  type?: string
  tran?: string | null
  rm?: boolean
  hotplug?: boolean
  ro?: boolean
  model?: string | null
  serial?: string | null
  vendor?: string | null
  mountpoints?: (string | null)[]
  children?: LsblkDevice[]
}

export function mapTransport(tran: string | null | undefined, hotplug: boolean): DeviceBus {
  switch ((tran ?? '').toLowerCase()) {
    case 'usb':
      return 'usb'
    case 'nvme':
      return 'nvme'
    case 'sata':
    case 'ata':
      return 'sata'
    case 'sas':
    case 'scsi':
      return 'scsi'
    case 'mmc':
      return 'sd'
    default:
      return hotplug ? 'usb' : 'unknown'
  }
}

function collectMountpoints(d: LsblkDevice): string[] {
  const out: string[] = []
  const walk = (node: LsblkDevice): void => {
    for (const m of node.mountpoints ?? []) if (m) out.push(m)
    for (const c of node.children ?? []) walk(c)
  }
  walk(d)
  return out
}

/** `lsblk -J -b` の JSON をデバイス一覧に変換する（純関数。テスト可能）。 */
export function parseLsblk(json: string): RemovableDevice[] {
  const parsed = JSON.parse(json) as { blockdevices?: LsblkDevice[] }
  const out: RemovableDevice[] = []
  for (const d of parsed.blockdevices ?? []) {
    if (d.type !== 'disk') continue
    const mountpoints = collectMountpoints(d)
    const hotplug = Boolean(d.hotplug)
    const description = [d.vendor?.trim(), d.model?.trim()].filter(Boolean).join(' ') || d.name
    out.push(
      classifyDevice({
        id: d.path ?? `/dev/${d.name}`,
        description,
        sizeBytes: Number(d.size ?? 0),
        bus: mapTransport(d.tran, hotplug),
        removable: Boolean(d.rm) || hotplug,
        // ルートや /boot を含むディスクは絶対に候補にしない
        isSystem: mountpoints.some((m) => m === '/' || m === '/boot' || m === '/boot/efi' || m === '/home'),
        mountpoints,
        serial: d.serial?.trim() || null,
        readOnly: Boolean(d.ro),
      }),
    )
  }
  return out
}

export const linuxOps: PlatformOps = {
  async listDevices() {
    const { stdout } = await exec(
      'lsblk',
      ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,TRAN,RM,HOTPLUG,RO,MODEL,SERIAL,VENDOR,MOUNTPOINTS'],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    )
    return parseLsblk(stdout)
  },

  async prepareForWrite(deviceId) {
    // このディスク上のマウント済みパーティションをすべて外す。
    // udisks があればそちら（ユーザー権限で動く）を優先し、無ければ umount を使う。
    const { stdout } = await exec('lsblk', ['-J', '-o', 'PATH,MOUNTPOINTS', deviceId], {
      timeout: 15_000,
    })
    const parsed = JSON.parse(stdout) as { blockdevices?: LsblkDevice[] }
    const targets: string[] = []
    const walk = (n: LsblkDevice): void => {
      if ((n.mountpoints ?? []).some(Boolean)) targets.push(n.path ?? `/dev/${n.name}`)
      for (const c of n.children ?? []) walk(c)
    }
    for (const d of parsed.blockdevices ?? []) walk(d)

    for (const t of targets) {
      const unmounted = await exec('udisksctl', ['unmount', '-b', t], { timeout: 30_000 })
        .then(() => true)
        .catch(() => false)
      if (!unmounted) {
        await exec('umount', [t], { timeout: 30_000 }).catch(() => undefined)
      }
    }
  },

  async finishWrite(deviceId) {
    // カーネルに新しいパーティションテーブルを読み直させる
    await exec('partprobe', [deviceId], { timeout: 30_000 }).catch(() => undefined)
    await exec('udevadm', ['settle', '--timeout=10'], { timeout: 20_000 }).catch(() => undefined)
  },

  hasWriteAccess() {
    return Promise.resolve(typeof process.getuid === 'function' && process.getuid() === 0)
  },
}
