import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { classifyDevice, type DeviceBus, type PlatformOps, type RemovableDevice } from './types.js'

const exec = promisify(execFile)

// Windows のデバイス列挙と書き込み準備。
//
// 押さえるべき点:
//  - `\\.\PhysicalDriveN` への書き込みには管理者権限が要る。
//  - Windows 8 以降、マウント済みボリュームを持つディスクのパーティション領域へは書けない。
//    書く前に diskpart の `clean` でボリュームを外す（これが Rufus / Etcher と同じ手法）。
//  - PowerShell は `-NoProfile` で起動する（ユーザーのプロファイルが JSON 出力を汚すため）。
//  - ConvertTo-Json は要素 1 個の配列を配列にしないので、必ず `@(...)` で包む。

async function powershell(script: string, timeoutMs = 30_000): Promise<string> {
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  )
  return stdout
}

const LIST_SCRIPT = `
$disks = @(Get-Disk | ForEach-Object {
  $d = $_
  $mounts = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue |
    Where-Object { $_.DriveLetter } | ForEach-Object { "$($_.DriveLetter):" })
  $phys = Get-PhysicalDisk -ErrorAction SilentlyContinue |
    Where-Object { $_.DeviceId -eq [string]$d.Number } | Select-Object -First 1
  [pscustomobject]@{
    Number = $d.Number
    FriendlyName = $d.FriendlyName
    SerialNumber = $d.SerialNumber
    Size = $d.Size
    BusType = [string]$d.BusType
    IsSystem = [bool]$d.IsSystem
    IsBoot = [bool]$d.IsBoot
    IsReadOnly = [bool]$d.IsReadOnly
    IsOffline = [bool]$d.IsOffline
    MediaType = if ($phys) { [string]$phys.MediaType } else { $null }
    Mountpoints = $mounts
  }
})
ConvertTo-Json -InputObject @($disks) -Depth 4 -Compress
`

interface WinDisk {
  Number: number
  FriendlyName: string | null
  SerialNumber: string | null
  Size: number
  BusType: string
  IsSystem: boolean
  IsBoot: boolean
  IsReadOnly: boolean
  IsOffline: boolean
  MediaType: string | null
  Mountpoints: string[]
}

/** `Get-Disk` の BusType を内部表現に写す。 */
export function mapBusType(busType: string): DeviceBus {
  switch (busType.toLowerCase()) {
    case 'usb':
      return 'usb'
    case 'sd':
    case 'mmc':
      return 'sd'
    case 'nvme':
      return 'nvme'
    case 'sata':
    case 'ata':
      return 'sata'
    case 'scsi':
    case 'sas':
      return 'scsi'
    case 'filebackedvirtual':
    case 'virtual':
      return 'virtual'
    default:
      return 'unknown'
  }
}

/** `Get-Disk` の JSON 出力を RemovableDevice に変換する（純関数。テスト可能）。 */
export function parseWindowsDisks(json: string): RemovableDevice[] {
  const parsed: unknown = JSON.parse(json)
  const disks: WinDisk[] = Array.isArray(parsed) ? (parsed as WinDisk[]) : [parsed as WinDisk]
  return disks.map((d) => {
    const bus = mapBusType(d.BusType ?? '')
    const removable = bus === 'usb' || bus === 'sd'
    return classifyDevice({
      id: `\\\\.\\PhysicalDrive${d.Number}`,
      // description はハードウェア名を運ぶ素の string（訳さない）。
      // FriendlyName が無いときの既定名も、ロケール中立の表記にする
      // （ここだけ LocalizedText にすると description の型を広げることになる）。
      description: (d.FriendlyName ?? `Disk ${d.Number}`).trim(),
      sizeBytes: Number(d.Size ?? 0),
      bus,
      removable,
      // IsBoot も見る。IsSystem だけでは EFI パーティションのあるディスクを見逃すことがある。
      isSystem: Boolean(d.IsSystem) || Boolean(d.IsBoot),
      mountpoints: d.Mountpoints ?? [],
      serial: d.SerialNumber?.trim() || null,
      readOnly: Boolean(d.IsReadOnly),
    })
  })
}

/** `\\.\PhysicalDriveN` からディスク番号を取り出す。 */
export function diskNumberFromId(id: string): number {
  const m = /PhysicalDrive(\d+)$/i.exec(id)
  if (!m) throw new Error(`not a Windows disk ID: ${id}`)
  return Number(m[1])
}

export const win32Ops: PlatformOps = {
  async listDevices() {
    const out = await powershell(LIST_SCRIPT)
    const trimmed = out.trim()
    if (!trimmed) return []
    return parseWindowsDisks(trimmed)
  },

  async prepareForWrite(deviceId) {
    const n = diskNumberFromId(deviceId)
    // diskpart の clean はパーティションテーブルを消し、ボリュームのマウントを解除する。
    // これをしないと Windows 8 以降はパーティション領域への書き込みを拒否する。
    // 標準入力ではなくスクリプトファイル経由が確実なので、PowerShell 側で一時ファイルを作る。
    const script = `
$tmp = [System.IO.Path]::GetTempFileName()
Set-Content -Path $tmp -Encoding ascii -Value @"
select disk ${n}
attributes disk clear readonly
clean
"@
$out = & diskpart.exe /s $tmp 2>&1 | Out-String
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { Write-Error $out; exit 1 }
`
    await powershell(script, 120_000)
  },

  async finishWrite(deviceId) {
    const n = diskNumberFromId(deviceId)
    // 書き込んだ内容を Windows に読み直させる。失敗しても致命的ではない。
    await powershell(
      `Update-Disk -Number ${n} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500`,
      30_000,
    ).catch(() => undefined)
  },

  async hasWriteAccess() {
    try {
      const out = await powershell(
        '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
        15_000,
      )
      return out.trim().toLowerCase() === 'true'
    } catch {
      return false
    }
  },
}
