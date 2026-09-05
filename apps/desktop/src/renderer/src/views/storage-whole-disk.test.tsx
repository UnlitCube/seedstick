// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createDefaultProfile,
  createTranslator,
  formatLocalized,
  ja,
  type AutoinstallProfile,
  type StorageConfig,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { StorageStep, countStorageDetailChanges } from './StorageStep.js'
import { summarizeStep } from '../lib/summary.js'

// ---------------------------------------------------------------------------
// **`useWholeDisk` は LVM にしか無い設定**（`sizing-policy` は lvm レイアウトにしか
// 出ない。`generate.ts`）。スイッチも LVM のときしか描画されない。
//
// LVM で有効にしてから「そのまま」へ移ると、値が残るせいで
//
//   - 折りたたみに「1 件変更」の Badge が出るのに、開いても変えた覚えのある設定が無い
//   - サイドバーの要約は「ディスク全体を使う」と言うのに、解除する操作が画面に無い
//
// になる（落とし穴 61 / 66）。**同じ壊れ方が 3 か所にある**ので、
// 3 か所すべてを見る。1 か所だけ直しても他が残る形だからで、
// ここを 1 つのテストにまとめておかないと、次に触った人が片方だけ戻せる。
//
//   1. `changeMode`（`StorageStep.tsx`）           — 値そのものを落とす
//   2. `countStorageDetailChanges`（同上）         — 数えない
//   3. `summarizeStorage`（`lib/summary.ts`）      — 要約に出さない
//
// 2 と 3 は「画面を通らずに書き換えられた JSON」でも効かなければ意味が無いので、
// 手で作った `mode: 'direct', useWholeDisk: true` でも確かめる（落とし穴 23）。
// ---------------------------------------------------------------------------

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = createTranslator('ja')
const DEFAULTS = createDefaultProfile('24.04').storage

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = {
    generateConfig: async () => null,
  }
  useStore.setState({ locale: 'ja', profile: createDefaultProfile('24.04') })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

function render(): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<StorageStep />))
  return host
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.click()
  })
}

function toggle(el: HTMLElement): HTMLButtonElement {
  const button = [...el.querySelectorAll('button')].find((b) => b.hasAttribute('aria-expanded'))
  expect(button, '折りたたみの開閉ボタンが無い').toBeTruthy()
  return button as HTMLButtonElement
}

function open(el: HTMLElement): void {
  if (toggle(el).getAttribute('aria-expanded') === 'false') click(toggle(el))
}

/** ラベルの文言から入力欄を引く（`Switch` / `RadioGroup` は `<label>` が入力を包む）。 */
function byLabel(el: HTMLElement, label: string): HTMLInputElement {
  for (const l of el.querySelectorAll('label')) {
    if (!l.textContent?.includes(label)) continue
    const forId = l.getAttribute('for')
    const target = forId ? el.querySelector(`[id="${forId}"]`) : l.querySelector('input')
    if (target) return target as HTMLInputElement
  }
  throw new Error(`${label} が画面に無い`)
}

const profileOf = (): AutoinstallProfile => useStore.getState().profile
const storageOf = (): StorageConfig => profileOf().storage

const summaryJa = (profile: AutoinstallProfile = profileOf()): string => {
  const text = summarizeStep('storage', profile)
  if (text === null) throw new Error('storage の要約が null')
  return formatLocalized('ja', text)
}

const countOf = (profile: AutoinstallProfile = profileOf()): number | undefined =>
  countStorageDetailChanges(profile.storage, DEFAULTS)

/** 画面を通さずに作った「手で編集された」プロファイル。 */
const handEdited = (over: Partial<Exclude<StorageConfig, { mode: 'raw' }>>): AutoinstallProfile => {
  const p = createDefaultProfile('24.04')
  if (p.storage.mode === 'raw') throw new Error('既定が raw になっている')
  return { ...p, storage: { ...p.storage, ...over } }
}

