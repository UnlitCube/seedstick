import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDefaultProfile,
  formatLocalized,
  type AppSettings,
  type AutoinstallProfile,
  type LocalizedText,
} from '@autoinstall/shared'

// main が返す文言は「キー + 差し込み値」で運ぶ。ここで日本語の文面を固定すると、
// English に切り替えても日本語を返す実装をテストが「正」として要求してしまう
// （落とし穴 56）。確かめるのは **キー** と **差し込み値**。

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  /** 直近に開いたネイティブダイアログの options（タイトルと種別を検査する） */
  dialogs: [] as Record<string, unknown>[],
  openDialogResult: { canceled: true, filePaths: [] as string[] },
  settings: null as AppSettings | null,
  devices: [] as unknown[],
}))

const fakeWindow = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown): void => {
      h.handlers.set(channel, fn)
    },
  },
  BrowserWindow: {
    getFocusedWindow: () => fakeWindow,
    getAllWindows: () => [fakeWindow],
  },
  dialog: {
    showOpenDialog: (_w: unknown, options: Record<string, unknown>) => {
      h.dialogs.push(options)
      return Promise.resolve(h.openDialogResult)
    },
    showSaveDialog: (_w: unknown, options: Record<string, unknown>) => {
      h.dialogs.push(options)
      return Promise.resolve({ canceled: true, filePath: '' })
    },
  },
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  app: {
    getName: () => 'Autoinstall USB Creator',
    getVersion: () => '0.1.0',
    getLocale: () => 'ja-JP',
    getPath: () => mkdtempSync(join(tmpdir(), 'ipc-test-')),
  },
}))

vi.mock('./settings.js', () => ({
  getSettings: () => Promise.resolve(h.settings),
  saveSettings: (next: AppSettings) => {
    h.settings = next
    return Promise.resolve(next)
  },
}))

// 実 ISO を用意せずに「選ばれた実績のある ISO」を作るため、検査だけ差し替える。
vi.mock('./iso-service.js', () => ({
  openIso: () =>
    Promise.resolve({
      ok: true,
      info: { path: 'C:/fake.iso', grubCfg: 'menuentry "x" {\n  linux /casper/vmlinuz ---\n}\n' },
    }),
  computeChecksum: () => Promise.resolve({ sha256: '', official: 'unknown', officialSource: null }),
}))

vi.mock('@autoinstall/media', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return { ...mod, getPlatformOps: () => ({ listDevices: () => Promise.resolve(h.devices) }) }
})

const { registerIpc } = await import('./ipc.js')

registerIpc()

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`ハンドラがない: ${channel}`)
  return Promise.resolve(fn(...([{}, ...args] as never[]))) as Promise<T>
}

type StartResult = { started: boolean; message?: LocalizedText; detail?: string | null }

function defaultSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    locale: 'ja',
    lastIsoDirectory: null,
    verifyAfterWrite: false,
    cidataSizeBytes: 64 * 1024 * 1024,
    auditRecord: false,
    commentLanguage: 'ja',
    ...overrides,
  }
}

const DEVICE = {
  id: '\\\\.\\PhysicalDrive9',
  description: 'Test USB',
  sizeBytes: 31_000_000_000,
  bus: 'usb',
  removable: true,
  isSystem: false,
  mountpoints: [],
  serial: 'X',
  selectable: true,
  blockedReason: null,
}

function writeRequest(profile: AutoinstallProfile, isoPath = 'C:/fake.iso'): unknown {
  return {
    isoPath,
    deviceId: DEVICE.id,
    profile,
    verify: false,
    cidataSizeBytes: 64 * 1024 * 1024,
    auditRecord: false,
  }
}

beforeEach(() => {
  h.dialogs = []
  h.openDialogResult = { canceled: true, filePaths: [] }
  h.settings = defaultSettings()
  h.devices = [DEVICE]
})

