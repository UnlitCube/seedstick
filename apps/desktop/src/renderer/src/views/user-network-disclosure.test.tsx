// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultProfile, createTranslator, type AutoinstallProfile } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { UserStep, countUserAdvancedChanges } from './UserStep.js'
import { NetworkStep, countNetworkAdvancedChanges } from './NetworkStep.js'

// `user` と `network` の「詳しい設定」（`Disclosure`）。
//
// 表に出るのはインストーラ (subiquity) が実際に聞くものだけ:
//   user    … 氏名・ユーザー名・パスワード・SSH
//   network … DHCP / 固定 IP の選択とその入力
// 折りたたみへ入れたのは、インストーラが決して聞かないもの:
//   user    … 管理ユーザーの追加グループ (`identity.groups`)
//   network … 生の netplan 上書き
//
// ここで固定するのは 4 つ。
//
//   1. 折りたたみは**隠すための仕組みであって、触れなくするための仕組みではない**
//      （落とし穴 61 / 66）。開けば今までどおり操作できること。
//   2. 既定から変わっているときは**最初から開いている**こと。
//      保存済みプロファイルを開いて「設定が消えた」と誤解されるのを防ぐ。
//   3. 件数が「既定と違う設定の数」と一致すること（嘘の 0 を出さない）。
//   4. 非対応リリースで `identity.groups` を**切る操作まで塞がない**こと。
//      26.04 で作ったプロファイルを 24.04 の ISO で開くと groups は残るので、
//      Select ごと disabled にすると「効きません」の警告を消せなくなる。

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ja = createTranslator('ja')

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  // 画面の操作は updateProfile → regenerate を通る。regenerate は
  // window.autoinstall を触るので最低限の偽物を置く（無くても catch されるが、
  // 「例外が握り潰されているから緑」という紛らわしい状態にしない）。
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.autoinstall = {
    generateConfig: async () => null,
  }
  useStore.setState({
    locale: 'ja',
    profile: createDefaultProfile('24.04'),
    passwordDraft: '',
    passwordConfirmDraft: '',
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

function render(node: React.ReactNode, profile?: AutoinstallProfile): HTMLElement {
  if (profile) useStore.setState({ profile })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** 折りたたみの開閉ボタン。`Card` の見出しも `h3` だがボタンを持たないので一意に決まる。 */
const toggleOf = (el: HTMLElement): HTMLButtonElement => {
  const buttons = [...el.querySelectorAll('h3 button')]
  expect(buttons.length, '「詳しい設定」の折りたたみがちょうど 1 つあること').toBe(1)
  return buttons[0] as HTMLButtonElement
}

const open = (el: HTMLElement): void => {
  const toggle = toggleOf(el)
  if (toggle.getAttribute('aria-expanded') === 'false') click(toggle)
}

const isOpen = (el: HTMLElement): boolean =>
  toggleOf(el).getAttribute('aria-expanded') === 'true'

/** 制御された `<select>` に本物の変更を送る（React の state を直接いじらない）。 */
function choose(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  expect(setter, 'jsdom の select に value の setter が無い').toBeDefined()
  act(() => {
    setter!.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** 制御された `<textarea>` に本物の入力を送る。 */
function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  expect(setter, 'jsdom の textarea に value の setter が無い').toBeDefined()
  act(() => {
    setter!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const withGroups = (
  series: AutoinstallProfile['series'],
  groups: AutoinstallProfile['user']['groups'],
): AutoinstallProfile => {
  const base = createDefaultProfile(series)
  return { ...base, user: { ...base.user, groups } }
}

/** グループの選択欄。折りたたみの中にあるので、開くまでは存在しない。 */
const groupsSelect = (el: HTMLElement): HTMLSelectElement | null =>
  el.querySelector('select')

// ---------------------------------------------------------------------------
// user
// ---------------------------------------------------------------------------

describe('UserStep の「詳しい設定」', () => {
  it('既定では閉じていて、追加グループの欄は DOM に無い', () => {
    const el = render(<UserStep />)
    expect(isOpen(el)).toBe(false)
    // `Disclosure` は閉じているとき中身を描画しない（`hidden` で残さない）
    expect(groupsSelect(el)).toBeNull()
    // 表に出るのはインストーラが聞くものだけ。氏名・ユーザー名は畳まれていない。
    expect(el.textContent).toContain(ja('user.username'))
    expect(el.textContent).toContain(ja('ssh.title'))
  })

  it('開けば今までどおり操作できる（隠すだけで、触れなくしない）', () => {
    // `identity.groups` は 26.04 以降。対応リリースで見る。
    const el = render(<UserStep />, createDefaultProfile('26.04'))
    open(el)
    const select = groupsSelect(el)
    expect(select, '開いても追加グループの欄が出てこない').not.toBeNull()
    expect(select!.disabled).toBe(false)

    choose(select!, 'append')
    expect(useStore.getState().profile.user.groups).toEqual({ mode: 'append', groups: [] })

    // モードを変えると一覧の入力欄が出る（＝中の分岐も生きている）
    const input = el.querySelector('input[placeholder="docker libvirt"]')
    expect(input, 'append にしてもグループ名の入力欄が出てこない').not.toBeNull()
  })

  it('既定から変わっていれば最初から開き、件数を出す', () => {
    const el = render(
      <UserStep />,
      withGroups('26.04', { mode: 'append', groups: ['docker'] }),
    )
    expect(isOpen(el)).toBe(true)
    expect(groupsSelect(el)).not.toBeNull()
    expect(el.textContent).toContain(ja('nav.changedCount', { n: 1 }))
  })

  it('既定のままなら件数の Badge を出さない（嘘の「変更あり」を出さない）', () => {
    const el = render(<UserStep />)
    expect(el.textContent).not.toContain(ja('nav.changedCount', { n: 1 }))
  })

  it('非対応リリースでも、設定済みの追加グループは既定へ戻せる（落とし穴 61）', () => {
    // 26.04 で作ったプロファイルを 24.04 の ISO で開いた状態。
    const el = render(
      <UserStep />,
      withGroups('24.04', { mode: 'override', groups: ['sudo', 'docker'] }),
    )
    expect(isOpen(el), '設定されているのに畳まれている').toBe(true)
    const select = groupsSelect(el)
    expect(select, '折りたたみを開いても欄が無い').not.toBeNull()
    expect(
      select!.disabled,
      '非対応リリースで disabled にすると、設定済みの groups を切れなくなる',
    ).toBe(false)

    choose(select!, 'default')
    expect(useStore.getState().profile.user.groups).toEqual({ mode: 'default' })
  })

  it('非対応リリースで既定のままなら、有効にはできない', () => {
    const el = render(<UserStep />, createDefaultProfile('24.04'))
    open(el)
    // 「有効にできない」は正しい。「無効に戻せない」だけが間違い。
    expect(groupsSelect(el)!.disabled).toBe(true)
  })

  it('countUserAdvancedChanges は判別子だけを見る', () => {
    const base = createDefaultProfile('26.04')
    expect(countUserAdvancedChanges(base)).toBe(0)
    // 一覧が空でも「既定ではない」。深く比べて 0 に落とさない。
    expect(countUserAdvancedChanges(withGroups('26.04', { mode: 'append', groups: [] }))).toBe(1)
    expect(
      countUserAdvancedChanges(withGroups('26.04', { mode: 'override', groups: ['sudo'] })),
    ).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

const withNetwork = (network: AutoinstallProfile['network']): AutoinstallProfile => ({
  ...createDefaultProfile('24.04'),
  network,
})

const rawEditor = (el: HTMLElement): HTMLTextAreaElement | null => el.querySelector('textarea')

describe('NetworkStep の「詳しい設定」', () => {
  it('既定では閉じていて、netplan の編集欄は DOM に無い', () => {
    const el = render(<NetworkStep />)
    expect(isOpen(el)).toBe(false)
    expect(rawEditor(el)).toBeNull()
    // モードの選択（＝インストーラが聞くこと）は畳まれていない
    expect(el.textContent).toContain(ja('network.modeStatic'))
  })

  it('固定 IP の入力は折りたたみの外にある', () => {
    const el = render(
      <NetworkStep />,
      withNetwork({
        mode: 'static',
        target: { kind: 'any' },
        address: '192.168.1.10/24',
        gateway: '192.168.1.1',
        nameservers: ['1.1.1.1'],
        searchDomains: [],
        optional: false,
      }),
    )
    expect(isOpen(el), '固定 IP なのに「詳しい設定」が開いている（中身は空のはず）').toBe(false)
    const address = el.querySelector('input[placeholder="192.168.1.10/24"]') as HTMLInputElement
    expect(address, '固定 IP の入力欄が折りたたみの中へ入ってしまっている').not.toBeNull()
    expect(address.value).toBe('192.168.1.10/24')
  })

  it('netplan を直接書いているときは必ず開いた状態で出る', () => {
    // 閉じていると「固定 IP を設定したのに効かない」に見える。
    // 上のモード選択とここの中身が食い違って見えるのが、この画面で最も危ない誤解。
    const el = render(<NetworkStep />, withNetwork({ mode: 'raw', yaml: 'version: 2\n' }))
    expect(isOpen(el)).toBe(true)
    const editor = rawEditor(el)
    expect(editor, '開いているのに netplan の編集欄が無い').not.toBeNull()
    expect(editor!.value).toBe('version: 2\n')
    expect(el.textContent).toContain(ja('nav.changedCount', { n: 1 }))

    // 編集欄が**折りたたみの中にある**こと。畳めば消える（外に置いたままだと残る）。
    click(toggleOf(el))
    expect(rawEditor(el), 'netplan の編集欄が折りたたみの外に残っている').toBeNull()
  })

  it('開けば netplan を今までどおり編集できる', () => {
    const el = render(<NetworkStep />, withNetwork({ mode: 'raw', yaml: 'version: 2\n' }))
    open(el)
    typeInto(rawEditor(el)!, 'version: 2\nethernets: {}\n')
    expect(useStore.getState().profile.network).toEqual({
      mode: 'raw',
      yaml: 'version: 2\nethernets: {}\n',
    })
  })

  it('raw でないときは、折りたたみを開くと出し方を伝える（空のまま黙らない）', () => {
    const el = render(<NetworkStep />)
    open(el)
    expect(rawEditor(el)).toBeNull()
    expect(el.textContent).toContain(ja('network.detailsInactive'))
  })

  it('countNetworkAdvancedChanges は raw のときだけ数える', () => {
    expect(countNetworkAdvancedChanges({ mode: 'installer-default' })).toBe(0)
    expect(countNetworkAdvancedChanges({ mode: 'dhcp', target: { kind: 'any' }, optional: true })).toBe(0)
    expect(
      countNetworkAdvancedChanges({
        mode: 'static',
        target: { kind: 'name', name: 'enp0s3' },
        address: '10.0.0.2/24',
        gateway: '10.0.0.1',
        nameservers: ['9.9.9.9'],
        searchDomains: ['example.local'],
        optional: false,
      }),
      '固定 IP は折りたたみの中に入っていない。ここで数えると件数と中身が食い違う。',
    ).toBe(0)
    expect(countNetworkAdvancedChanges({ mode: 'raw', yaml: '' })).toBe(1)
  })
})
