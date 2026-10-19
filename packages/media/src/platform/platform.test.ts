import { describe, expect, it } from 'vitest'
import { formatLocalized, localized } from '@autoinstall/shared'
import { classifyDevice, formatSize, MAX_DEVICE_BYTES, MIN_DEVICE_BYTES } from './types.js'
import { diskNumberFromId, mapBusType, parseWindowsDisks } from './win32.js'
import { bootWholeDisks, mapBusProtocol, parsePlist, toDevice, type DiskutilRootInfo } from './darwin.js'
import { mapTransport, parseLsblk } from './linux.js'
import { getPlatformOps, UnsupportedPlatformError } from './index.js'

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
    // 文面ではなくキーで確かめる（列挙側は利用者の言語を知らないので訳さない）
    expect(d.blockedReason?.key).toBe('device.blockedSystemDisk')
  })

  it('書き込み禁止のメディアはブロックする', () => {
    expect(classifyDevice({ ...base, readOnly: true }).selectable).toBe(false)
  })

  it('取り外せる根拠が無いデバイスはすべてブロックする', () => {
    // nvme / sata / scsi だけを弾いていた頃は、RAID コントローラ・iSCSI・
    // ファイバチャネル・virtio のように bus が 'unknown' になるディスクが
    // 候補に出ていた（Windows では removable も false になる）。
    // 分からないものは危険側に倒す。
    for (const bus of ['nvme', 'sata', 'scsi', 'unknown', 'virtual'] as const) {
      const d = classifyDevice({ ...base, bus, removable: false })
      expect(d.selectable, bus).toBe(false)
      expect(d.blockedReason, bus).not.toBeNull()
    }
  })

  it('USB / SD、または OS が removable と言うものだけ候補にする', () => {
    for (const bus of ['usb', 'sd'] as const) {
      expect(classifyDevice({ ...base, bus, removable: false }).selectable, bus).toBe(true)
    }
    // bus が分からなくても OS が removable と言っているなら通す
    expect(classifyDevice({ ...base, bus: 'unknown', removable: true }).selectable).toBe(true)
  })

  it('容量が小さすぎるとブロックする', () => {
    const d = classifyDevice({ ...base, sizeBytes: 2_000_000_000 })
    expect(d.selectable).toBe(false)
    expect(d.blockedReason?.key).toBe('device.blockedTooSmall')
    // 境界の値は辞書ではなく実装から差し込む（両方を直さないと食い違う状態にしない）
    expect(d.blockedReason?.params).toEqual({ min: formatSize(MIN_DEVICE_BYTES) })
    expect(formatLocalized('ja', d.blockedReason!)).toContain('4.0 GB')
    expect(formatLocalized('en', d.blockedReason!)).toContain('4.0 GB')
  })

  it('2 TB 超はブロックする（外付け HDD の誤選択防止）', () => {
    const d = classifyDevice({ ...base, sizeBytes: 4_000_000_000_000 })
    expect(d.selectable).toBe(false)
    expect(d.blockedReason?.key).toBe('device.blockedTooLarge')
    expect(d.blockedReason?.params).toEqual({ max: formatSize(MAX_DEVICE_BYTES) })
    expect(formatLocalized('en', d.blockedReason!)).toContain('2.0 TB')
  })

  it('容量不明はブロックする', () => {
    expect(classifyDevice({ ...base, sizeBytes: 0 }).selectable).toBe(false)
  })

  it('境界の定数と判定が一致している', () => {
    // 定数だけ変えて判定が古いまま、という食い違いを防ぐ
    expect(classifyDevice({ ...base, sizeBytes: MIN_DEVICE_BYTES }).selectable).toBe(true)
    expect(classifyDevice({ ...base, sizeBytes: MIN_DEVICE_BYTES - 1 }).selectable).toBe(false)
    expect(classifyDevice({ ...base, sizeBytes: MAX_DEVICE_BYTES }).selectable).toBe(true)
    expect(classifyDevice({ ...base, sizeBytes: MAX_DEVICE_BYTES + 1 }).selectable).toBe(false)
  })

  it('ブロック理由は訳せる形で運ぶ（英語に切り替えて日本語が残らない）', () => {
    // 日本語の文字列をそのまま入れると、English にしてもバッジだけ日本語のまま出る。
    const blocked = [
      classifyDevice({ ...base, isSystem: true }),
      classifyDevice({ ...base, readOnly: true }),
      classifyDevice({ ...base, sizeBytes: 0 }),
      classifyDevice({ ...base, bus: 'virtual', removable: false }),
      classifyDevice({ ...base, bus: 'scsi', removable: false }),
      classifyDevice({ ...base, sizeBytes: 2_000_000_000 }),
      classifyDevice({ ...base, sizeBytes: 4_000_000_000_000 }),
    ]
    for (const d of blocked) {
      const reason = d.blockedReason
      expect(d.selectable).toBe(false)
      expect(reason).not.toBeNull()
      // 生の文字列ではなく「キー + 差し込み値」であること
      expect(typeof reason).toBe('object')
      expect(typeof reason!.key).toBe('string')
      // 英語のひな型に日本語が残っていない（差し込む値は容量の表記だけ）
      expect(formatLocalized('en', localized(reason!.key))).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
      // IPC を JSON で往復しても同じもの（関数・undefined を持たない）
      expect(JSON.parse(JSON.stringify(reason))).toEqual(reason)
    }
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

  it('FriendlyName が無いときの既定名はロケール中立', () => {
    // description は訳さない素の string（ハードウェア名を運ぶ）。
    // ここに日本語を入れると English 表示でも日本語のまま出る。
    const json = `{"Number":7,"FriendlyName":null,"SerialNumber":null,"Size":8000000000,"BusType":"USB","IsSystem":false,"IsBoot":false,"IsReadOnly":false,"IsOffline":false,"MediaType":null,"Mountpoints":[]}`
    const d = parseWindowsDisks(json)[0]!
    expect(d.description).toBe('Disk 7')
    expect(d.description).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
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
    expect(() => diskNumberFromId('/dev/sdb')).toThrow(/not a Windows disk ID/)
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

  // `diskutil info -plist /` の形（APFS の起動ボリューム）。合成ディスク disk3 の上にあり、
  // 物理ディスクは APFSPhysicalStores でしか分からない。
  const rootInfo = (physicalStore: string, synthesized = 'disk3'): string => `<plist version="1.0"><dict>
  <key>APFSContainerReference</key><string>${synthesized}</string>
  <key>APFSPhysicalStores</key><array><dict><key>APFSPhysicalStore</key><string>${physicalStore}</string></dict></array>
  <key>DeviceIdentifier</key><string>${synthesized}s1s1</string>
  <key>ParentWholeDisk</key><string>${synthesized}</string>
  <key>SystemImage</key><true/>
</dict></plist>`

  it('起動ディスクは APFS の物理ストアまで辿って特定する', () => {
    const boot = bootWholeDisks(parsePlist(rootInfo('disk0s2')) as DiskutilRootInfo)
    expect([...boot].sort()).toEqual(['disk0', 'disk3'])
  })

  it('外付け SSD から起動している Mac で、その外付けを候補に出さない', () => {
    // 回帰: 以前は DeviceIdentifier の末尾を 1 段削って `disk5s1` にしていたので、
    // 起動している外付け (disk4) が「書き込める USB」として並んだ。
    const boot = bootWholeDisks(parsePlist(rootInfo('disk4s2', 'disk5')) as DiskutilRootInfo)
    expect(boot.has('disk4')).toBe(true)
    const info = parsePlist(PLIST) as Record<string, unknown> // disk4 / USB / 外付け
    expect(toDevice(info, [], boot.has('disk4')).selectable).toBe(false)
  })

  it('壊れた / 空の情報からは何も特定しない（列挙側は 0 台にする）', () => {
    expect(bootWholeDisks(null).size).toBe(0)
    expect(bootWholeDisks({} as DiskutilRootInfo).size).toBe(0)
    expect(bootWholeDisks({ APFSPhysicalStores: 'x' } as unknown as DiskutilRootInfo).size).toBe(0)
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

  /** USB 接続の外付けディスク 1 台。子パーティションのマウントポイントだけを変える。 */
  const usbDisk = (mounts: (string | null)[], single = false): string =>
    JSON.stringify({
      blockdevices: [
        {
          name: 'sdc',
          path: '/dev/sdc',
          size: 500_107_862_016,
          type: 'disk',
          tran: 'usb',
          rm: false,
          hotplug: true,
          ro: false,
          model: 'Portable SSD',
          serial: 'X1',
          vendor: 'Acme',
          ...(single ? { mountpoint: null } : { mountpoints: [null] }),
          children: mounts.map((m, i) => ({
            name: `sdc${i + 1}`,
            path: `/dev/sdc${i + 1}`,
            type: 'part',
            ...(single ? { mountpoint: m } : { mountpoints: [m] }),
          })),
        },
      ],
    })

  it('スワップや /var を載せたディスクはシステムとして弾く', () => {
    // 回帰: 以前は / /boot /boot/efi /home の 4 つしか見ておらず、これらが候補に出た
    for (const m of ['[SWAP]', '/var', '/srv', '/data', '/opt/app']) {
      const [d] = parseLsblk(usbDisk([m]))
      expect(d!.selectable, m).toBe(false)
      expect(d!.isSystem, m).toBe(true)
    }
  })

  it('取り外し可能なメディアの置き場所にマウントされた USB は選べる', () => {
    for (const m of ['/media/user/DATA', '/run/media/user/DATA', '/mnt', '/mnt/usb', null]) {
      const [d] = parseLsblk(usbDisk([m]))
      expect(d!.selectable, String(m)).toBe(true)
    }
  })

  it('古い lsblk（MOUNTPOINT が単数）の出力も読める', () => {
    const [swap] = parseLsblk(usbDisk(['[SWAP]'], true))
    expect(swap!.isSystem).toBe(true)
    expect(swap!.mountpoints).toEqual(['[SWAP]'])
    const [media] = parseLsblk(usbDisk(['/media/user/DATA'], true))
    expect(media!.selectable).toBe(true)
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

})
