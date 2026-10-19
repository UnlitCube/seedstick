import { afterAll, describe, expect, it, vi } from 'vitest'
import { cleanupTempDirs, makeTempDir } from './test-support/temp-files.js'
import {
  createDefaultProfile,
  formatLocalized,
  validateProfile,
  type AppSettings,
  type AutoinstallProfile,
  type GeneratedConfig,
} from '@autoinstall/shared'

// `generateConfig` の catch の回帰テスト。
//
// 以前はここで作った 1 件だけを issues にしていたため、
//  1. 英語の画面に「Could not generate the configuration: 上書き YAML の構文エラー: ...」
//     という半分日本語の行が出て、
//  2. しかもそれが **issues の全部**（他の検証結果は捨てられていた）。
//
// ipc.test.ts と混ざらないよう、必要な mock だけを持つ独立したファイルにしている。

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  settings: {
    locale: 'en',
    lastIsoDirectory: null,
    verifyAfterWrite: false,
    cidataSizeBytes: 64 * 1024 * 1024,
    auditRecord: false,
    commentLanguage: 'ja',
  } as AppSettings,
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown): void => {
      h.handlers.set(channel, fn)
    },
  },
  BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [{}] },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' }),
  },
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  app: {
    getName: () => 'Seedstick',
    getVersion: () => '0.1.0',
    getLocale: () => 'en-US',
    getPath: () => makeTempDir('generate-error-test-'),
  },
}))

vi.mock('./settings.js', () => ({
  getSettings: () => Promise.resolve(h.settings),
  saveSettings: (next: AppSettings) => {
    h.settings = next
    return Promise.resolve(next)
  },
}))

const { registerIpc } = await import('./ipc.js')

registerIpc()

function generateConfig(profile: AutoinstallProfile): Promise<GeneratedConfig> {
  const fn = h.handlers.get('generateConfig')
  if (!fn) throw new Error('ハンドラがない: generateConfig')
  return Promise.resolve(fn(...([{}, profile] as never[]))) as Promise<GeneratedConfig>
}

const HIRAGANA_KATAKANA_KANJI = /[\u3041-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/
const FULLWIDTH_PUNCTUATION = /[\u3000-\u303F\uFF00-\uFFEF]/

const HASH =
  '$6$saltsalt$.XeWDrCjouuYgs/UGMlCRi7DbQGo.D1eElJrsOdTTiB3cMADnjs1koQGbOqnqfjNvuX4oBtad6mDPQUgJiwjZ1'

/** 生成が落ちる（壊れた上書き YAML）うえに、別の検証エラーも持つプロファイル。 */
function brokenProfile(): AutoinstallProfile {
  const p = createDefaultProfile('24.04')
  return {
    ...p,
    basics: { ...p.basics, hostname: 'h1' },
    user: { ...p.user, username: 'opsuser', passwordHash: HASH },
    // 生成を止める
    advanced: { ...p.advanced, rawOverlayYaml: 'a:\n  - b\n c: [' },
    // 生成とは無関係な検証エラー（NIC 名が空）
    network: { mode: 'dhcp', target: { kind: 'name', name: '' }, optional: true },
  }
}

describe('generateConfig が生成に失敗したとき', () => {
  it('English の画面に日本語が 1 文字も出ない', async () => {
    const config = await generateConfig(brokenProfile())
    expect(config.ok).toBe(false)
    expect(config.issues.length).toBeGreaterThan(0)
    for (const i of config.issues) {
      // 指摘は辞書のキーで運ばれてくる。画面に出るのは訳したあとの文字列なので、
      // 見るのもそちら（`text` を en で訳した結果）。
      const en = formatLocalized('en', i.text)
      expect(HIRAGANA_KATAKANA_KANJI.test(en), `en の総括に日本語が残っている: ${en}`).toBe(false)
      expect(
        FULLWIDTH_PUNCTUATION.test(en),
        `en の総括に全角の約物が残っている: ${en}`,
      ).toBe(false)
    }
  })

  it('他の検証結果を捨てない', async () => {
    const p = brokenProfile()
    const fields = (await generateConfig(p)).issues.map((i) => i.field)
    // 生成の指摘
    expect(fields).toContain('advanced.rawOverlayYaml')
    // 生成とは無関係な指摘も残っている
    expect(fields).toContain('network.target')
    // 検証が単体で出す指摘は 1 件も落ちていない
    for (const i of validateProfile(p).issues) expect(fields).toContain(i.field)
  })

  it('同じ指摘を 2 件に増やさない', async () => {
    const issues = (await generateConfig(brokenProfile())).issues
    const overlay = issues.filter((i) => i.field === 'advanced.rawOverlayYaml')
    expect(overlay).toHaveLength(1)
  })
})

afterAll(() => {
  cleanupTempDirs()
})
