import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
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
  detectArchiveFormat,
  generateAutoinstallYaml,
  generateMetaData,
  generateUserData,
  migrateProfile,
  validateProfile,
  type AppSettings,
  type AutoinstallProfile,
  type DeviceInfo,
  type GeneratedConfig,
  type PickedFile,
  type WriteRequest,
} from '@autoinstall/shared'
// crypt はバレルに載せていない（renderer に Node の型を持ち込まないため）。main から直接 import する。
import { sha512Crypt } from '@autoinstall/shared/crypt'
import { computeChecksum, openIso } from './iso-service.js'
import * as profileStore from './profile-store.js'
import { buildSeedBundle, SeedBuildError } from './seed-builder.js'
import { getSettings, saveSettings } from './settings.js'
import { WriteSupervisor } from './write-supervisor.js'

// main ⇄ renderer の唯一の境界。renderer から来る値は一切信用しない。
// 特にパスとデバイス ID は、main 側が自分で列挙・選択したものだけを受け入れる。

const supervisor = new WriteSupervisor()

/** renderer が指定できる ISO パスは、ユーザーがダイアログで選んだものだけに限る。 */
const allowedIsoPaths = new Set<string>()
/** ペイロードとして読めるパスも、ダイアログで選ばれたものだけに限る。 */
const allowedPayloadPaths = new Set<string>()
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

function mainWindow(): BrowserWindow {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('ウィンドウがありません。')
  return win
}

/** 設定の生成と検証。ペイロードの実体は読まずにサイズだけ集計する。 */
async function generate(profile: AutoinstallProfile): Promise<GeneratedConfig> {
  const settings = await getSettings()
  const options = { comments: settings.commentLanguage } as const
  const validation = validateProfile(profile)

  let payloadBytes = 0
  const missingSources: string[] = []
  for (const f of profile.postInstall.files) payloadBytes += Buffer.byteLength(f.content, 'utf8')
  for (const d of profile.postInstall.deployments) {
    if (d.source.kind === 'inline') {
      payloadBytes += Buffer.byteLength(d.source.content, 'utf8')
    } else if (d.source.kind === 'host-file') {
      const info = await profileStore.checkHostFile(d.source.path)
      if (info.exists) payloadBytes += info.sizeBytes
      else missingSources.push(d.source.path)
    }
  }

  return {
    userData: generateUserData(profile, options),
    metaData: generateMetaData(`autoinstall-${profile.basics.hostname || 'ubuntu'}`),
    autoinstallYaml: generateAutoinstallYaml(profile, options),
    issues: validation.issues,
    ok: validation.ok,
    unattended: profile.behavior.interactiveSections.length === 0,
    payloadBytes,
    missingSources,
  }
}

