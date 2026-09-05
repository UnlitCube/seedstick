// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultProfile, createTranslator, type StorageConfig } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { StorageStep, countStorageDetailChanges } from './StorageStep.js'

// ---------------------------------------------------------------------------
// ディスクのステップを 2 階層に割った。ここで固定するのは 4 つ。
//
//   1. **表に出るもの**（どのディスクに入れるか・構成方法）が折りたたみの中に
//      落ちていないこと。`match` は「どのディスクが消えるか」を決める設定で、
//      たたんだまま気づけないのは取り返しがつかない（落とし穴 65）
//   2. 折りたたみに入れた設定が、**開けば今までどおり操作できる**こと
//      （落とし穴 61 / 66。しまうことと触れなくすることは違う）
//   3. 既定から変わっていれば**最初から開いている**こと
//   4. `changedCount` が正しいこと。**読めない形のときは 0 と偽らない**
//      （落とし穴 50。0 を出すと「既定のまま」に見え、設定が消えたことに気づけない）
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')
const DEFAULTS = createDefaultProfile('24.04').storage

/**
 * 構造化モードの既定に差分を重ねる（判別子ごとに作るので `raw` は混ざらない）。
 *
 * `Extract<StorageConfig, { mode: 'lvm' }>` は `never` になる
 * （構造化側のメンバーの `mode` は `'lvm' | 'direct' | 'zfs'` なので `{mode:'lvm'}` に
 * 代入できない）。`raw` を除く形で書く。
 */
function structured(over: Partial<Exclude<StorageConfig, { mode: 'raw' }>> = {}): StorageConfig {
  if (DEFAULTS.mode === 'raw') throw new Error('既定が raw になっている')
  return { ...DEFAULTS, ...over }
}

const mounted: { host: HTMLElement; root: Root }[] = []

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    m.host.remove()
  }
})

/** 本物の描画を通す（React の state を直接いじらない）。 */
function render(storage: StorageConfig, series: '22.04' | '24.04' = '24.04'): HTMLElement {
  useStore.setState({
    locale: 'ja',
    profile: { ...createDefaultProfile(series), storage },
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  act(() => root.render(<StorageStep />))
  return host
}

const storageOf = (): StorageConfig => useStore.getState().profile.storage

/** 「詳しい設定」の開閉ボタン。 */
function toggle(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) => b.hasAttribute('aria-expanded'))
  expect(button, '折りたたみの開閉ボタンが無い').toBeTruthy()
  return button as HTMLButtonElement
}

const isOpen = (host: HTMLElement): boolean => toggle(host).getAttribute('aria-expanded') === 'true'

const click = (el: HTMLElement): void => {
  act(() => {
    el.click()
  })
}

/**
 * ラベルの文言から入力欄を引く。
 * `Field` は `<label for>`、`Switch` / `RadioGroup` は `<label>` が入力を包む。
 */
function byLabel(host: HTMLElement, label: string): HTMLElement | null {
  for (const el of host.querySelectorAll('label')) {
    if (!el.textContent?.includes(label)) continue
    const forId = el.getAttribute('for')
    // 同じ id が別の host にも居る事故を避けるため、必ず host の中から引く。
    const target = forId ? host.querySelector(`[id="${forId}"]`) : el.querySelector('input')
    if (target) return target as HTMLElement
  }
  return null
}

/**
 * React が張り替えた `value` のセッターを迂回して値を入れる。
 * `el.value = x` だと React の value tracker が「変化なし」と見なして
 * `onChange` を呼ばない（テストだけが静かに何も起きない）。
 */