describe('startWrite が返す拒否理由は訳せる形で運ばれる', () => {
  it('選ばれていない ISO はキーで返る（日本語の文字列ではない）', async () => {
    // 許可リストに入る経路（openIso ハンドラ）を一度も通していないパスを使う。
    // 他のテストが先に走っても結果が変わらないようにする。
    const r = await call<StartResult>(
      'startWrite',
      writeRequest(createDefaultProfile(), 'C:/never-chosen.iso'),
    )
    expect(r.started).toBe(false)
    expect(r.message).toEqual({ key: 'write.isoNotSelected' })
    expect(r.detail).toBeNull()
    // 英語でも日本語が混ざらない
    expect(formatLocalized('en', r.message!)).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
  })

  it('直近の列挙で選べなかったデバイスはキーで返る', async () => {
    await call('openIso', 'C:/fake.iso')
    // listDevices を呼んでいないので selectableDeviceIds は空
    const r = await call<StartResult>('startWrite', writeRequest(createDefaultProfile()))
    expect(r.message).toEqual({ key: 'write.deviceNotWritable' })
  })

  it('選び直しが要るペイロードは、名前を差し込み値として運ぶ', async () => {
    await call('openIso', 'C:/fake.iso')
    await call('listDevices')
    const base = createDefaultProfile()
    const profile: AutoinstallProfile = {
      ...base,
      postInstall: {
        ...base.postInstall,
        deployments: [
          {
            id: 'd1',
            kind: 'archive',
            name: 'myapp.tar.gz',
            source: { kind: 'host-file', path: 'C:/not-chosen.tar.gz', sizeBytes: 1 },
            targetPath: '/opt/app',
            owner: 'root',
            group: 'root',
            mode: '0644',
            archiveFormat: 'tar.gz',
            postCommand: '',
            chownRecursive: false,
          },
        ],
      },
    }
    const r = await call<StartResult>('startWrite', writeRequest(profile))
    expect(r.message).toEqual({
      key: 'write.payloadNotSelected',
      params: { name: 'myapp.tar.gz' },
    })
    // 名前は利用者が付けた自由入力。訳文には差し込まれるだけで、キーは変わらない。
    expect(formatLocalized('en', r.message!)).toContain('myapp.tar.gz')
  })

  it('検証で落ちた設定は既存の「確認画面で直して」のキーを使い回す', async () => {
    await call('openIso', 'C:/fake.iso')
    await call('listDevices')
    // 既定のプロファイルはパスワード未設定なので検証を通らない
    const r = await call<StartResult>('startWrite', writeRequest(createDefaultProfile()))
    expect(r.message).toEqual({ key: 'write.configInvalidBody' })
  })
})

describe('openIso の型ガードは総括を訳し、生の理由は詳細に落とす', () => {
  it('string でない値には LocalizedText と開発者向けの detail が付く', async () => {
    const r = await call<{ ok: boolean; reason: string; text: LocalizedText; detail: string | null }>(
      'openIso',
      42,
    )
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
    expect(r.text.key).toBe('error.unknown')
    // 開発者向けの診断は訳さずそのまま（バグ報告の突き合わせに使う）
    expect(r.detail).toBe('パスが不正です。')
  })
})

// ネイティブダイアログのタイトルは renderer を通らないので、LocalizedText では運べない。
// main が settings.locale で訳す。訳し忘れると English 環境でここだけ日本語になる。
describe('OS ネイティブのダイアログは main が訳す', () => {
  const cases: readonly (readonly [string, unknown[]])[] = [
    ['chooseIso', []],
    ['saveProfile', [createDefaultProfile()]],
    ['loadProfile', []],
    ['importProfileToLibrary', []],
    ['exportBundle', [createDefaultProfile()]],
    ['pickPayloadFile', []],
    ['readTextFile', []],
  ]

  it('locale=en ではタイトルにも種別にも日本語が出ない', async () => {
    h.settings = defaultSettings({ locale: 'en' })
    for (const [channel, args] of cases) await call(channel, ...args)
    expect(h.dialogs.length).toBe(cases.length)
    for (const options of h.dialogs) {
      const texts = [
        String(options.title ?? ''),
        ...((options.filters as { name: string }[] | undefined) ?? []).map((f) => f.name),
      ]
      expect(texts.join(' | ')).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
      // 訳されているのであって、空になっているのではない
      expect(String(options.title ?? '').length).toBeGreaterThan(0)
    }
  })

  it('locale=ja では日本語のタイトルになる', async () => {
    h.settings = defaultSettings({ locale: 'ja' })
    await call('chooseIso')
    expect(String(h.dialogs[0]!.title)).toMatch(/[ぁ-んァ-ヶ一-龠]/u)
  })
})

describe('書き出す README は生成物のコメント言語に従う', () => {
  it('commentLanguage=en なら英語で書き出される', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-en-'))
    h.settings = defaultSettings({ locale: 'ja', commentLanguage: 'en' })
    h.openDialogResult = { canceled: false, filePaths: [dir] }
    await call('exportBundle', createDefaultProfile())
    const readme = readFileSync(join(dir, 'README.txt'), 'utf8')
    expect(readme).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
    expect(readme).toContain('Autoinstall USB Creator 0.1.0')
  })

  it("commentLanguage='none' のときは UI の言語に落とす（README は誰かが読む）", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-none-'))
    h.settings = defaultSettings({ locale: 'en', commentLanguage: 'none' })
    h.openDialogResult = { canceled: false, filePaths: [dir] }
    await call('exportBundle', createDefaultProfile())
    expect(readFileSync(join(dir, 'README.txt'), 'utf8')).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
  })
})
