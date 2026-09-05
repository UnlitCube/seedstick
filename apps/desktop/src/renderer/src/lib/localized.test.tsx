// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createTranslator,
  localized,
  type DeviceInfo,
  type Locale,
  type WriteStatus,
} from '@autoinstall/shared'
import { formatMaybeLocalized, useTl } from './i18n.js'
import { useStore } from '../store.js'
import { WriteStep } from '../views/WriteStep.js'
import { IsoStep } from '../views/IsoStep.js'

// ---------------------------------------------------------------------------
// main / media から届く文言は `LocalizedText`（キー + 差し込み値）で、訳すのは
// renderer だけの仕事になった。ここが抜けると 2 通りの壊れ方をする。
//
//   1. オブジェクトを JSX に置く → React が描画中に投げ、画面が Error Boundary に落ちる
//   2. 文字列に連結する         → `[object Object]` が画面に出る
//
// どちらも「英語にしても日本語のまま」より悪い。描画まで通して固定する。
// ---------------------------------------------------------------------------

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

/** 本物の描画を通す（React の state を直接いじらない）。 */
function render(node: React.ReactNode, locale: Locale = 'ja'): HTMLElement {
  useStore.setState({ locale })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

const text = (el: HTMLElement): string => el.textContent ?? ''

/** 画面のどこにも「訳し損ね」が出ていないこと。 */
function expectNoRawObject(el: HTMLElement): void {
  expect(text(el)).not.toContain('[object Object]')
  expect(text(el)).not.toContain('{"key"')
}

const ja = createTranslator('ja')
const en = createTranslator('en')

const device = (over: Partial<DeviceInfo>): DeviceInfo => ({
  id: '\\\\.\\PhysicalDrive9',
  description: 'TEST DISK',
  sizeBytes: 32_000_000_000,
  bus: 'USB',
  removable: true,
  isSystem: false,
  mountpoints: [],
  serial: null,
  selectable: true,
  blockedReason: null,
  ...over,
})

// ---------------------------------------------------------------------------
// 1. formatMaybeLocalized — 壊れた形でも投げない（落とし穴 60）
// ---------------------------------------------------------------------------

describe('formatMaybeLocalized', () => {
  it('キーと差し込み値をその言語で訳す', () => {
    const t = localized('device.blockedTooSmall', { min: '4.0 GB' })
    expect(formatMaybeLocalized('ja', t)).toBe(ja('device.blockedTooSmall', { min: '4.0 GB' }))
    expect(formatMaybeLocalized('en', t)).toBe(en('device.blockedTooSmall', { min: '4.0 GB' }))
    expect(formatMaybeLocalized('ja', t)).not.toBe(formatMaybeLocalized('en', t))
    // 差し込みが実際に効いている（テンプレートのまま出していない）
    expect(formatMaybeLocalized('en', t)).toContain('4.0 GB')
    expect(formatMaybeLocalized('en', t)).not.toContain('{min}')
  })

  it('差し込みの無いキーも訳せる', () => {
    expect(formatMaybeLocalized('en', localized('device.blockedSystemDisk'))).toBe(
      en('device.blockedSystemDisk'),
    )
  })

  it('IPC / NDJSON を JSON で往復しても同じ文になる', () => {
    const t = localized('write.errorWorkerExited', { code: 3 })
    const round = JSON.parse(JSON.stringify(t)) as typeof t
    expect(round).toEqual(t)
    expect(formatMaybeLocalized('ja', round)).toBe(formatMaybeLocalized('ja', t))
    expect(formatMaybeLocalized('ja', round)).toContain('3')
  })

  it('生の文字列はそのまま出す（古いワーカーからの退避路）', () => {
    // 昇格ワーカーは別プロセスなので、アプリを更新しても走っている実体は古いままでいられる。
    // そのとき NDJSON で届くのは以前どおりの日本語の string になる。
    expect(formatMaybeLocalized('en', '書き込みを準備しています')).toBe('書き込みを準備しています')
  })

  it('null / undefined は空文字（描くものが無い）', () => {
    expect(formatMaybeLocalized('ja', null)).toBe('')
    expect(formatMaybeLocalized('ja', undefined)).toBe('')
  })

  it('壊れた形が来ても投げない', () => {
    const broken: unknown[] = [
      {}, // key が無い
      { key: 5 }, // key が文字列でない
      { key: '' }, // 空のキー
      { key: null },
      [], // 配列
      42,
      true,
    ]
    for (const b of broken) {
      expect(() => formatMaybeLocalized('ja', b as never)).not.toThrow()
      expect(formatMaybeLocalized('ja', b as never)).toBe('')
    }
  })

  it('params が null や配列でも投げない（ここが実際の crash 経路）', () => {
    // `interpolate` は `params !== undefined` なら添字を引くので、`null` を素通しすると
    // 描画のまっただ中で TypeError になる。Error Boundary の中で**もう一度**落ちる形。
    const withNull = { key: 'device.blockedTooSmall', params: null } as never
    expect(() => formatMaybeLocalized('ja', withNull)).not.toThrow()
    // 値を渡せていないことは `{min}` が残ることで分かる（黙って消さない）
    expect(formatMaybeLocalized('ja', withNull)).toContain('{min}')

    const withArray = { key: 'device.blockedTooSmall', params: ['4.0 GB'] } as never
    expect(() => formatMaybeLocalized('ja', withArray)).not.toThrow()
    expect(formatMaybeLocalized('ja', withArray)).toContain('{min}')
  })
})

describe('useTl', () => {
  it('ストアのロケールを購読する', () => {
    function Probe(): React.JSX.Element {
      const tl = useTl()
      return <span>{tl(localized('device.blockedSystemDisk'))}</span>
    }
    expect(text(render(<Probe />, 'ja'))).toBe(ja('device.blockedSystemDisk'))
    if (root) act(() => root!.unmount())
    host?.remove()
    expect(text(render(<Probe />, 'en'))).toBe(en('device.blockedSystemDisk'))
  })
})

// ---------------------------------------------------------------------------
// 2. 実際の描画箇所（IPC の LocalizedText が画面に出るところ全部）
// ---------------------------------------------------------------------------

describe('WriteStep が LocalizedText を訳して描く', () => {
  it('選べないデバイスの理由バッジ', () => {
    useStore.setState({
      devices: [
        device({
          id: '\\\\.\\PhysicalDrive0',
          selectable: false,
          blockedReason: localized('device.blockedSystemDisk'),
        }),
      ],
      devicesBusy: false,
      writeStatus: { state: 'idle' },
    })
    const el = render(<WriteStep />, 'en')
    expect(text(el)).toContain(en('device.blockedSystemDisk'))
    expect(text(el)).not.toContain(ja('device.blockedSystemDisk'))
    expectNoRawObject(el)
  })

  it('理由に差し込み値があっても展開される', () => {
    useStore.setState({
      devices: [
        device({
          selectable: false,
          blockedReason: localized('device.blockedTooSmall', { min: '4.0 GB' }),
        }),
      ],
      devicesBusy: false,
      writeStatus: { state: 'idle' },
    })
    const el = render(<WriteStep />, 'en')
    expect(text(el)).toContain('4.0 GB')
    expect(text(el)).not.toContain('{min}')
    expectNoRawObject(el)
  })

  it('準備中の状態', () => {
    useStore.setState({
      devices: [],
      devicesBusy: false,
      writeStatus: { state: 'preparing', message: localized('write.statusWaitingElevation') },
    })
    const el = render(<WriteStep />, 'en')
    expect(text(el)).toContain(en('write.statusWaitingElevation'))
    expectNoRawObject(el)
  })

  it('書き込み中の進捗ラベル', () => {
    useStore.setState({
      devices: [],
      devicesBusy: false,
      writeStatus: {
        state: 'writing',
        phase: 'writing',
        bytesDone: 1_000,
        bytesTotal: 10_000,
        label: localized('writeOp.isoBody'),
        bytesPerSecond: null,
        etaSeconds: null,
      },
    })
    const el = render(<WriteStep />, 'en')
    expect(text(el)).toContain(en('writeOp.isoBody'))
    expect(text(el)).not.toContain(ja('writeOp.isoBody'))
    expectNoRawObject(el)
  })

  it('失敗の総括文は訳し、生の詳細はそのまま出す', () => {
    useStore.setState({
      devices: [],
      devicesBusy: false,
      writeStatus: {
        state: 'error',
        message: localized('write.errorWorkerExited', { code: 7 }),
        detail: 'Error: 内部の生の診断\n  at worker.ts:1:1',
      },
    })
    const el = render(<WriteStep />, 'en')
    expect(text(el)).toContain(en('write.errorWorkerExited', { code: 7 }))
    // detail は開発者向けなので訳さない（そのまま出る）
    expect(text(el)).toContain('Error: 内部の生の診断')
    expectNoRawObject(el)
  })

  it('文言が壊れて届いても描画は落ちない（落とし穴 60）', () => {
    useStore.setState({
      devices: [
        device({
          selectable: false,
          // 古い形・壊れた形の両方
          blockedReason: { key: 'device.blockedTooSmall', params: null } as never,
        }),
      ],
      devicesBusy: false,
      writeStatus: {
        state: 'error',
        message: {} as never,
        detail: null,
      },
    })
    const el = render(<WriteStep />, 'en')
    // 総括が空になっても、失敗したことは伝わる
    expect(text(el)).toContain(en('write.failed'))
    expect(text(el)).toContain(en('error.unknown'))
    expectNoRawObject(el)
  })

  it('古いワーカーが生の文字列を送ってきても出せる', () => {
    useStore.setState({
      devices: [],
      devicesBusy: false,
      writeStatus: {
        state: 'writing',
        phase: 'writing',
        bytesDone: 0,
        bytesTotal: 10,
        label: 'ISO イメージ本体',
        bytesPerSecond: null,
        etaSeconds: null,
      } as unknown as WriteStatus,
    })
    const el = render(<WriteStep />, 'en')
    expect(text(el)).toContain('ISO イメージ本体')
    expectNoRawObject(el)
  })
})

describe('IsoStep が拒否理由を訳して描く', () => {
  it('総括文は訳し、詳細があれば等幅で添える', () => {
    useStore.setState({
      iso: null,
      isoBusy: false,
      checksum: null,
      checksumProgress: null,
      isoError: {
        text: localized('iso.notServer', { volumeId: 'Ubuntu 24.04.3 LTS amd64' }),
        detail: 'PVD offset 0x8000',
      },
    })
    const el = render(<IsoStep />, 'en')
    expect(text(el)).toContain(en('iso.notServer', { volumeId: 'Ubuntu 24.04.3 LTS amd64' }))
    expect(text(el)).not.toContain(ja('iso.notServer', { volumeId: 'Ubuntu 24.04.3 LTS amd64' }))
    expect(text(el)).toContain('PVD offset 0x8000')
    expectNoRawObject(el)
  })

  it('detail が無い通常の拒否でも本文が空にならない', () => {
    // `IsoOpenResult.detail` が「開発者向けの詳細」に変わったとき、
    // 本文にそちらを出していると通常の拒否は全部 null なので**空の Callout** になる。
    // 型は通るので typecheck では捕まらない。
    useStore.setState({
      iso: null,
      isoBusy: false,
      checksum: null,
      checksumProgress: null,
      isoError: { text: localized('iso.rejectNotAFile'), detail: null },
    })
    const el = render(<IsoStep />, 'en')
    expect(text(el)).toContain(en('iso.rejectNotAFile'))
    expectNoRawObject(el)
  })
})