function setValue(el: HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

describe('StorageStep の階層', () => {
  it('どのディスクに入れるかと構成方法は、折りたたみの外に出ている（落とし穴 65）', () => {
    const host = render(structured())
    expect(isOpen(host), '既定のままなら折りたたみは閉じている').toBe(false)

    // 折りたたみが閉じたままでも、構成方法の 4 択とディスクの指定は見えている。
    for (const key of ['storage.layoutLvm', 'storage.layoutDirect', 'storage.layoutZfs', 'storage.layoutRaw'] as const) {
      expect(byLabel(host, t(key)), `${key} が表に出ていない`).not.toBeNull()
    }
    const selects = [...host.querySelectorAll('select')]
    expect(selects, 'ディスクの指定が表に出ていない').toHaveLength(1)
    expect([...selects[0]!.options].map((o) => o.value)).toContain('serial')
  })

  it('折りたたみに入れた設定は、開けば今までどおり操作できる（落とし穴 61）', () => {
    const host = render(structured())
    expect(byLabel(host, t('adv.swapTitle')), '閉じている間は中身を描画しない').toBeNull()

    click(toggle(host))
    expect(isOpen(host)).toBe(true)

    const swap = byLabel(host, t('adv.swapTitle')) as HTMLSelectElement
    expect(swap).not.toBeNull()
    setValue(swap, 'none')
    expect(storageOf()).toMatchObject({ swap: { mode: 'none' } })

    const whole = byLabel(host, t('storage.wholeDisk')) as HTMLInputElement
    click(whole)
    expect(storageOf()).toMatchObject({ useWholeDisk: true })

    const reset = byLabel(host, t('adv.resetPartition')) as HTMLInputElement
    click(reset)
    expect(storageOf()).toMatchObject({ resetPartition: { enabled: true } })

    // 暗号化は「入れる」も「解除する」も折りたたみの中でできること（落とし穴 66）。
    const encrypt = byLabel(host, t('storage.encrypt')) as HTMLInputElement
    click(encrypt)
    expect(storageOf()).toMatchObject({ encryptionPassphrase: 'change-me-please' })
    click(byLabel(host, t('storage.encrypt')) as HTMLInputElement)
    expect(storageOf()).toMatchObject({ encryptionPassphrase: '' })

    const table = byLabel(host, t('storage.partitionTable')) as HTMLSelectElement
    setValue(table, 'msdos')
    expect(storageOf()).toMatchObject({ partitionTable: 'msdos' })
  })

  it('既定から変わっていれば最初から開き、件数を出す（保存済みプロファイルを開いたとき）', () => {
    const host = render(
      structured({ partitionTable: 'gpt', resetPartition: { enabled: true, size: '' } }),
    )
    expect(isOpen(host), '設定したはずのものが隠れていると「消えた」と誤解される').toBe(true)
    expect(host.textContent).toContain(t('nav.changedCount', { n: 2 }))
    expect(byLabel(host, t('adv.resetPartition'))).not.toBeNull()
  })

  it('生の curtin を書いているときは、編集欄が開いた状態で出る', () => {
    // yaml が空でも開くこと（件数 0 でも「使っている」ことに変わりはない）。
    const host = render({ mode: 'raw', yaml: '' })
    expect(isOpen(host)).toBe(true)
    const editor = byLabel(host, t('storage.rawTitle')) as HTMLTextAreaElement
    expect(editor).not.toBeNull()
    setValue(editor, 'config: []')
    expect(storageOf()).toEqual({ mode: 'raw', yaml: 'config: []' })

    // モードの選択は表に残っている（折りたたみで関係を分断しない）。
    const raw = byLabel(host, t('storage.layoutRaw')) as HTMLInputElement
    expect(raw.checked).toBe(true)
    // 構造化モードの設定は raw では使われないので、そのことを画面に出す。
    expect(host.textContent).toContain(t('storage.detailsRawActive'))
  })

  it('折りたたみを閉じたあとに curtin へ切り替えても、編集欄が隠れない', () => {
    const host = render(structured({ partitionTable: 'gpt' }))
    expect(isOpen(host)).toBe(true)
    click(toggle(host))
    expect(isOpen(host)).toBe(false)

    // 件数は 1 のままなので「0 → 1 で開く」効果は働かない。ここが隠れると、
    // 「curtin を直接書く」を選んだのに編集欄がどこにも無い状態になる。
    click(byLabel(host, t('storage.layoutRaw')) as HTMLInputElement)
    expect(storageOf().mode).toBe('raw')
    expect(isOpen(host)).toBe(true)
    expect(byLabel(host, t('storage.rawTitle'))).not.toBeNull()
  })

  it('LVM 以外へ移すとパスフレーズを消す（折りたたみで解除できなくしない。落とし穴 66）', () => {
    const host = render(structured({ encryptionPassphrase: 'hunter22' }))
    expect(isOpen(host)).toBe(true)
    click(byLabel(host, t('storage.layoutDirect')) as HTMLInputElement)
    expect(storageOf()).toMatchObject({ mode: 'direct', encryptionPassphrase: '' })
  })

  it('件数を数えられない形なら、閉じずに開いて中を見せる（0 と偽らない。落とし穴 50）', () => {
    // 手で編集されたプロファイル。型は合っているように見えるが中身が違う（落とし穴 23）。
    const broken = { ...structured(), useWholeDisk: 'yes' } as unknown as StorageConfig
    const host = render(broken)
    expect(isOpen(host)).toBe(true)
    expect(host.textContent, '数えられていないのに件数を出さない').not.toContain(
      t('nav.changedCount', { n: 0 }),
    )
  })
})

describe('countStorageDetailChanges', () => {
  it('既定のままなら 0', () => {
    expect(countStorageDetailChanges(structured(), DEFAULTS)).toBe(0)
  })

  it('折りたたみの中の設定を 1 つずつ数える', () => {
    expect(countStorageDetailChanges(structured({ useWholeDisk: true }), DEFAULTS)).toBe(1)
    expect(countStorageDetailChanges(structured({ encryptionPassphrase: 'x' }), DEFAULTS)).toBe(1)
    expect(
      countStorageDetailChanges(structured({ swap: { mode: 'none', size: '' } }), DEFAULTS),
    ).toBe(1)
    expect(countStorageDetailChanges(structured({ partitionTable: 'msdos' }), DEFAULTS)).toBe(1)
    expect(
      countStorageDetailChanges(
        structured({ resetPartition: { enabled: true, size: '12G' } }),
        DEFAULTS,
      ),
    ).toBe(1)
    expect(
      countStorageDetailChanges(
        structured({
          useWholeDisk: true,
          encryptionPassphrase: 'x',
          partitionTable: 'gpt',
        }),
        DEFAULTS,
      ),
    ).toBe(3)
  })

  it('表に出している設定（ディスクの指定・構成方法）は数えない', () => {
    // 数えると「N 件変更」に釣られて開いても、中には何も変わったものが無い。
    expect(
      countStorageDetailChanges(structured({ match: { kind: 'serial', serial: 'ABC' } }), DEFAULTS),
    ).toBe(0)
    expect(countStorageDetailChanges(structured({ mode: 'zfs' }), DEFAULTS)).toBe(0)
  })

  it('パスフレーズの打ち直しでは増えない（設定は「暗号化するかどうか」の 1 つ）', () => {
    expect(
      countStorageDetailChanges(structured({ encryptionPassphrase: 'hunter22' }), DEFAULTS),
    ).toBe(1)
  })

  it('生の curtin は、中身が入っていれば 1 件', () => {
    expect(countStorageDetailChanges({ mode: 'raw', yaml: 'config: []' }, DEFAULTS)).toBe(1)
    expect(countStorageDetailChanges({ mode: 'raw', yaml: '  \n' }, DEFAULTS)).toBe(0)
  })

  it('読めない形なら undefined（嘘の 0 を出さない）', () => {
    const broken = (over: Record<string, unknown>): StorageConfig =>
      ({ ...structured(), ...over }) as unknown as StorageConfig
    expect(countStorageDetailChanges(broken({ mode: 'NOPE' }), DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges(broken({ useWholeDisk: 'yes' }), DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges(broken({ swap: null }), DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges(broken({ swap: ['none'] }), DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges(broken({ resetPartition: {} }), DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges(broken({ partitionTable: 42 }), DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges(broken({ encryptionPassphrase: null }), DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges({ mode: 'raw' } as unknown as StorageConfig, DEFAULTS)).toBeUndefined()
    expect(countStorageDetailChanges(null as unknown as StorageConfig, DEFAULTS)).toBeUndefined()
  })
})
