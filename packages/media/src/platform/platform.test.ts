import { describe, expect, it } from 'vitest'
import { classifyDevice, formatSize } from './types.js'
import { diskNumberFromId, mapBusType, parseWindowsDisks } from './win32.js'
import { mapBusProtocol, parsePlist, toDevice } from './darwin.js'
import { mapTransport, parseLsblk } from './linux.js'
import { elevationHint, getPlatformOps, UnsupportedPlatformError } from './index.js'

describe('classifyDevice の安全判定', () => {
  const base = {
    id: '/dev/sdb',
    description: 'SanDisk Ultra',
    sizeBytes: 16_000_000_000,
    bus: 'usb' as const,
    removable: true,
    isSystem: false,
    mountpoints: [] as string[],
    serial: 'ABC123',
    readOnly: false,
  }

  it('普通の USB メモリは選択できる', () => {
    const d = classifyDevice(base)
    expect(d.selectable).toBe(true)
    expect(d.blockedReason).toBeNull()
  })

  it('システムディスクは必ずブロックする', () => {
    const d = classifyDevice({ ...base, isSystem: true })
    expect(d.selectable).toBe(false)
    expect(d.blockedReason).toMatch(/システムディスク/)
  })

  it('書き込み禁止のメディアはブロックする', () => {
    expect(classifyDevice({ ...base, readOnly: true }).selectable).toBe(false)
  })

  it('内蔵の NVMe / SATA / SCSI はブロックする', () => {
    for (const bus of ['nvme', 'sata', 'scsi'] as const) {
      const d = classifyDevice({ ...base, bus, removable: false })
      expect(d.selectable, bus).toBe(false)
      expect(d.blockedReason, bus).toMatch(/内蔵/)
    }
  })

  it('容量が小さすぎるとブロックする', () => {
    const d = classifyDevice({ ...base, sizeBytes: 2_000_000_000 })
    expect(d.selectable).toBe(false)
    expect(d.blockedReason).toMatch(/4 GB/)
  })

  it('2 TB 超はブロックする（外付け HDD の誤選択防止）', () => {
    const d = classifyDevice({ ...base, sizeBytes: 4_000_000_000_000 })
    expect(d.selectable).toBe(false)
    expect(d.blockedReason).toMatch(/2 TB/)
  })

  it('容量不明はブロックする', () => {
    expect(classifyDevice({ ...base, sizeBytes: 0 }).selectable).toBe(false)
  })

  it('外付けの SATA/USB ブリッジ (removable=true) は許可する', () => {
    expect(classifyDevice({ ...base, bus: 'sata', removable: true }).selectable).toBe(true)
  })
})

describe('formatSize', () => {
  it.each([
    [16_000_000_000, '16.0 GB'],
    [2_000_398_934_016, '2.0 TB'],
    [64 * 1024 * 1024, '67 MB'],
    [512, '512 B'],
  ])('%i → %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected)
  })
})

