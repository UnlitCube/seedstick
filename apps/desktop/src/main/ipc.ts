import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import {
  FileBlockDevice,
  buildIsoPatches,
  inspectIso,
  getPlatformOps,
  type RemovableDevice,
} from '@autoinstall/media'
import {
  createDefaultProfile,
  generateAutoinstallYaml,
  generateMetaData,
  generateUserData,
  validateProfile,
  type AppSettings,
  type AutoinstallProfile,
  type DeviceInfo,
  type GeneratedConfig,
  type WriteRequest,
} from '@autoinstall/shared'
// crypt はバレルに載せていない（renderer に Node の型を持ち込まないため）。main から直接 import する。
import { sha512Crypt } from '@autoinstall/shared/crypt'
import { computeChecksum, openIso } from './iso-service.js'
import { getSettings, saveSettings } from './settings.js'
import { WriteSupervisor } from './write-supervisor.js'

// main ⇄ renderer の唯一の境界。renderer から来る値は一切信用しない。
// 特にパスとデバイス ID は、main 側が自分で列挙・選択したものだけを受け入れる。

const supervisor = new WriteSupervisor()

/** renderer が指定できる ISO パスは、ユーザーがダイアログで選んだものだけに限る。 */
const allowedIsoPaths = new Set<string>()
/** renderer が指定できるデバイス ID は、直近の列挙結果に含まれ、かつ選択可能なものだけ。 */
let selectableDeviceIds = new Set<string>()