describe('「ディスク全体を使う」を LVM の外へ持ち出さない', () => {
  it('LVM で有効にすると、値・件数・要約の 3 つに出る（前提）', () => {
    // ここが最初から出ていないと、下の「消える」テストは何も検証していない。
    const el = render()
    open(el)
    click(byLabel(el, t('storage.wholeDisk')))

    expect(storageOf()).toMatchObject({ mode: 'lvm', useWholeDisk: true })
    expect(countOf()).toBe(1)
    expect(summaryJa()).toContain(ja['nav.summaryWholeDisk'])
  })

  it('「そのまま」へ移すと、値・件数・要約の 3 つとも消える', () => {
    const el = render()
    open(el)
    click(byLabel(el, t('storage.wholeDisk')))
    expect(storageOf()).toMatchObject({ useWholeDisk: true })

    click(byLabel(el, t('storage.layoutDirect')))

    // 1. 値（`changeMode`）
    expect(storageOf(), '解除できない設定が残った').toMatchObject({
      mode: 'direct',
      useWholeDisk: false,
    })
    // 2. 件数（`countStorageDetailChanges`）— 開いても直す先が無い Badge を出さない
    expect(countOf(), '開いても変えた覚えのある設定が無い「1 件変更」が出る').toBe(0)
    // 3. 要約（`summarizeStorage`）— 画面に無い設定を「いまの設定」として出さない
    expect(summaryJa(), '解除する操作が画面に無いのに要約だけが言う').not.toContain(
      ja['nav.summaryWholeDisk'],
    )
  })

  it('ZFS へ移しても同じ（LVM 以外はすべて）', () => {
    const el = render()
    open(el)
    click(byLabel(el, t('storage.wholeDisk')))
    click(byLabel(el, t('storage.layoutZfs')))
    expect(storageOf()).toMatchObject({ mode: 'zfs', useWholeDisk: false })
    expect(countOf()).toBe(0)
    expect(summaryJa()).not.toContain(ja['nav.summaryWholeDisk'])
  })

  it('LVM へ戻しても勝手に有効へ戻らない（消した値が復活しない）', () => {
    const el = render()
    open(el)
    click(byLabel(el, t('storage.wholeDisk')))
    click(byLabel(el, t('storage.layoutDirect')))
    click(byLabel(el, t('storage.layoutLvm')))
    expect(storageOf()).toMatchObject({ mode: 'lvm', useWholeDisk: false })
    expect(byLabel(el, t('storage.wholeDisk')).checked).toBe(false)
  })

  it('LVM のままなら残る（切り替えたときだけ消す）', () => {
    const el = render()
    open(el)
    click(byLabel(el, t('storage.wholeDisk')))
    // 同じモードを選び直しても消えない（`changeMode` は先頭で早期 return する）。
    click(byLabel(el, t('storage.layoutLvm')))
    expect(storageOf()).toMatchObject({ mode: 'lvm', useWholeDisk: true })
  })

  it('手で編集された JSON でも、件数と要約は LVM 以外で数えない・出さない', () => {
    // 画面を通らない経路。`changeMode` だけを直しても、ここは残る。
    const p = handEdited({ mode: 'direct', useWholeDisk: true })
    expect(countOf(p), 'LVM 以外の useWholeDisk を数えている').toBe(0)
    expect(summaryJa(p), 'LVM 以外の useWholeDisk を要約に出している').not.toContain(
      ja['nav.summaryWholeDisk'],
    )

    const zfs = handEdited({ mode: 'zfs', useWholeDisk: true })
    expect(countOf(zfs)).toBe(0)
    expect(summaryJa(zfs)).not.toContain(ja['nav.summaryWholeDisk'])
  })

  it('LVM のときは、手で編集された JSON でもちゃんと数える・出す（消しすぎない）', () => {
    // 「LVM 以外で消す」を「常に消す」にすると、こちらが落ちる。
    const p = handEdited({ mode: 'lvm', useWholeDisk: true })
    expect(countOf(p)).toBe(1)
    expect(summaryJa(p)).toContain(ja['nav.summaryWholeDisk'])
  })
})

// ---------------------------------------------------------------------------
// **同じ形の兄弟が `encryptionPassphrase`**。`layout.password` も
// `sizing-policy` と同じく lvm レイアウトにしか出ない（`generate.ts`）。
// `changeMode` と `countStorageDetailChanges` は最初から `mode === 'lvm'` で
// 条件付けられていたのに、**要約だけ素通し**だった（4 か所のうち 1 か所だけ穴）。
// 手で編集された `{mode:'direct', encryptionPassphrase:'x'}` で、
// サイドバーは「暗号化あり」と言うが YAML には password が出ない。
// `validate.ts` の `encryptionRequiresLvm` が error で書き込みは止めるので
// 実害は止まっているが、**要約が嘘をつく**のは直す（落とし穴 67）。
// ---------------------------------------------------------------------------

describe('「暗号化あり」を LVM の外へ持ち出さない', () => {
  it('LVM なら、手で編集された JSON でも「暗号化あり」と出る（前提）', () => {
    const p = handEdited({ mode: 'lvm', encryptionPassphrase: 'correct-horse' })
    expect(summaryJa(p)).toContain(ja['nav.summaryEncryptionOn'])
  })

  it('LVM 以外で値が残っていても「暗号化あり」と言わない', () => {
    // generate.ts は lvm でしか layout.password を出さないので、
    // 「暗号化あり」は生成される YAML と食い違う。
    for (const mode of ['direct', 'zfs'] as const) {
      const p = handEdited({ mode, encryptionPassphrase: 'correct-horse' })
      expect(summaryJa(p), `${mode} で「暗号化あり」と言っている`).not.toContain(
        ja['nav.summaryEncryptionOn'],
      )
      expect(summaryJa(p), `${mode} の暗号化の表示が消えている`).toContain(
        ja['nav.summaryEncryptionOff'],
      )
    }
  })

  it('画面から「そのまま」へ移すと値ごと消える（既存の挙動を固定）', () => {
    const el = render()
    open(el)
    click(byLabel(el, t('storage.encrypt')))
    expect(storageOf()).toMatchObject({ mode: 'lvm' })
    expect((storageOf() as { encryptionPassphrase: string }).encryptionPassphrase.length).
      toBeGreaterThan(0)
    click(byLabel(el, t('storage.layoutDirect')))
    expect(storageOf()).toMatchObject({ mode: 'direct', encryptionPassphrase: '' })
  })

  it('LVM 以外でも、読めない値は黙って捨てずに報告する（短絡させない）', () => {
    // 判定を `mode === 'lvm' && r.filled(...)` と短絡で書くと、
    // LVM 以外では reader が値を見ないので、この報告が消える（落とし穴 50）。
    const p = handEdited({
      mode: 'direct',
      encryptionPassphrase: { nope: true } as unknown as string,
    })
    expect(summaryJa(p), '読めない値を黙って捨てている').toContain('読み取れない設定')
  })
})
