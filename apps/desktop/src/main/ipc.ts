import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import { readFile, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import {
  FileBlockDevice,
  buildIsoPatches,
  inspectIso,
  getPlatformOps,
  minimumDiskSize,
  patchGrubCfg,
  remainingGrubBytes,
  type RemovableDevice,
} from '@autoinstall/media'
import {
  buildGrubPlan,
  detectArchiveFormat,
  generateAutoinstallYaml,
  generateMetaData,
  isUnattendedProfile,
  generateUserData,
  migrateProfile,
  validateProfile,
  addUniqueIssue,
  generateErrorIssue,
  createTranslator,
  localized,
  type AppSettings,
  type ValidationIssue,
  type AutoinstallProfile,
  type DeviceInfo,
  type GeneratedConfig,
  type ImageTarget,
  type ImageWriteRequest,
  type LocalizedText,
  type PickedFile,
  type WriteRequest,
  type GenerateOptions,
} from '@autoinstall/shared'
// crypt はバレルに載せていない（renderer に Node の型を持ち込まないため）。main から直接 import する。
import { sha512Crypt } from '@autoinstall/shared/crypt'
import {
  checkFreeSpace,
  checkImageDestination,
  suggestImageFileName,
} from './image-target.js'
import { computeChecksum, openIso } from './iso-service.js'
import { rememberChosenPayload, wasChosenByUser } from './payload-allowlist.js'
import * as profileStore from './profile-store.js'
import { buildSeedBundle, SeedBuildError } from './seed-builder.js'
import { getSettings, saveSettings } from './settings.js'
import { WriteSupervisor } from './write-supervisor.js'

// main ⇄ renderer の唯一の境界。renderer から来る値は一切信用しない。
// 特にパスとデバイス ID は、main 側が自分で列挙・選択したものだけを受け入れる。

const supervisor = new WriteSupervisor()

/**
 * プロファイルに書かれた同梱ファイルのパスを許可リストに入れる。
 *
 * プロファイルは他の PC から持ち込まれることを想定した機能なので、
 * JSON に書かれたパスは信用できる入力ではない。
 *
 * **「実在するか」は安全性の検査ではない。** 実在確認だけで許可していたため、
 * 他人からもらったプロファイル JSON に `.ssh/id_rsa` のような読めるファイルを
 * 書いておくだけで、開いて USB を作った利用者のファイルが CIDATA に載っていた。
 * 許可するのは **利用者が自分でダイアログから選んだことのあるパスだけ**にする
 * （その記録は payload-allowlist.ts に残る）。
 *
 * 記録に無いパスは登録しない。後段の generate() が `missingSources` として
 * 画面に出すので、利用者は選び直せる。
 */
async function allowProfilePayloads(profile: AutoinstallProfile): Promise<void> {
  for (const d of profile.postInstall.deployments) {
    if (d.source.kind !== 'host-file') continue
    if (!(await wasChosenByUser(d.source.path))) continue
    const info = await profileStore.checkHostFile(d.source.path)
    if (info.exists) allowedPayloadPaths.add(d.source.path)
  }
}

/** renderer が指定できる ISO パスは、ユーザーがダイアログで選んだものだけに限る。 */
const allowedIsoPaths = new Set<string>()
/** ペイロードとして読めるパスも、ダイアログで選ばれたものだけに限る。 */
const allowedPayloadPaths = new Set<string>()
/**
 * イメージファイル (.img) の書き出し先も同じ扱い。
 * **保存ダイアログを通ったパスだけ**が入る（落とし穴 55）。
 * プロファイル JSON からここに入る経路は作らない——書き出し先は「読む」ではなく
 * 「上書きする」なので、他人の JSON から指定できると任意のファイルを潰せる。
 */
const allowedImagePaths = new Set<string>()
/** renderer が指定できるデバイス ID は、直近の列挙結果に含まれ、かつ選択可能なものだけ。 */
let selectableDeviceIds = new Set<string>()
/** 直近に開いた ISO の grub.cfg 原文。確認画面のプレビューに使う。 */
let lastIsoGrubCfg: string | null = null

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

/**
 * OS ネイティブのダイアログ用の翻訳関数。
 *
 * ダイアログのタイトルとファイル種別は renderer を通らない（Electron が OS に渡す）ので、
 * `LocalizedText` では運べない。ここだけは **main が自分で訳す**。
 */
async function dialogT(): Promise<ReturnType<typeof createTranslator>> {
  const settings = await getSettings()
  return createTranslator(settings.locale)
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

  // grub.cfg のプレビュー。ISO を開いていれば実物を元に作る。
  let patchedGrubCfg: string | null = null
  let grubFreeBytes = 0
  let grubTooLarge = false
  if (lastIsoGrubCfg !== null) {
    const plan = buildGrubPlan(profile)
    const patched = patchGrubCfg(lastIsoGrubCfg, {
      args: plan.args,
      markTitle: true,
      extraEntries: plan.entries,
    })
    patchedGrubCfg = patched.text
    grubFreeBytes = remainingGrubBytes(patched.text)
    grubTooLarge = grubFreeBytes < 0
  }

  // 収まらないことは「エラー」として一覧に出す。ok を false にするだけだと
  // 確認画面は「問題ありません」のまま次へ進めなくなり、理由が分からない。
  const issues = grubTooLarge
    ? [
        ...validation.issues,
        {
          severity: 'error' as const,
          field: 'runtimeValues.presets',
          text: localized('validate.grubMenuTooLarge', { bytes: -grubFreeBytes }),
        },
      ]
    : validation.issues

  return {
    userData: generateUserData(profile, options),
    metaData: generateMetaData(`autoinstall-${profile.basics.hostname || 'ubuntu'}`),
    autoinstallYaml: generateAutoinstallYaml(profile, options),
    issues,
    ok: validation.ok && !grubTooLarge,
    // 「電源を入れるだけで完了する」かどうか。
    // プロファイルの設定からではなく **実際に出力される YAML** を見る。
    // シリーズによって出さないキーがあるので、設定だけを見ると食い違う
    // （22.04 で「対話あり」と表示しながら完全無人の YAML を出していた）。
    unattended: isUnattendedProfile(profile, options),
    payloadBytes,
    missingSources,
    patchedGrubCfg,
    grubFreeBytes,
    grubTooLarge,
  }
}

/** 書き込みを始められなかったときに返す形（デバイス・ファイルで共通）。 */
type StartFailure = { started: false; message: LocalizedText; detail: string | null }

const fail = (message: LocalizedText, detail: string | null = null): StartFailure => ({
  started: false,
  message,
  detail,
})

/**
 * プロファイル側の入力を確かめる。**デバイスにもファイルにも触らない。**
 *
 * デバイスへの書き込みとイメージ書き出しで**まったく同じ**でなければならない
 * （片方だけ緩いと、緩いほうが抜け道になる）。
 */
function checkProfileInputs(profile: AutoinstallProfile): StartFailure | null {
  for (const d of profile.postInstall.deployments) {
    if (d.source.kind === 'host-file' && !allowedPayloadPaths.has(d.source.path)) {
      return fail(localized('write.payloadNotSelected', { name: d.name }))
    }
  }
  if (!validateProfile(profile).ok) return fail(localized('write.configInvalidBody'))
  return null
}

/** ISO のパッチと CIDATA の中身。デバイスへ書くときもファイルへ書き出すときも同じもの。 */
interface PreparedMedia {
  readonly patches: { offset: number; data: string; label: string }[]
  readonly isoFingerprint: string
  readonly isoSizeBytes: number
  readonly bundle: Awaited<ReturnType<typeof buildSeedBundle>>
}

/**
 * ISO を解析してパッチを作り、CIDATA に載せるファイルを組み立てる。
 *
 * ISO のパッチは main 側で作る。画面に見せた内容と、実際に書かれる内容を一致させるため。
 * ここで投げる例外（grub.cfg が 1 セクタに収まらない、ISO が壊れている等）を
 * 握らないと `ipcMain.handle` が reject し、GUI 側は理由の分からないまま
 * ボタンが無反応になる。
 */
async function prepareMedia(req: {
  isoPath: string
  profile: AutoinstallProfile
  cidataSizeBytes: number
  auditRecord: boolean
}): Promise<{ ok: true; media: PreparedMedia } | { ok: false; failure: StartFailure }> {
  let patches: { offset: number; data: string; label: string }[]
  let isoFingerprint = ''
  let isoSizeBytes = 0
  try {
    const isoDev = await FileBlockDevice.open(req.isoPath, 'r')
    try {
      const inspection = await inspectIso(isoDev)
      const grubPlan = buildGrubPlan(req.profile)
      const plan = buildIsoPatches(inspection, {
        args: grubPlan.args,
        markTitle: true,
        extraEntries: grubPlan.entries,
      })
      patches = plan.patches.map((p) => ({
        offset: p.offset,
        data: p.data.toString('base64'),
        label: p.label,
      }))
      isoSizeBytes = inspection.sizeBytes
      // 監査記録用。全体のハッシュは重いので、識別に足る情報だけを使う。
      isoFingerprint = createHash('sha256')
        .update(`${inspection.volumeId}|${inspection.sizeBytes}|${inspection.diskInfo ?? ''}`)
        .digest('hex')
    } finally {
      await isoDev.close().catch(() => undefined)
    }
  } catch (err) {
    // ISO の内部構造の話は**開発者向けの診断**。訳した総括文と生の詳細の 2 本立てにする。
    return { ok: false, failure: fail(localized('write.isoPrepareFailed'), (err as Error).message) }
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
    // `err.message`（日本語）はログ用に残してあるが、画面には訳せる `err.text` を出す。
    if (err instanceof SeedBuildError) return { ok: false, failure: fail(err.text) }
    throw err
  }
  if (bundle.missingSources.length > 0) {
    return {
      ok: false,
      failure: fail(localized('write.payloadMissing', { files: bundle.missingSources.join(', ') })),
    }
  }
  return { ok: true, media: { patches, isoFingerprint, isoSizeBytes, bundle } }
}

/**
 * 保存先ボリュームの空き容量。取れなければ null。
 *
 * `statfs` は環境によって落ちる（ネットワークドライブ、権限）。**分からないことを
 * 「足りない」と言わない**ので、取れなかったら判定しない（`checkFreeSpace`）。
 */
async function freeSpaceAt(path: string): Promise<number | null> {
  try {
    const fs = await statfs(dirname(path))
    const free = Number(fs.bavail) * Number(fs.bsize)
    return Number.isFinite(free) && free >= 0 ? free : null
  } catch {
    return null
  }
}

export function registerIpc(): void {
  // --- ISO ---
  ipcMain.handle('chooseIso', async () => {
    const settings = await getSettings()
    const t = createTranslator(settings.locale)
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: t('dialog.chooseIso'),
      filters: [{ name: t('dialog.filterIso'), extensions: ['iso'] }],
      properties: ['openFile'],
      ...(settings.lastIsoDirectory ? { defaultPath: settings.lastIsoDirectory } : {}),
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    await saveSettings({ ...settings, lastIsoDirectory: dirname(path) })
    const opened = await openIso(path)
    if (opened.ok) {
      allowedIsoPaths.add(path)
      lastIsoGrubCfg = opened.info.grubCfg
    }
    return opened
  })

  // ドラッグ&ドロップで渡されたパスも、実際に ISO として読めた場合のみ許可リストに入れる
  ipcMain.handle('openIso', async (_e, path: unknown) => {
    // renderer が string 以外を送ってきた場合のガード。文言は「バグ／攻撃の検出」なので
    // 訳す価値が無い。総括だけ訳し、生の理由は開発者向けの詳細として添える。
    if (typeof path !== 'string') {
      return { ok: false, reason: 'invalid', text: localized('error.unknown'), detail: 'パスが不正です。' }
    }
    const opened = await openIso(path)
    if (opened.ok) {
      allowedIsoPaths.add(path)
      lastIsoGrubCfg = opened.info.grubCfg
    }
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
  ipcMain.handle('generateConfig', async (_e, profile: AutoinstallProfile) => {
    try {
      return await generate(profile)
    } catch (err) {
      // ここで reject すると renderer は config を null にするだけなので、
      // 確認画面はエラーも理由も出さずに「次へ」が無効になる（実機で確認）。
      // 生成できない理由をエラーとして返し、必ず画面に出す。
      //
      // **検証の結果を捨てない。** 以前はここで作った 1 件だけを issues にしていたので、
      // 生成が落ちた瞬間に他の指摘（ロックアウト・危険なディスク指定など）が
      // すべて消えていた。`validateProfile` は壊れた設定でも投げない契約なので、
      // ここで取り直して生成の指摘を足す。
      const issues: ValidationIssue[] = []
      try {
        issues.push(...validateProfile(profile).issues)
      } catch {
        // 検証まで落ちたら生成の指摘だけを出す（何も出さないよりよい）
      }
      // 文言はキーから引く。日本語の診断 (`Error.message`) を英文に連結しない。
      addUniqueIssue(issues, generateErrorIssue(err))
      return {
        userData: '',
        metaData: '',
        autoinstallYaml: '',
        issues,
        ok: false,
        unattended: false,
        payloadBytes: 0,
        missingSources: [],
        patchedGrubCfg: null,
        grubFreeBytes: 0,
        grubTooLarge: false,
      }
    }
  })

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

  ipcMain.handle('loadNamedProfile', async (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('プロファイル ID が不正です。')
    const loaded = await profileStore.loadProfile(id)
    // 保存済みプロファイルを開いた場合も同梱ファイルを読めるようにする。
    // ここを通さないと、アプリを再起動したあと「一度も書き込めない」状態になる。
    if (loaded) await allowProfilePayloads(loaded.profile)
    return loaded
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
    const t = await dialogT()
    const result = await dialog.showSaveDialog(mainWindow(), {
      title: t('dialog.saveProfile'),
      defaultPath: `${profile.meta.name || 'autoinstall'}.profile.json`,
      filters: [{ name: t('dialog.filterProfile'), extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await profileStore.exportProfileFile(profile, result.filePath)
    return result.filePath
  })

  ipcMain.handle('loadProfile', async () => {
    const t = await dialogT()
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: t('dialog.openProfile'),
      filters: [{ name: t('dialog.filterProfile'), extensions: ['json'] }],
      properties: ['openFile'],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profile?: unknown }
    const { profile, notes } = migrateProfile(raw.profile ?? raw)
    // 読み込んだプロファイルが参照するペイロードは、以後読めるように許可しておく。
    // 取り込んだ JSON の任意パスをそのまま信じず、実在するファイルだけ登録する。
    await allowProfilePayloads(profile)
    return { profile, notes: [...notes] }
  })

  ipcMain.handle('importProfileToLibrary', async () => {
    const t = await dialogT()
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: t('dialog.importProfile'),
      filters: [{ name: t('dialog.filterProfile'), extensions: ['json'] }],
      properties: ['openFile'],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const ref = await profileStore.importProfileFile(
      path,
      basename(path).replace(/\.profile\.json$|\.json$/, ''),
    )
    // 取り込んだ直後に開けるよう、同梱ファイルのパスも通しておく
    if (ref) {
      const loaded = await profileStore.loadProfile(ref.id)
      if (loaded) await allowProfilePayloads(loaded.profile)
    }
    return ref
  })

  ipcMain.handle('exportBundle', async (_e, profile: AutoinstallProfile) => {
    const settings = await getSettings()
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: createTranslator(settings.locale)('dialog.exportBundleDir'),
      properties: ['openDirectory', 'createDirectory'],
    })
    const dir = result.filePaths[0]
    if (result.canceled || !dir) return null
    const config = await generate(profile)
    await writeFile(join(dir, 'user-data'), config.userData, 'utf8')
    await writeFile(join(dir, 'meta-data'), config.metaData, 'utf8')
    await writeFile(join(dir, 'autoinstall.yaml'), config.autoinstallYaml, 'utf8')
    // README は画面ではなく**生成物**なので、生成物のコメント言語に合わせる。
    // 'none'（コメントを入れない）のときは読む人が居ないわけではないので、UI の言語に落とす。
    const readmeLocale = settings.commentLanguage === 'none' ? settings.locale : settings.commentLanguage
    await writeFile(
      join(dir, 'README.txt'),
      createTranslator(readmeLocale)('bundle.readme', {
        tool: `${app.getName()} ${app.getVersion()}`,
        date: new Date().toISOString(),
      }),
      'utf8',
    )
    return dir
  })

  // --- アプリ展開のペイロード ---
  ipcMain.handle('pickPayloadFile', async (): Promise<PickedFile | null> => {
    const t = await dialogT()
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: t('dialog.pickPayload'),
      properties: ['openFile'],
      filters: [
        {
          name: t('dialog.filterArchive'),
          extensions: ['tar.gz', 'tgz', 'tar.xz', 'txz', 'tar.bz2', 'tar', 'zip'],
        },
        { name: t('dialog.filterAllFiles'), extensions: ['*'] },
      ],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const info = await stat(path)
    allowedPayloadPaths.add(path)
    // 「自分で選んだ」ことを残す。次回このプロファイルを開いたときに、
    // 選び直さずに書き込めるのはこの記録があるパスだけ。
    await rememberChosenPayload(path)
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
      return { started: false, message: localized('write.isoNotSelected'), detail: null }
    }
    if (!selectableDeviceIds.has(req.deviceId)) {
      return { started: false, message: localized('write.deviceNotWritable'), detail: null }
    }
    const inputFailure = checkProfileInputs(req.profile)
    if (inputFailure) return inputFailure

    const devices = await getPlatformOps().listDevices()
    const device = devices.find((d) => d.id === req.deviceId)
    if (!device || !device.selectable) {
      return { started: false, message: localized('write.deviceGone'), detail: null }
    }

    const prepared = await prepareMedia(req)
    if (!prepared.ok) return prepared.failure
    const { patches, bundle } = prepared.media

    return supervisor.start({
      isoPath: req.isoPath,
      devicePath: device.id,
      deviceSizeBytes: device.sizeBytes,
      // 昇格側で「ユーザーが選んだ実物」を見分けるために渡す
      deviceSerial: device.serial,
      deviceDescription: device.description,
      patches,
      seedFiles: bundle.files.map((f) => ({ name: f.name, content: f.content.toString('base64') })),
      cidataSizeBytes: bundle.cidataSizeBytes,
      hideIsoPartitionFromWindows: true,
      verify: req.verify,
      timestampIso: new Date().toISOString(),
      randomSeedBase64: randomBytes(32).toString('base64'),
    })
  })

  // --- イメージファイル (.img) への書き出し ---
  //
  // 実デバイスへの書き込みとの違いは 2 つだけ:
  //   * **昇格しない**（ファイルに書くだけなので管理者権限が要らない）。
  //   * **大きさをデバイスの容量に合わせない**（ISO + CIDATA + GPT + 余裕）。
  // 入力の検証は実デバイスとまったく同じ厳しさにする。

  ipcMain.handle('chooseImagePath', async (_e, suggestedName: unknown): Promise<ImageTarget | null> => {
    const t = await dialogT()
    const result = await dialog.showSaveDialog(mainWindow(), {
      title: t('dialog.saveImage'),
      // 既定のファイル名は利用者の自由入力から作るので、必ず通してから使う。
      defaultPath: suggestImageFileName(typeof suggestedName === 'string' ? suggestedName : ''),
      filters: [{ name: t('dialog.filterImage'), extensions: ['img'] }],
      // 既存ファイルの上書きは OS の確認ダイアログに任せる（macOS では明示が要る）。
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return null
    const path = result.filePath
    // **ここが唯一の入口。** 以後この書き出し先だけが `startImageWrite` を通る。
    allowedImagePaths.add(path)
    return { path, fileName: basename(path), freeBytes: await freeSpaceAt(path) }
  })

  ipcMain.handle('startImageWrite', async (_e, req: ImageWriteRequest) => {
    if (!allowedIsoPaths.has(req.isoPath)) {
      return { started: false, message: localized('write.isoNotSelected'), detail: null }
    }
    if (typeof req.imagePath !== 'string') {
      return fail(localized('image.pathNotChosen'))
    }
    // ダイアログを通っていないパス・入力を壊すパスをここで断る。
    const destFailure = checkImageDestination({
      imagePath: req.imagePath,
      allowedImagePaths,
      // 「今回の ISO」だけでなく、開いた実績のある ISO をすべて守る。
      isoPaths: allowedIsoPaths,
      payloadPaths: allowedPayloadPaths,
    })
    if (destFailure) return fail(destFailure)

    const inputFailure = checkProfileInputs(req.profile)
    if (inputFailure) return inputFailure

    const prepared = await prepareMedia(req)
    if (!prepared.ok) return prepared.failure
    const { patches, bundle, isoSizeBytes } = prepared.media

    // **書き始める前に**空き容量を見る。途中で ENOSPC になると
    // 中途半端な .img が残り、「焼いたのに起動しない」原因になる。
    const requiredBytes = minimumDiskSize(isoSizeBytes, bundle.cidataSizeBytes)
    const spaceFailure = checkFreeSpace(requiredBytes, await freeSpaceAt(req.imagePath))
    if (spaceFailure) return fail(spaceFailure)

    return supervisor.startImageWrite({
      isoPath: req.isoPath,
      imagePath: req.imagePath,
      patches,
      seedFiles: bundle.files.map((f) => ({ name: f.name, content: f.content.toString('base64') })),
      cidataSizeBytes: bundle.cidataSizeBytes,
      hideIsoPartitionFromWindows: true,
      verify: req.verify,
      timestampIso: new Date().toISOString(),
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
    const t = await dialogT()
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: t('dialog.readTextFile'),
      properties: ['openFile'],
      filters: [
        { name: t('dialog.filterPublicKey'), extensions: ['pub'] },
        {
          name: t('dialog.filterText'),
          extensions: ['txt', 'yaml', 'yml', 'cfg', 'conf', 'json', 'service', 'sh'],
        },
        { name: t('dialog.filterAllFiles'), extensions: ['*'] },
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

/** 書き込みが走っているか（終了時の確認に使う）。 */
export function isWriteInProgress(): boolean {
  return supervisor.isBusy()
}

/**
 * 書き込みを止めてから片付ける。
 *
 * いきなりプロセスを落とすと、昇格したワーカーが孤児になって USB を書き続ける。
 * パーティションテーブルを書く直前で切られた USB は「起動しないのに書き込み済みに
 * 見える」状態になるので、まず cancel を送り、終わるのを待ってから閉じる。
 */
export async function shutdownWrite(timeoutMs = 15000): Promise<void> {
  if (!supervisor.isBusy()) return
  await supervisor.cancel()
  const deadline = Date.now() + timeoutMs
  while (supervisor.isBusy() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
}