describe('Windows の列挙', () => {
  // 実機 (Get-Disk) の出力そのもの
  const REAL_SYSTEM_DISK = `[{"Number":0,"FriendlyName":"Samsung SSD 970 EVO Plus 2TB","SerialNumber":"0025_3854_31B5_6E8A.","Size":2000398934016,"BusType":"NVMe","IsSystem":true,"IsBoot":true,"IsReadOnly":false,"IsOffline":false,"MediaType":"SSD","Mountpoints":["C:"]}]`

  it('実機のシステムディスクをブロックする', () => {
    const [d] = parseWindowsDisks(REAL_SYSTEM_DISK)
    expect(d!.id).toBe('\\\\.\\PhysicalDrive0')
    expect(d!.description).toBe('Samsung SSD 970 EVO Plus 2TB')
    expect(d!.bus).toBe('nvme')
    expect(d!.isSystem).toBe(true)
    expect(d!.selectable).toBe(false)
    expect(d!.mountpoints).toEqual(['C:'])
  })

  it('USB メモリを選択可能として認識する', () => {
    const json = `[{"Number":2,"FriendlyName":"SanDisk Ultra USB 3.0","SerialNumber":"4C530001","Size":15728640000,"BusType":"USB","IsSystem":false,"IsBoot":false,"IsReadOnly":false,"IsOffline":false,"MediaType":"Unspecified","Mountpoints":["E:"]}]`
    const [d] = parseWindowsDisks(json)
    expect(d!.id).toBe('\\\\.\\PhysicalDrive2')
    expect(d!.bus).toBe('usb')
    expect(d!.removable).toBe(true)
    expect(d!.selectable).toBe(true)
    expect(d!.serial).toBe('4C530001')
  })

  it('ConvertTo-Json が単体オブジェクトを返しても配列として扱う', () => {
    const single = `{"Number":1,"FriendlyName":"USB DISK","SerialNumber":null,"Size":8000000000,"BusType":"USB","IsSystem":false,"IsBoot":false,"IsReadOnly":false,"IsOffline":false,"MediaType":null,"Mountpoints":[]}`
    expect(parseWindowsDisks(single)).toHaveLength(1)
  })

  it('IsSystem が false でも IsBoot が true ならシステム扱い', () => {
    const json = `[{"Number":1,"FriendlyName":"Boot","SerialNumber":null,"Size":128000000000,"BusType":"USB","IsSystem":false,"IsBoot":true,"IsReadOnly":false,"IsOffline":false,"MediaType":null,"Mountpoints":[]}]`
    expect(parseWindowsDisks(json)[0]!.selectable).toBe(false)
  })

  it('BusType を写す', () => {
    expect(mapBusType('USB')).toBe('usb')
    expect(mapBusType('SD')).toBe('sd')
    expect(mapBusType('NVMe')).toBe('nvme')
    expect(mapBusType('File Backed Virtual')).toBe('unknown')
    expect(mapBusType('FileBackedVirtual')).toBe('virtual')
  })

  it('ディスク番号を取り出す', () => {
    expect(diskNumberFromId('\\\\.\\PhysicalDrive3')).toBe(3)
    expect(diskNumberFromId('\\\\.\\physicaldrive12')).toBe(12)
    expect(() => diskNumberFromId('/dev/sdb')).toThrow(/ディスク ID/)
  })
})

