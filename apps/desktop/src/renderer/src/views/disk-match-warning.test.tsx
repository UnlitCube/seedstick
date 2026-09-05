// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultProfile, createTranslator, type DiskMatch } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { StorageStep } from './StorageStep.js'
import { Callout } from '../components/ui.js'

// ---------------------------------------------------------------------------
// **危険な設定ほど強い助言を出す**（落とし穴 65）。
//
// `match: {}`（どのディスクでもよい）は、複数ディスク機で「どれが消えるか
// 分からない」この画面で最も危険な指定。それなのに、より安全な
// largest / smallest / ssd にだけ注意書き（`storage.usbExcluded`）があり、
// `any` を選んだときだけ無言だった。検証（`validate.diskMatchAny`）は出るが、
// それが見えるのは確認画面まで進んだあとで、しかも
// 「実行時にディスクを決める」設定では出ない。
//
// **文面は固定しない**（落とし穴 56）。ここで固定するのは
//
//   - 出る／出ないの組み合わせ
//   - `any` に出るのが `tone="warning"`（注意）であって
//     `tone="info"`（補足）ではないこと
//
// の 2 つ。tone は `Callout` を直接描いた結果と突き合わせて判定するので、
// 配色を変えただけでこのテストが落ちることはない。
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')

const mounted: { host: HTMLElement; root: Root }[] = []

beforeEach(() => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = {
    generateConfig: async () => null,
  }
})

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    m.host.remove()
  }
})

function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  act(() => root.render(node))
  return host
}

/**
 * tone ごとの `Callout` の見た目を、**`Callout` 自身を描いて**採る。
 * クラス名を直接書くと、配色を変えただけでこのテストが落ちる（落とし穴 56）。
 */
const TONES = ['info', 'warning', 'danger', 'success'] as const
type Tone = (typeof TONES)[number]

let toneClasses: Map<string, Tone> | null = null

function toneClassMap(): Map<string, Tone> {
  if (toneClasses) return toneClasses
  const map = new Map<string, Tone>()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  for (const tone of TONES) {
    act(() => root.render(<Callout tone={tone}>x</Callout>))
    map.set((host.firstElementChild as HTMLElement).className, tone)
  }
  act(() => root.unmount())
  host.remove()
  toneClasses = map
  return map
}

/** その文言を持つ `Callout` の tone。無ければ null。 */
function calloutTone(host: HTMLElement, text: string): Tone | null {
  const map = toneClassMap()
  for (const el of host.querySelectorAll<HTMLElement>('div')) {
    const tone = map.get(el.className)
    if (tone !== undefined && (el.textContent ?? '').includes(text)) return tone
  }
  return null
}

function render(match: DiskMatch): HTMLElement {
  const profile = createDefaultProfile('24.04')
  if (profile.storage.mode === 'raw') throw new Error('既定が raw になっている')
  useStore.setState({
    locale: 'ja',
    profile: { ...profile, storage: { ...profile.storage, match } },
  })
  return mount(<StorageStep />)
}

const ANY = t('validate.diskMatchAny')
const EXCLUDED = t('storage.usbExcluded')

describe('DiskMatchPicker の助言', () => {
  it('前提: tone ごとに見た目が違う（判定が成立している）', () => {
    // 4 tone が同じクラスになると、下の tone の検証が素通りする。
    expect(toneClassMap().size).toBe(TONES.length)
  })

  it('「どのディスクでもよい」を選ぶと注意が出る', () => {
    const host = render({ kind: 'any' })
    expect(calloutTone(host, ANY), '最も危険な指定なのに無言').toBe('warning')
  })

  it('「どのディスクでもよい」には USB を除く旨の補足は出ない（実際に除かれない）', () => {
    // largest / smallest / ssd は USB を候補から外すが、`any` は外さない。
    // 同じ補足をここに出すと、嘘の安心を与えることになる。
    const host = render({ kind: 'any' })
    expect(calloutTone(host, EXCLUDED)).toBeNull()
  })

  for (const kind of ['largest', 'smallest', 'ssd'] as const) {
    it(`${kind} には USB を除く補足だけが出る（危険側の注意は出さない）`, () => {
      const host = render({ kind })
      expect(calloutTone(host, EXCLUDED), `${kind} に補足が無い`).toBe('info')
      expect(calloutTone(host, ANY), `${kind} に「どのディスクでもよい」の注意が出ている`).toBeNull()
    })
  }

  for (const match of [
    { kind: 'serial', serial: 'ABC123' },
    { kind: 'path', path: '/dev/nvme0n1' },
    { kind: 'model', model: 'Samsung SSD*' },
  ] as const) {
    it(`${match.kind} はディスクを名指しするので、どちらも出ない`, () => {
      const host = render(match)
      expect(calloutTone(host, ANY), `${match.kind} に不要な注意`).toBeNull()
      expect(calloutTone(host, EXCLUDED), `${match.kind} に不要な補足`).toBeNull()
    })
  }

  it('選び直すと助言も入れ替わる（初期描画だけの見せかけにしない）', () => {
    const host = render({ kind: 'largest' })
    expect(calloutTone(host, EXCLUDED)).toBe('info')

    const select = host.querySelector('select') as HTMLSelectElement
    expect(select, 'ディスクの指定が表に出ていない').not.toBeNull()
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    act(() => {
      setter!.call(select, 'any')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(useStore.getState().profile.storage).toMatchObject({ match: { kind: 'any' } })
    expect(calloutTone(host, ANY)).toBe('warning')
    expect(calloutTone(host, EXCLUDED)).toBeNull()
  })
})