function toDeviceInfo(d: RemovableDevice): DeviceInfo {
  return {
    id: d.id,
    description: d.description,
    sizeBytes: d.sizeBytes,
    bus: d.bus,
    removable: d.removable,
    isSystem: d.isSystem,
    mountpoints: d.mountpoints,
    serial: d.serial,
    selectable: d.selectable,
    blockedReason: d.blockedReason,
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

async function generate(profile: AutoinstallProfile): Promise<GeneratedConfig> {
  const settings = await getSettings()
  const options = { comments: settings.commentLanguage } as const
  const validation = validateProfile(profile)
  return {
    userData: generateUserData(profile, options),
    metaData: generateMetaData(`autoinstall-${profile.basics.hostname || 'ubuntu'}`),
    autoinstallYaml: generateAutoinstallYaml(profile, options),
    issues: validation.issues,
    ok: validation.ok,
    unattended: profile.behavior.interactiveSections.length === 0,
  }
}

/** CIDATA に置くファイル一式を作る。 */
async function buildSeedFiles(
  req: WriteRequest,
  isoSha256: string,
): Promise<{ name: string; content: Buffer }[]> {
  const config = await generate(req.profile)
  const files: { name: string; content: Buffer }[] = [
    { name: 'user-data', content: Buffer.from(config.userData, 'utf8') },
    { name: 'meta-data', content: Buffer.from(config.metaData, 'utf8') },
    // 人が読む用の控え。cloud-init はこのファイルを見ない。
    { name: 'autoinstall.yaml.txt', content: Buffer.from(config.autoinstallYaml, 'utf8') },
  ]
  for (const f of req.profile.postInstall.files) {
    files.push({ name: f.name, content: Buffer.from(f.content, 'utf8') })
  }
  if (req.auditRecord) {
    // 監査用の作成記録。パスワードは含めず、設定のハッシュだけを残す。
    const record = {
      tool: `${app.getName()} ${app.getVersion()}`,
      createdAt: new Date().toISOString(),
      isoFile: basename(req.isoPath),
      isoSha256,
      ubuntuSeries: req.profile.series,
      hostname: req.profile.basics.hostname,
      username: req.profile.user.username,
      profileSha256: createHash('sha256')
        .update(JSON.stringify(req.profile))
        .digest('hex'),
      userDataSha256: createHash('sha256').update(config.userData).digest('hex'),
      unattended: config.unattended,
    }
    files.push({
      name: 'autoinstall-usb.json',
      content: Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'),
    })
  }
  return files
}

export function registerIpc(): void {
  // --- ISO ---
  ipcMain.handle('chooseIso', async () => {
    const settings = await getSettings()
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: 'Ubuntu Server の ISO ファイルを選ぶ',
      filters: [{ name: 'ISO イメージ', extensions: ['iso'] }],
      properties: ['openFile'],
      ...(settings.lastIsoDirectory ? { defaultPath: settings.lastIsoDirectory } : {}),
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    await saveSettings({ ...settings, lastIsoDirectory: dirname(path) })
    const opened = await openIso(path)
    if (opened.ok) allowedIsoPaths.add(path)
    return opened
  })

  // ドラッグ&ドロップで渡されたパスも、実際に ISO として読めた場合のみ許可リストに入れる
  ipcMain.handle('openIso', async (_e, path: unknown) => {
    if (typeof path !== 'string') return { ok: false, reason: 'invalid', detail: 'パスが不正です。' }
    const opened = await openIso(path)
    if (opened.ok) allowedIsoPaths.add(path)
    return opened
  })

  ipcMain.handle('computeIsoChecksum', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !allowedIsoPaths.has(path)) {
      throw new Error('この ISO は選択されていません。')
    }
    return computeChecksum(path, (bytesDone, bytesTotal) => {
      broadcast('checksum-progress', { bytesDone, bytesTotal })
    })
  })

  // --- 設定生成 ---
  ipcMain.handle('generateConfig', (_e, profile: AutoinstallProfile) => generate(profile))

  ipcMain.handle('hashPassword', (_e, plain: unknown) => {
    if (typeof plain !== 'string') throw new Error('パスワードが不正です。')
    // ハッシュ化は main 側で行い、平文が renderer 以外に残らないようにする
    return sha512Crypt(plain)
  })

  // --- プロファイル ---
  ipcMain.handle('saveProfile', async (_e, profile: AutoinstallProfile) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win!, {
      title: 'プロファイルを保存',
      defaultPath: `${profile.meta.name || 'autoinstall'}.profile.json`,
      filters: [{ name: 'プロファイル', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
    return result.filePath
  })

  ipcMain.handle('loadProfile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: 'プロファイルを読み込む',
      filters: [{ name: 'プロファイル', extensions: ['json'] }],
      properties: ['openFile'],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
    // 欠けたキーは既定値で補う。古いバージョンのプロファイルでも開けるようにするため。
    const base = createDefaultProfile()
    return { ...base, ...(raw as object) } as AutoinstallProfile
  })

  ipcMain.handle('exportBundle', async (_e, profile: AutoinstallProfile) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: '設定一式の保存先フォルダを選ぶ',
      properties: ['openDirectory', 'createDirectory'],
    })
    const dir = result.filePaths[0]
    if (result.canceled || !dir) return null
    const config = await generate(profile)
    await writeFile(join(dir, 'user-data'), config.userData, 'utf8')
    await writeFile(join(dir, 'meta-data'), config.metaData, 'utf8')
    await writeFile(join(dir, 'autoinstall.yaml'), config.autoinstallYaml, 'utf8')
    await writeFile(
      join(dir, 'README.txt'),
      [
        'Ubuntu Server 自動インストール設定',
        '',
        '使い方（このツール以外で USB を作る場合）:',
        '1. Ubuntu の live-server ISO を Rufus / balenaEtcher などで USB に書き込む（DD モード）。',
        '2. 別の USB メモリを FAT32 でフォーマットし、ボリュームラベルを CIDATA にする。',
        '3. そこに user-data と meta-data をコピーする。',
        '4. 両方の USB を挿してサーバーを起動する。',
        '5. GRUB のメニューで e を押し、linux の行の末尾（--- の前）に autoinstall を追加して Ctrl+X で起動する。',
        '   ※ この手順を省くと "Continue with autoinstall? (yes|no)" で止まります。',
        '',
        'このツールで USB を作れば、上記 2〜5 はすべて自動で行われます。',
        '',
        `生成: ${app.getName()} ${app.getVersion()}`,
        `日時: ${new Date().toISOString()}`,
      ].join('\n'),
      'utf8',
    )
    return dir
  })

  // --- デバイス ---
  ipcMain.handle('listDevices', async () => {
    const devices = await getPlatformOps().listDevices()
    selectableDeviceIds = new Set(devices.filter((d) => d.selectable).map((d) => d.id))
    return devices.map(toDeviceInfo)
  })

  // --- 書き込み ---
  ipcMain.handle('startWrite', async (_e, req: WriteRequest) => {
    // renderer から来たパス・デバイス ID を検証する。ここが最後の砦。
    if (!allowedIsoPaths.has(req.isoPath)) {
      return { started: false, message: 'この ISO は選択されていません。選び直してください。' }
    }
    if (!selectableDeviceIds.has(req.deviceId)) {
      return {
        started: false,
        message: 'このデバイスには書き込めません。デバイス一覧を再読み込みしてください。',
      }
    }
    const validation = validateProfile(req.profile)
    if (!validation.ok) {
      return { started: false, message: '設定にエラーがあります。確認画面で修正してください。' }
    }

    const devices = await getPlatformOps().listDevices()
    const device = devices.find((d) => d.id === req.deviceId)
    if (!device || !device.selectable) {
      return { started: false, message: 'デバイスが見つかりません。挿し直して再読み込みしてください。' }
    }

    // ISO のパッチは main 側で作る。画面に見せた内容とワーカーが書く内容を一致させるため。
    const isoDev = await FileBlockDevice.open(req.isoPath, 'r')
    let patches
    let isoSha256 = ''
    try {
      const inspection = await inspectIso(isoDev)
      const plan = buildIsoPatches(inspection, { args: ['autoinstall'], markTitle: true })
      patches = plan.patches.map((p) => ({
        offset: p.offset,
        data: p.data.toString('base64'),
        label: p.label,
      }))
      // 監査記録用。全体のハッシュは重いので、識別に足る情報だけを使う。
      isoSha256 = createHash('sha256')
        .update(`${inspection.volumeId}|${inspection.sizeBytes}|${inspection.diskInfo ?? ''}`)
        .digest('hex')
    } finally {
      await isoDev.close().catch(() => undefined)
    }

    const seedFiles = await buildSeedFiles(req, isoSha256)
    const settings = await getSettings()

    return supervisor.start({
      isoPath: req.isoPath,
      devicePath: device.id,
      deviceSizeBytes: device.sizeBytes,
      patches,
      seedFiles: seedFiles.map((f) => ({ name: f.name, content: f.content.toString('base64') })),
      cidataSizeBytes: req.cidataSizeBytes || settings.cidataSizeBytes,
      hideIsoPartitionFromWindows: true,
      verify: req.verify,
      timestampIso: new Date().toISOString(),
      randomSeedBase64: randomBytes(32).toString('base64'),
    })
  })

  ipcMain.handle('cancelWrite', () => supervisor.cancel())
  ipcMain.handle('getWriteStatus', () => supervisor.getStatus())

  // --- 設定 ---
  ipcMain.handle('getSettings', () => getSettings())
  ipcMain.handle('saveSettings', (_e, next: AppSettings) => saveSettings(next))

  // --- その他 ---
  ipcMain.handle('openExternal', async (_e, url: unknown) => {
    // 任意の URL を開かせない。https で、既知のホストのみ。
    if (typeof url !== 'string') return
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    const allowedHosts = new Set([
      'ubuntu.com',
      'www.ubuntu.com',
      'releases.ubuntu.com',
      'cdimage.ubuntu.com',
      'canonical-subiquity.readthedocs-hosted.com',
      'docs.cloud-init.io',
      'netplan.io',
    ])
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) return
    await shell.openExternal(parsed.toString())
  })

  ipcMain.handle('readTextFile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: 'ファイルを選ぶ',
      properties: ['openFile'],
      filters: [
        { name: '公開鍵', extensions: ['pub'] },
        { name: 'テキスト', extensions: ['txt', 'yaml', 'yml', 'cfg', 'conf', 'json'] },
        { name: 'すべて', extensions: ['*'] },
      ],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    // 巨大なファイルを renderer に流し込まない
    const content = await readFile(path, 'utf8')
    if (content.length > 512 * 1024) {
      throw new Error('ファイルが大きすぎます（512 KB まで）。')
    }
    return { name: basename(path), content }
  })

  supervisor.onStatus((status) => broadcast('write-status', status))
}

export function disposeIpc(): Promise<void> {
  return supervisor.dispose()
}
