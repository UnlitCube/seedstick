// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createDefaultProfile,
  createDefaultRaidStorage,
  createTranslator,
  ja,
  type AutoinstallProfile,
  type RaidStorageConfig,
  type StorageConfig,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { StorageStep, countStorageDetailChanges } from './StorageStep.js'

// ---------------------------------------------------------------------------
// ディスク画面の 4 つ目「RAID + LVM」。
//
// 固定するのは**振る舞い**で、文面ではない（落とし穴 56）。
// 文言は辞書 (`ja`) から引くので、訳を書き換えてもここは落ちない。
// 逆に落ちてほしいのは次の 5 つ:
//
//   1. RAID を選んでも一覧と配列の UI が出ない（＝画面から作れない）
//   2. 行を消す・並べ替えると、配列の参照が別のディスクを指す（落とし穴 48。
//      このツールで最も破壊的な失敗の入口）
//   3. 台数不足がその場で分からない（確認画面まで待たせる）
//   4. モードを移ると RAID の設定が消える／解除できない設定が残る（落とし穴 61 / 66）
//   5. 「何台消えるか」を言わない（落とし穴 65。RAID は台数のぶんだけ被害が増える）
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

const click = (el: Element | null | undefined): void => {
  if (!el) throw new Error('押せる要素が無い')
  act(() => {
    ;(el as HTMLElement).click()
  })
}

/** ラベルの文言から入力欄を引く（`Switch` / `RadioGroup` は `<label>` が入力を包む）。 */
function byLabel(scope: HTMLElement, label: string): HTMLInputElement {
  for (const l of scope.querySelectorAll('label')) {
    if (!l.textContent?.includes(label)) continue
    const forId = l.getAttribute('for')
    const target = forId ? scope.ownerDocument.querySelector(`[id="${forId}"]`) : l.querySelector('input')
    if (target) return target as HTMLInputElement
  }
  throw new Error(`${label} が画面に無い`)
}

function byText(scope: HTMLElement, selector: string, text: string): HTMLElement {
  for (const el of scope.querySelectorAll(selector)) {
    if (el.textContent?.includes(text)) return el as HTMLElement
  }
  throw new Error(`${text} の ${selector} が画面に無い`)
}

/** React が張り替えた value のセッターを迂回して値を入れる（そうしないと onChange が呼ばれない）。 */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

const profileOf = (): AutoinstallProfile => useStore.getState().profile
const storageOf = (): Exclude<StorageConfig, { mode: 'raw' }> => {
  const s = profileOf().storage
  if (s.mode === 'raw') throw new Error('raw になっている')
  return s
}
const raidOf = (): RaidStorageConfig => storageOf().raid

const diskRow = (el: HTMLElement, i: number): HTMLElement => {
  const row = el.querySelector(`[data-raid-disk="${i}"]`)
  if (!row) throw new Error(`ディスク行 ${i} が無い`)
  return row as HTMLElement
}
const arrayRow = (el: HTMLElement, j: number): HTMLElement => {
  const row = el.querySelector(`[data-raid-array="${j}"]`)
  if (!row) throw new Error(`配列行 ${j} が無い`)
  return row as HTMLElement
}
const rowCount = (el: HTMLElement, kind: 'disk' | 'array'): number =>
  el.querySelectorAll(`[data-raid-${kind}]`).length

const toRaid = (el: HTMLElement): void => click(byLabel(el, t('storage.layoutRaid')))
const addDisk = (el: HTMLElement): void => click(byText(el, 'button', t('storage.raidAddDisk')))
const addArray = (el: HTMLElement): void => click(byText(el, 'button', t('storage.raidAddArray')))

/** 1 台ぶんのシリアルを入れる（既定の指定方法は「シリアル番号」）。 */
function setSerial(el: HTMLElement, i: number, serial: string): void {
  setValue(byLabel(diskRow(el, i), t('storage.serialLabel')), serial)
}

/** `n` 台のディスクを、シリアル付きで並べる。 */
function setUpDisks(el: HTMLElement, serials: readonly string[]): void {
  serials.forEach((serial, i) => {
    addDisk(el)
    setSerial(el, i, serial)
  })
}