describe('macOS の列挙', () => {
  const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AllDisks</key>
  <array><string>disk4</string><string>disk4s1</string></array>
  <key>WholeDisks</key>
  <array><string>disk4</string></array>
  <key>DeviceIdentifier</key><string>disk4</string>
  <key>MediaName</key><string>SanDisk Ultra USB 3.0 Media</string>
  <key>Size</key><integer>15728640000</integer>
  <key>BusProtocol</key><string>USB</string>
  <key>Internal</key><false/>
  <key>RemovableMediaOrExternalDevice</key><true/>
  <key>WritableMedia</key><true/>
  <key>SystemImage</key><false/>
</dict>
</plist>`

  it('plist を解析できる', () => {
    const p = parsePlist(PLIST) as Record<string, unknown>
    expect(p['WholeDisks']).toEqual(['disk4'])
    expect(p['DeviceIdentifier']).toBe('disk4')
    expect(p['Size']).toBe(15_728_640_000)
    expect(p['Internal']).toBe(false)
    expect(p['RemovableMediaOrExternalDevice']).toBe(true)
    expect(p['MediaName']).toBe('SanDisk Ultra USB 3.0 Media')
  })

  it('ネストした dict / array を解析できる', () => {
    const xml = `<plist version="1.0"><dict><key>AllDisksAndPartitions</key><array><dict><key>Partitions</key><array><dict><key>MountPoint</key><string>/Volumes/UBUNTU</string></dict></array></dict></array></dict></plist>`
    const p = parsePlist(xml) as { AllDisksAndPartitions: { Partitions: { MountPoint: string }[] }[] }
    expect(p.AllDisksAndPartitions[0]!.Partitions[0]!.MountPoint).toBe('/Volumes/UBUNTU')
  })

  it('raw デバイス (/dev/rdiskN) を書き込み先にする', () => {
    const info = parsePlist(PLIST) as Record<string, unknown>
    const d = toDevice(info, ['/Volumes/UBUNTU'], false)
    expect(d.id).toBe('/dev/rdisk4')
    expect(d.selectable).toBe(true)
    expect(d.mountpoints).toEqual(['/Volumes/UBUNTU'])
  })

  it('起動ディスクはブロックする', () => {
    const info = parsePlist(PLIST) as Record<string, unknown>
    expect(toDevice(info, [], true).selectable).toBe(false)
  })

  it('BusProtocol を写す', () => {
    expect(mapBusProtocol('USB')).toBe('usb')
    expect(mapBusProtocol('Secure Digital')).toBe('sd')
    expect(mapBusProtocol('PCI-Express')).toBe('nvme')
    expect(mapBusProtocol('Disk Image')).toBe('virtual')
    expect(mapBusProtocol(undefined)).toBe('unknown')
  })
})

describe('Linux の列挙', () => {
  const LSBLK = JSON.stringify({
    blockdevices: [
      {
        name: 'nvme0n1',
        path: '/dev/nvme0n1',
        size: 512110190592,
        type: 'disk',
        tran: 'nvme',
        rm: false,
        hotplug: false,
        ro: false,
        model: 'Samsung SSD 980',
        serial: 'S1',
        vendor: null,
        mountpoints: [null],
        children: [
          { name: 'nvme0n1p1', path: '/dev/nvme0n1p1', type: 'part', mountpoints: ['/boot/efi'] },
          { name: 'nvme0n1p2', path: '/dev/nvme0n1p2', type: 'part', mountpoints: ['/'] },
        ],
      },
      {
        name: 'sdb',
        path: '/dev/sdb',
        size: 15728640000,
        type: 'disk',
        tran: 'usb',
        rm: true,
        hotplug: true,
        ro: false,
        model: 'Ultra',
        serial: '4C53',
        vendor: 'SanDisk',
        mountpoints: [null],
        children: [{ name: 'sdb1', path: '/dev/sdb1', type: 'part', mountpoints: ['/media/user/UBUNTU'] }],
      },
      { name: 'loop0', path: '/dev/loop0', size: 100, type: 'loop', mountpoints: ['/snap/core'] },
    ],
  })

  it('システムディスクをブロックし、USB を許可する', () => {
    const devices = parseLsblk(LSBLK)
    expect(devices).toHaveLength(2) // loop は除外される
    const [nvme, usb] = devices
    expect(nvme!.id).toBe('/dev/nvme0n1')
    expect(nvme!.isSystem).toBe(true)
    expect(nvme!.selectable).toBe(false)
    expect(usb!.id).toBe('/dev/sdb')
    expect(usb!.description).toBe('SanDisk Ultra')
    expect(usb!.selectable).toBe(true)
    expect(usb!.mountpoints).toEqual(['/media/user/UBUNTU'])
  })

  it('子パーティションのマウントポイントを集める', () => {
    const [nvme] = parseLsblk(LSBLK)
    expect(nvme!.mountpoints).toEqual(['/boot/efi', '/'])
  })

  it('transport を写す', () => {
    expect(mapTransport('usb', false)).toBe('usb')
    expect(mapTransport('nvme', false)).toBe('nvme')
    expect(mapTransport('mmc', false)).toBe('sd')
    expect(mapTransport(null, true)).toBe('usb')
    expect(mapTransport(null, false)).toBe('unknown')
  })
})

describe('プラットフォーム選択', () => {
  it('対応 OS では実装を返す', () => {
    for (const p of ['win32', 'darwin', 'linux'] as const) {
      expect(typeof getPlatformOps(p).listDevices).toBe('function')
    }
  })

  it('非対応 OS では分かるエラーを出す', () => {
    expect(() => getPlatformOps('aix')).toThrow(UnsupportedPlatformError)
  })

  it('昇格の案内が OS ごとに用意されている', () => {
    expect(elevationHint('win32').ja).toMatch(/管理者権限/)
    expect(elevationHint('darwin').ja).toMatch(/パスワード/)
    expect(elevationHint('linux').ja).toMatch(/root/)
    for (const p of ['win32', 'darwin', 'linux'] as const) {
      expect(elevationHint(p).en.length).toBeGreaterThan(0)
    }
  })
})
