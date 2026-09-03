import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { classifyDevice, type DeviceBus, type PlatformOps, type RemovableDevice } from './types.js'

const exec = promisify(execFile)

// macOS のデバイス列挙と書き込み準備。
//
// 押さえるべき点:
//  - 書き込みは `/dev/rdiskN`（raw デバイス）を使う。`/dev/diskN` はバッファ経由で桁違いに遅い。
//  - 書き込み前に `diskutil unmountDisk` が必須。マウント中は EBUSY になる。
//  - `diskutil list -plist external physical` で外付けの物理ディスクだけを列挙できる。
//  - plist は XML なので、外部依存を増やさないよう最小限の抽出で済ませる。

async function diskutil(args: string[], timeoutMs = 30_000): Promise<string> {
  const { stdout } = await exec('diskutil', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/**
 * plist の最小パーサ。`<key>Foo</key><value/>` の並びを辞書として読む。
 * 完全な plist 実装は不要で、diskutil の出力に現れる型（string / integer / true / false / array / dict）だけ扱う。
 */
export function parsePlist(xml: string): unknown {
  let pos = 0
  const skipWs = (): void => {
    while (pos < xml.length && /\s/.test(xml[pos]!)) pos++
  }
  const readTag = (): { name: string; selfClosing: boolean } | null => {
    skipWs()
    if (xml[pos] !== '<') return null
    const end = xml.indexOf('>', pos)
    if (end < 0) return null
    const raw = xml.slice(pos + 1, end)
    pos = end + 1
    if (raw.startsWith('?') || raw.startsWith('!')) return readTag()
    return { name: raw.replace(/\/$/, '').split(/\s/)[0]!, selfClosing: raw.endsWith('/') }
  }
  const readTextUntilClose = (tag: string): string => {
    const close = `</${tag}>`
    const end = xml.indexOf(close, pos)
    const text = end < 0 ? '' : xml.slice(pos, end)
    pos = end < 0 ? xml.length : end + close.length
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  }
  const parseValue = (tagName: string, selfClosing: boolean): unknown => {
    switch (tagName) {
      case 'true':
        if (!selfClosing) readTextUntilClose('true')
        return true
      case 'false':
        if (!selfClosing) readTextUntilClose('false')
        return false
      case 'string':
        return selfClosing ? '' : readTextUntilClose('string')
      case 'integer':
        return selfClosing ? 0 : Number(readTextUntilClose('integer'))
      case 'real':
        return selfClosing ? 0 : Number(readTextUntilClose('real'))
      case 'data':
        return selfClosing ? '' : readTextUntilClose('data')
      case 'date':
        return selfClosing ? '' : readTextUntilClose('date')
      case 'array': {
        const arr: unknown[] = []
        if (selfClosing) return arr
        for (;;) {
          const t = readTag()
          if (!t || t.name === '/array') break
          arr.push(parseValue(t.name, t.selfClosing))
        }
        return arr
      }
      case 'dict': {
        const obj: Record<string, unknown> = {}
        if (selfClosing) return obj
        for (;;) {
          const t = readTag()
          if (!t || t.name === '/dict') break
          if (t.name !== 'key') continue
          const key = readTextUntilClose('key')
          const vt = readTag()
          if (!vt) break
          obj[key] = parseValue(vt.name, vt.selfClosing)
        }
        return obj
      }
      default:
        return null
    }
  }
  for (;;) {
    const t = readTag()
    if (!t) return null
    if (t.name === 'plist') continue
    return parseValue(t.name, t.selfClosing)
  }
}

interface DiskutilInfo {
  DeviceIdentifier?: string
  MediaName?: string
  Size?: number
  BusProtocol?: string
  RemovableMediaOrExternalDevice?: boolean
  Internal?: boolean
  SystemImage?: boolean
  WritableMedia?: boolean
  MountPoint?: string
  IORegistryEntryName?: string
  DeviceTreePath?: string
}

export function mapBusProtocol(protocol: string | undefined): DeviceBus {
  switch ((protocol ?? '').toLowerCase()) {
    case 'usb':
      return 'usb'
    case 'secure digital':
    case 'sd':
      return 'sd'
    case 'pci-express':
    case 'apple fabric':
      return 'nvme'
    case 'sata':
    case 'ata':
      return 'sata'
    case 'disk image':
      return 'virtual'
    default:
      return 'unknown'
  }
}

/** `diskutil info -plist` の結果と、そのディスクのマウントポイント一覧からデバイスを作る。 */
export function toDevice(info: DiskutilInfo, mountpoints: string[], isBootDisk: boolean): RemovableDevice {
  const id = info.DeviceIdentifier ?? ''
  const bus = mapBusProtocol(info.BusProtocol)
  return classifyDevice({
    // 書き込みは raw デバイス (/dev/rdiskN) を使う。/dev/diskN はバッファ経由で著しく遅い。
    id: `/dev/r${id}`,
    description: (info.MediaName ?? info.IORegistryEntryName ?? id).trim(),
    sizeBytes: Number(info.Size ?? 0),
    bus,
    removable: Boolean(info.RemovableMediaOrExternalDevice) || info.Internal === false,
    isSystem: Boolean(info.SystemImage) || isBootDisk || info.Internal === true,
    mountpoints,
    serial: null,
    readOnly: info.WritableMedia === false,
  })
}

export const darwinOps: PlatformOps = {
  async listDevices() {
    const listXml = await diskutil(['list', '-plist', 'external', 'physical'])
    const list = parsePlist(listXml) as { WholeDisks?: string[] } | null
    const wholeDisks = list?.WholeDisks ?? []

    // 起動ディスクを特定して確実に除外する
    let bootDisk = ''
    try {
      const rootInfo = parsePlist(await diskutil(['info', '-plist', '/'])) as DiskutilInfo | null
      bootDisk = (rootInfo?.DeviceIdentifier ?? '').replace(/s\d+$/, '')
    } catch {
      bootDisk = ''
    }

    const devices: RemovableDevice[] = []
    for (const disk of wholeDisks) {
      try {
        const info = parsePlist(await diskutil(['info', '-plist', disk])) as DiskutilInfo | null
        if (!info) continue
        // このディスク上のスライスのマウントポイントを集める
        const mounts: string[] = []
        const allXml = await diskutil(['list', '-plist', disk])
        const all = parsePlist(allXml) as
          | { AllDisksAndPartitions?: { Partitions?: { MountPoint?: string }[] }[] }
          | null
        for (const d of all?.AllDisksAndPartitions ?? []) {
          for (const p of d.Partitions ?? []) if (p.MountPoint) mounts.push(p.MountPoint)
        }
        devices.push(toDevice(info, mounts, disk === bootDisk))
      } catch {
        // 1 台の情報取得に失敗しても他は列挙する
      }
    }
    return devices
  },

  async prepareForWrite(deviceId) {
    // /dev/rdisk4 → disk4
    const whole = deviceId.replace(/^\/dev\/r?/, '').replace(/s\d+$/, '')
    await diskutil(['unmountDisk', 'force', `/dev/${whole}`], 60_000)
  },

  async finishWrite(deviceId) {
    const whole = deviceId.replace(/^\/dev\/r?/, '').replace(/s\d+$/, '')
    // 書き込み直後に macOS が「読み取れないディスク」ダイアログを出さないよう先にアンマウントする
    await diskutil(['unmountDisk', `/dev/${whole}`], 60_000).catch(() => undefined)
  },

  hasWriteAccess() {
    return Promise.resolve(typeof process.getuid === 'function' && process.getuid() === 0)
  },
}