/** 配列 `j` のメンバー（本体）に、ディスク `i` を入れる／外す。 */
function toggleMember(el: HTMLElement, j: number, i: number): void {
  const row = arrayRow(el, j)
  const boxes = [...row.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
  // 「使う」と「スペアにする」が交互に並ぶので、ディスクの並びで引き直す。
  const label = t('storage.raidDiskHeading', { n: i + 1 })
  const target = boxes.find((b) => b.closest('label')?.textContent?.includes(label))
  if (!target) throw new Error(`${label} のチェックボックスが無い`)
  click(target)
}

describe('RAID + LVM を画面から作れる', () => {
  it('構成方法に 4 つ目として出て、選ぶとディスクと配列の UI が現れる', () => {
    const el = render()
    // 前提: 既存の 4 つは変わっていない
    for (const key of ['storage.layoutLvm', 'storage.layoutDirect', 'storage.layoutZfs', 'storage.layoutRaw'] as const) {
      expect(byLabel(el, t(key)), `${key} が消えた`).toBeTruthy()
    }
    expect(el.textContent).not.toContain(ja['storage.raidDisksTitle'])

    toRaid(el)
    expect(storageOf().mode).toBe('raid')
    expect(el.textContent, 'ディスクの一覧が出ない').toContain(ja['storage.raidDisksTitle'])
    expect(el.textContent, '配列の UI が出ない').toContain(ja['storage.raidArraysTitle'])
    // 「どのディスクにインストールするか」は RAID では 1 バイトも使われないので出さない
    // （ディスクを決める場所が 2 つある画面にしない）。
    expect(el.textContent, '使われないディスク指定が残っている').not.toContain(ja['storage.match'])
  })

  it('ディスクの一覧と配列は折りたたみの外に出ている（落とし穴 65）', () => {
    const el = render()
    toRaid(el)
    const disclosure = el.querySelector('[data-disclosure]')?.closest('section')
    expect(disclosure, '折りたたみが無い').toBeTruthy()
    expect(
      disclosure!.textContent?.includes(ja['storage.raidDisksTitle']),
      'ディスクの一覧が折りたたみの中にある',
    ).toBe(false)
  })

  it('ディスクを足すと行が増え、シリアルがプロファイルに入る', () => {
    const el = render()
    toRaid(el)
    expect(rowCount(el, 'disk')).toBe(0)
    setUpDisks(el, ['SER-A', 'SER-B'])
    expect(rowCount(el, 'disk')).toBe(2)
    expect(raidOf().disks.map((d) => d.match)).toEqual([
      { kind: 'serial', serial: 'SER-A' },
      { kind: 'serial', serial: 'SER-B' },
    ])
    // 内部 ID は行ごとに違う（配列がこれで指す）
    expect(new Set(raidOf().disks.map((d) => d.id)).size).toBe(2)
  })

  it('「起動に使う」を外すと boolean が明示的に false になる（undefined にしない）', () => {
    const el = render()
    toRaid(el)
    setUpDisks(el, ['SER-A'])
    expect(raidOf().disks[0]!.boot).toBe(true)
    click(byLabel(diskRow(el, 0), t('storage.raidDiskBoot')))
    expect(raidOf().disks[0]!.boot).toBe(false)
  })
})

describe('行を並べ替え・削除しても配列の参照が壊れない（落とし穴 48）', () => {
  const build = (): HTMLElement => {
    const el = render()
    toRaid(el)
    setUpDisks(el, ['SER-A', 'SER-B', 'SER-C', 'SER-D'])
    addArray(el)
    toggleMember(el, 0, 0)
    toggleMember(el, 0, 1)
    return el
  }

  it('前提: 配列は選んだ 2 台を、添字ではなく ID で指している', () => {
    const el = build()
    const [a, b] = raidOf().disks
    expect(raidOf().arrays[0]!.diskIds).toEqual([a!.id, b!.id])
  })

  it('並べ替えても、配列が指すディスクは同じ 1 台のまま', () => {
    const el = build()
    const before = raidOf().disks.map((d) => d.id)
    const picked = raidOf().arrays[0]!.diskIds

    // 1 台目を下へ。添字で参照していたら、ここで別のディスク（SER-C）が入る。
    click(diskRow(el, 0).querySelector(`button[aria-label="${t('common.moveDown')}"]`))

    expect(raidOf().disks.map((d) => d.id), '並べ替えが効いていない').toEqual([
      before[1],
      before[0],
      before[2],
      before[3],
    ])
    expect(raidOf().arrays[0]!.diskIds, '参照が別のディスクに移った').toEqual(picked)
    // シリアルでも確かめる（ID の付け替えで辻褄を合わせていないこと）
    const byId = new Map(raidOf().disks.map((d) => [d.id, d.match]))
    expect(raidOf().arrays[0]!.diskIds.map((id) => byId.get(id))).toEqual([
      { kind: 'serial', serial: 'SER-A' },
      { kind: 'serial', serial: 'SER-B' },
    ])
  })

  it('使っていない行を消しても、配列の参照はそのまま', () => {
    const el = build()
    const picked = raidOf().arrays[0]!.diskIds
    click(diskRow(el, 3).querySelector(`button[aria-label="${t('common.delete')}"]`))
    expect(rowCount(el, 'disk')).toBe(3)
    expect(raidOf().arrays[0]!.diskIds).toEqual(picked)
  })

  it('使っている行を消すと、宙に浮いた参照を残さない（画面から直せなくなるため）', () => {
    const el = build()
    const [a, b] = raidOf().disks.map((d) => d.id)
    click(diskRow(el, 0).querySelector(`button[aria-label="${t('common.delete')}"]`))
    expect(raidOf().disks.map((d) => d.id)).not.toContain(a)
    expect(raidOf().arrays[0]!.diskIds, '存在しないディスクを指したまま').toEqual([b])
  })

  it('スペアにすると本体から外れる（同じディスクが両方に入らない）', () => {
    const el = build()
    const [a, b] = raidOf().disks.map((d) => d.id)
    const row = arrayRow(el, 0)
    const spare = [...row.querySelectorAll('label')].find((l) =>
      l.textContent?.includes(ja['storage.raidMemberSpare']),
    )
    expect(spare, 'スペアの操作が無い').toBeTruthy()
    click(spare!.querySelector('input'))
    expect(raidOf().arrays[0]!.diskIds).toEqual([b])
    expect(raidOf().arrays[0]!.spareDiskIds).toEqual([a])
  })
})

describe('台数の不足がその場で分かる（確認画面まで待たせない）', () => {
  const withArray = (level: string, disks: readonly string[]): HTMLElement => {
    const el = render()
    toRaid(el)
    setUpDisks(el, disks)
    addArray(el)
    for (let i = 0; i < disks.length; i++) toggleMember(el, 0, i)
    setValue(byLabel(arrayRow(el, 0), t('storage.raidArrayLevel')), level)
    return el
  }

  /**
   * 最小台数の行が「注意の見た目」で出ているか。
   * `Field` は error のときだけアイコン（svg）を付ける。色やクラス名では見ない
   * （配色を変えただけで落ちるテストにしない。落とし穴 56）。
   */
  const minLineIsError = (el: HTMLElement, line: string): boolean => {
    const p = [...arrayRow(el, 0).querySelectorAll('p')].find((x) => x.textContent?.includes(line))
    if (!p) throw new Error('最小台数の行が画面に無い')
    return p.querySelector('svg') !== null
  }

  it('RAID10 を 2 台で組もうとすると、その場で足りないと出る', () => {
    const el = withArray('raid10', ['SER-A', 'SER-B'])
    expect(raidOf().arrays[0]!.level).toBe('raid10')
    // 最小台数（4）と、いま選ばれている台数（2）が画面に出ている
    const line = t('storage.raidLevelMin', { need: 4, have: 2 })
    expect(arrayRow(el, 0).textContent).toContain(line)
    expect(minLineIsError(el, line), '足りないのに注意として出ていない').toBe(true)
    // 検証の指摘も同じ行に出る（確認画面まで進まなくても理由が読める）
    expect(arrayRow(el, 0).textContent, '台数不足の指摘がその場に出ない').toContain(
      t('validate.raidTooFewDevices', { name: 'md0', level: 'raid10', need: 4, have: 2 }),
    )
  })

  it('4 台にすると足りない表示が消える（出しっぱなしにしない）', () => {
    const el = withArray('raid10', ['SER-A', 'SER-B', 'SER-C', 'SER-D'])
    const line = t('storage.raidLevelMin', { need: 4, have: 4 })
    expect(arrayRow(el, 0).textContent).toContain(line)
    expect(minLineIsError(el, line), '足りているのに注意のまま').toBe(false)
  })

  it('RAID1 は 2 台で足りる（一律に止めていない）', () => {
    const el = withArray('raid1', ['SER-A', 'SER-B'])
    expect(arrayRow(el, 0).textContent).toContain(t('storage.raidLevelMin', { need: 2, have: 2 }))
  })

  it('どの 1 台か決まらない指定は、その行で強く警告する（落とし穴 65）', () => {
    const el = render()
    toRaid(el)
    addDisk(el)
    const kind = diskRow(el, 0).querySelector('select') as HTMLSelectElement
    setValue(kind, 'largest')
    expect(diskRow(el, 0).textContent, '曖昧な指定を黙って受けている').toContain(
      t('validate.raidMemberMatchNotSpecific', { n: 1, kind: 'largest' }),
    )
  })
})

describe('何台消えるかを言う（落とし穴 65）', () => {
  /**
   * 画面の**先頭**にある危険の告知だけを見る。
   * ページ全体の textContent で見ると、ディスクの一覧に出る検証の指摘
   * （`validate.raidWipesAllMemberDisks`）が同じことを言っているので、
   * 見出しが壊れていても通ってしまう（実際に変異検査で見つけた）。
   */
  const banner = (el: HTMLElement): string => (el.firstElementChild as HTMLElement).textContent ?? ''

  it('見出しの警告が、実際に書き込む台数を出す', () => {
    const el = render()
    // RAID でないときは今までどおりの文面
    expect(banner(el)).toContain(ja['storage.warning'])

    toRaid(el)
    setUpDisks(el, ['SER-A', 'SER-B', 'SER-C'])
    expect(banner(el), '台数を言っていない').toContain(t('storage.warningRaid', { count: 3 }))
    expect(banner(el)).not.toContain(ja['storage.warning'])
  })

  it('何にも使わないディスクは数に入れない（消さないものを「消える」と言わない）', () => {
    const el = render()
    toRaid(el)
    setUpDisks(el, ['SER-A', 'SER-B'])
    // 2 台目を「起動に使わない」にし、どの配列にも入れない ⇒ 書き込まない
    click(byLabel(diskRow(el, 1), t('storage.raidDiskBoot')))
    expect(banner(el)).toContain(t('storage.warningRaid', { count: 1 }))
    expect(banner(el), '使わないディスクまで数えている').not.toContain(
      t('storage.warningRaid', { count: 2 }),
    )
  })
})

describe('モードを移ったときの値の扱い（落とし穴 61 / 66）', () => {
  it('RAID から LVM へ移っても RAID の設定は残り、戻せば編集を続けられる', () => {
    const el = render()
    toRaid(el)
    setUpDisks(el, ['SER-A', 'SER-B'])
    const before = raidOf().disks

    click(byLabel(el, t('storage.layoutLvm')))
    expect(storageOf().mode).toBe('lvm')
    // 消さない理由: RAID の設定は `mode !== 'raid'` では検証にも出力にも一切出ない。
    // 消すと 4 台ぶんのシリアルを打ち直すだけの損になる。
    expect(raidOf().disks, 'RAID の設定が消えた').toEqual(before)

    toRaid(el)
    expect(rowCount(el, 'disk'), '戻したのに一覧が空').toBe(2)
  })

  it('LVM 専用の設定は、RAID へ移るときに今までどおり消える（解除できない error を残さない）', () => {
    const el = render()
    click(el.querySelector('[data-disclosure]'))
    click(byLabel(el, t('storage.wholeDisk')))
    click(byLabel(el, t('storage.encrypt')))
    expect(storageOf()).toMatchObject({ useWholeDisk: true })
    expect(storageOf().encryptionPassphrase.length).toBeGreaterThan(0)

    toRaid(el)
    expect(storageOf()).toMatchObject({ mode: 'raid', useWholeDisk: false, encryptionPassphrase: '' })
  })

  it('RAID で効かない設定は、隠さずに「効かない」と書く（落とし穴 67）', () => {
    const el = render()
    toRaid(el)
    click(el.querySelector('[data-disclosure]'))
    // パーティション形式は GPT 固定。操作は残す（隠すと解除できなくなる）。
    expect(byLabel(el, t('storage.partitionTable'))).toBeTruthy()
    expect(el.textContent, 'GPT 固定であることを言っていない').toContain(
      ja['storage.raidPtableIgnored'],
    )
    expect(el.textContent).toContain(ja['validate.raidResetPartitionIgnored'])
  })
})

describe('折りたたみの件数（Badge）', () => {
  it('RAID でも「読めない設定」に落とさない（毎回開きっぱなしにしない）', () => {
    const el = render()
    toRaid(el)
    expect(countStorageDetailChanges(storageOf(), DEFAULTS), 'raid を読めない扱いにしている').toBe(0)
  })

  it('折りたたみの中を変えれば数える（swap）', () => {
    const el = render()
    toRaid(el)
    click(el.querySelector('[data-disclosure]'))
    setValue(byLabel(el, t('adv.swapTitle')), 'none')
    expect(countStorageDetailChanges(storageOf(), DEFAULTS)).toBe(1)
  })

  it('表に出している RAID の構成は数えない（開いても直す先が無い Badge を出さない）', () => {
    const el = render()
    toRaid(el)
    setUpDisks(el, ['SER-A', 'SER-B'])
    expect(countStorageDetailChanges(storageOf(), DEFAULTS)).toBe(0)
  })
})

describe('手で編集された JSON でも落ちない（落とし穴 23 / 30 / 31）', () => {
  const handEdited = (raid: unknown): void => {
    const p = createDefaultProfile('24.04')
    if (p.storage.mode === 'raw') throw new Error('既定が raw')
    useStore.setState({
      profile: { ...p, storage: { ...p.storage, mode: 'raid', raid: raid as RaidStorageConfig } },
    })
  }

  it('行が null でも描画でき、その行を消せる', () => {
    handEdited({ ...createDefaultRaidStorage(), disks: [null], arrays: [null] })
    const el = render()
    expect(el.textContent).toContain(ja['storage.raidRowUnreadable'])
    click(diskRow(el, 0).querySelector('button'))
    expect(rowCount(el, 'disk')).toBe(0)
  })

  it('raid の設定ごと欠けていても落ちず、そこから作り始められる', () => {
    handEdited(undefined)
    const el = render()
    expect(el.textContent).toContain(ja['storage.raidDisksEmpty'])
    addDisk(el)
    expect(raidOf().disks).toHaveLength(1)
    expect(raidOf()).toMatchObject({ espSize: '512M', bootSize: '2G', rootFstype: 'ext4' })
  })

  it('一部のキーだけ欠けていたら、触ったときに既定で埋める', () => {
    // 画面には既定（512M / 2G）が出ているのに、保存される JSON にそのキーが無いと、
    // 生成側の既定に頼ることになり「画面の値」と「保存された値」が別物になる。
    handEdited({ disks: [], arrays: [] })
    const el = render()
    addDisk(el)
    expect(raidOf(), '欠けたキーが埋まっていない').toMatchObject({
      espSize: '512M',
      bootSize: '2G',
      rootFstype: 'ext4',
      volumeGroup: 'vg0',
      rootName: 'root',
    })
  })

  it('disks / arrays が配列ですらなくても落ちない', () => {
    handEdited({ disks: 'nope', arrays: null, volumeGroup: 42, rootSize: [], espSize: null })
    const el = render()
    expect(el.textContent).toContain(ja['storage.raidDisksEmpty'])
  })
})
