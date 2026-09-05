import { describe, expect, it, beforeEach } from 'vitest'
import { vi } from 'vitest'
import { ja, en, type Locale } from '@autoinstall/shared'

// 書き込み中に閉じようとしたときの確認は **OS ネイティブのダイアログ**で、
// renderer を通らない。LocalizedText では届かないので、ここだけは main が訳す。
// 訳し忘れると「English にしたのにこのダイアログだけ日本語」になる（実際にそうだった）。

const state = vi.hoisted(() => ({
  locale: 'ja' as Locale,
  /** dialog.showMessageBox に渡された options */
  options: null as Record<string, unknown> | null,
  /** ユーザーが押したボタンの番号 */
  response: 0,
}))

vi.mock('electron', () => ({
  app: {
    setAppUserModelId: () => undefined,
    // ここで false を返すと index.ts が app.quit() だけして何も登録しない
    requestSingleInstanceLock: () => true,
    on: () => undefined,
    // resolve させない。createWindow() を走らせずに済む
    whenReady: () => new Promise<void>(() => undefined),
    quit: () => undefined,
    exit: () => undefined,
    getPath: () => '',
    getLocale: () => 'ja-JP',
  },
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return []
    }
  },
  dialog: {
    showMessageBox: (_win: unknown, options: Record<string, unknown>) => {
      state.options = options
      return Promise.resolve({ response: state.response, checkboxChecked: false })
    },
  },
  shell: {},
}))

vi.mock('./ipc.js', () => ({
  registerIpc: () => undefined,
  disposeIpc: () => undefined,
  isWriteInProgress: () => true,
  shutdownWrite: async () => undefined,
}))

// 設定はいつでも変えられる。控えた値ではなく、出すたびに読むことを確かめたい。
vi.mock('./settings.js', () => ({
  getSettings: async () => ({ locale: state.locale }),
}))

const { askWhileWriting } = await import('./index.js')

beforeEach(() => {
  state.options = null
  state.response = 0
})

/** ダイアログに出た文字列すべて */
function shown(): string[] {
  const o = state.options ?? {}
  return [
    ...((o['buttons'] as string[] | undefined) ?? []),
    String(o['title'] ?? ''),
    String(o['message'] ?? ''),
    String(o['detail'] ?? ''),
  ]
}

describe('終了確認ダイアログの文言', () => {
  it('日本語の設定では日本語で出る', async () => {
    state.locale = 'ja'
    await askWhileWriting(null)
    expect(state.options?.['buttons']).toEqual([ja['write.quitContinue'], ja['write.quitAbort']])
    expect(state.options?.['title']).toBe(ja['write.quitTitle'])
    expect(state.options?.['message']).toBe(ja['write.quitMessage'])
    expect(state.options?.['detail']).toBe(ja['write.quitDetail'])
  })

  it('English の設定では英語で出る（ハードコードが残っていれば落ちる）', async () => {
    state.locale = 'en'
    await askWhileWriting(null)
    expect(state.options?.['buttons']).toEqual([en['write.quitContinue'], en['write.quitAbort']])
    expect(state.options?.['title']).toBe(en['write.quitTitle'])
    expect(state.options?.['message']).toBe(en['write.quitMessage'])
    expect(state.options?.['detail']).toBe(en['write.quitDetail'])
    // 文面ではなく「日本語が 1 文字も無いこと」でも押さえる。
    // 訳を足し忘れた新しい行が混ざっても気づける。
    for (const s of shown()) expect(s).not.toMatch(/[぀-ヿ㐀-鿿]/)
  })

  it('設定を切り替えたら次の 1 回から反映される（控えた値を使っていない）', async () => {
    state.locale = 'ja'
    await askWhileWriting(null)
    expect(state.options?.['title']).toBe(ja['write.quitTitle'])
    state.locale = 'en'
    await askWhileWriting(null)
    expect(state.options?.['title']).toBe(en['write.quitTitle'])
  })

  it('既定は「書き込みを続ける」で、押した答えを取り違えない', async () => {
    state.locale = 'ja'
    state.response = 0
    expect(await askWhileWriting(null)).toBe('continue')
    // 既定ボタンもキャンセル扱いのボタンも 0 番＝続ける。誤って閉じても書き込みは続く。
    expect(state.options?.['defaultId']).toBe(0)
    expect(state.options?.['cancelId']).toBe(0)
    state.response = 1
    expect(await askWhileWriting(null)).toBe('abort')
  })
})