export function registerIpc(): void {
  // --- ISO ---
  ipcMain.handle('chooseIso', async () => {
    const settings = await getSettings()
    const result = await dialog.showOpenDialog(mainWindow(), {
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

  // --- プロファイル（ライブラリ） ---
  ipcMain.handle('listProfiles', () => profileStore.listProfiles())

  ipcMain.handle('saveNamedProfile', (_e, id: unknown, name: unknown, profile: AutoinstallProfile) => {
    if (id !== null && typeof id !== 'string') throw new Error('プロファイル ID が不正です。')
    if (typeof name !== 'string' || !name.trim()) throw new Error('プロファイル名を入力してください。')
    return profileStore.saveProfile(id, name.trim(), profile)
  })

  ipcMain.handle('loadNamedProfile', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('プロファイル ID が不正です。')
    return profileStore.loadProfile(id)
  })

  ipcMain.handle('deleteNamedProfile', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('プロファイル ID が不正です。')
    return profileStore.deleteProfile(id)
  })

  ipcMain.handle('duplicateNamedProfile', (_e, id: unknown, newName: unknown) => {
    if (typeof id !== 'string' || typeof newName !== 'string') throw new Error('引数が不正です。')
    return profileStore.duplicateProfile(id, newName.trim() || 'コピー')
  })

  ipcMain.handle('renameNamedProfile', (_e, id: unknown, newName: unknown) => {
    if (typeof id !== 'string' || typeof newName !== 'string') throw new Error('引数が不正です。')
    if (!newName.trim()) throw new Error('プロファイル名を入力してください。')
    return profileStore.renameProfile(id, newName.trim())
  })

  ipcMain.handle('revealProfilesFolder', async () => {
    await shell.openPath(await profileStore.profilesDirectory())
  })

  // --- プロファイル（ファイル入出力） ---
  ipcMain.handle('saveProfile', async (_e, profile: AutoinstallProfile) => {
    const result = await dialog.showSaveDialog(mainWindow(), {
      title: 'プロファイルをファイルに書き出す',
      defaultPath: `${profile.meta.name || 'autoinstall'}.profile.json`,
      filters: [{ name: 'プロファイル', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await profileStore.exportProfileFile(profile, result.filePath)
    return result.filePath
  })

  ipcMain.handle('loadProfile', async () => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: 'プロファイルをファイルから読み込む',
      filters: [{ name: 'プロファイル', extensions: ['json'] }],
      properties: ['openFile'],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profile?: unknown }
    const { profile, notes } = migrateProfile(raw.profile ?? raw)
    // 読み込んだプロファイルが参照するペイロードは、以後読めるように許可しておく
    for (const d of profile.postInstall.deployments) {
      if (d.source.kind === 'host-file') allowedPayloadPaths.add(d.source.path)
    }
    return { profile, notes: [...notes] }
  })

  ipcMain.handle('importProfileToLibrary', async () => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: 'プロファイルを取り込む',
      filters: [{ name: 'プロファイル', extensions: ['json'] }],
      properties: ['openFile'],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return profileStore.importProfileFile(path, basename(path).replace(/\.profile\.json$|\.json$/, ''))
  })

  ipcMain.handle('exportBundle', async (_e, profile: AutoinstallProfile) => {
    const result = await dialog.showOpenDialog(mainWindow(), {
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
        '注意: アプリの展開を設定している場合、そのファイルはここには書き出されません。',
        '      late-commands が CIDATA パーティションをマウントして参照します。',
        '',
        `生成: ${app.getName()} ${app.getVersion()}`,
        `日時: ${new Date().toISOString()}`,
      ].join('\n'),
      'utf8',
    )
    return dir
  })

  // --- アプリ展開のペイロード ---
  ipcMain.handle('pickPayloadFile', async (): Promise<PickedFile | null> => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: 'インストール先に展開するファイルを選ぶ',
      properties: ['openFile'],
      filters: [
        { name: 'アーカイブ', extensions: ['tar.gz', 'tgz', 'tar.xz', 'txz', 'tar.bz2', 'tar', 'zip'] },
        { name: 'すべてのファイル', extensions: ['*'] },
      ],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const info = await stat(path)
    allowedPayloadPaths.add(path)
    return {
      path,
      name: basename(path),
      sizeBytes: info.size,
      archiveFormat: detectArchiveFormat(basename(path)),
    }
  })

  ipcMain.handle('checkPayloadFile', (_e, path: unknown) => {
    if (typeof path !== 'string') return { exists: false, sizeBytes: 0 }
    return profileStore.checkHostFile(path)
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
    for (const d of req.profile.postInstall.deployments) {
      if (d.source.kind === 'host-file' && !allowedPayloadPaths.has(d.source.path)) {
        return {
          started: false,
          message: `展開するファイル "${d.name}" が選択されていません。選び直してください。`,
        }
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
    let isoFingerprint = ''
    try {
      const inspection = await inspectIso(isoDev)
      const plan = buildIsoPatches(inspection, { args: ['autoinstall'], markTitle: true })
      patches = plan.patches.map((p) => ({
        offset: p.offset,
        data: p.data.toString('base64'),
        label: p.label,
      }))
      // 監査記録用。全体のハッシュは重いので、識別に足る情報だけを使う。
      isoFingerprint = createHash('sha256')
        .update(`${inspection.volumeId}|${inspection.sizeBytes}|${inspection.diskInfo ?? ''}`)
        .digest('hex')
    } finally {
      await isoDev.close().catch(() => undefined)
    }

    const settings = await getSettings()
    let bundle
    try {
      bundle = await buildSeedBundle({
        profile: req.profile,
        generateOptions: { comments: settings.commentLanguage },
        auditRecord: req.auditRecord,
        isoFileName: basename(req.isoPath),
        isoFingerprint,
        minimumCidataSize: req.cidataSizeBytes || settings.cidataSizeBytes,
      })
    } catch (err) {
      if (err instanceof SeedBuildError) return { started: false, message: err.message }
      throw err
    }
    if (bundle.missingSources.length > 0) {
      return {
        started: false,
        message: `展開するファイルが見つかりません: ${bundle.missingSources.join(', ')}`,
      }
    }

    return supervisor.start({
      isoPath: req.isoPath,
      devicePath: device.id,
      deviceSizeBytes: device.sizeBytes,
      patches,
      seedFiles: bundle.files.map((f) => ({ name: f.name, content: f.content.toString('base64') })),
      cidataSizeBytes: bundle.cidataSizeBytes,
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
      'docs.nvidia.com',
      'developer.nvidia.com',
      'www.freedesktop.org',
    ])
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) return
    await shell.openExternal(parsed.toString())
  })

  ipcMain.handle('readTextFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: 'ファイルを選ぶ',
      properties: ['openFile'],
      filters: [
        { name: '公開鍵', extensions: ['pub'] },
        { name: 'テキスト', extensions: ['txt', 'yaml', 'yml', 'cfg', 'conf', 'json', 'service', 'sh'] },
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
