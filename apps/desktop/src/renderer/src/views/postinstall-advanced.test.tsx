// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultProfile, createTranslator, type AutoinstallProfile } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { PostInstallStep, countAdvancedChanges } from './PostInstallStep.js'

// 「上級者向け」はタブから外し、タブ群の下の折りたたみ（`Disclosure`）へ移した。
// 折りたたみは**隠すための仕組みであって、触れなくするための仕組みではない**
// （落とし穴 61 / 66）。ここで固定するのは 4 つ。
//
//   1. タブの一覧から「上級者向け」が消えていること
//   2. 折りたたみを開けば、中の設定を**今までどおり操作できる**こと
//      （error-commands の下書きが生きていることまで含めて。落とし穴 58）
//   3. 既定から変わっている設定があるときは**最初から開いている**こと
//      （保存済みプロファイルを開いて「設定が消えた」と誤解されるのを防ぐ）
//   4. 件数が「既定と違う設定の数」と一致すること（嘘の 0 を出さない）

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ja = createTranslator('ja')

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  // 画面の操作は updateProfile → regenerate を通る。regenerate は
  // window.autoinstall を触るので、最低限の偽物を置く（無くても catch されるが、
  // 「例外が握り潰されているから緑」という紛らわしい状態にしない）。
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

function render(profile?: AutoinstallProfile): HTMLElement {
  if (profile) useStore.setState({ profile })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<PostInstallStep />))
  return host
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** 折りたたみの開閉ボタン。`Card` の見出しは `h3` だがボタンを持たないので一意に決まる。 */
const disclosureToggle = (el: HTMLElement): HTMLButtonElement => {
  const button = el.querySelector('h3 button')
  expect(button, '「上級者向け」の折りたたみが見つからない').not.toBeNull()
  return button as HTMLButtonElement
}

/** タブのボタン（折りたたみの開閉ボタンは `h3` の中なので除く）。 */
const tabLabels = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('button')]
    .filter((b) => b.closest('h3') === null)
    .map((b) => b.textContent ?? '')

const open = (el: HTMLElement): void => {
  const toggle = disclosureToggle(el)
  if (toggle.getAttribute('aria-expanded') === 'false') click(toggle)
}

/**
 * 制御された `<textarea>` に本物の入力を送る。
 * value を直接代入しただけでは React が変化に気づかないので、
 * プロトタイプの setter で書いてから `input` を発火する。
 */
function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  expect(setter, 'jsdom の textarea に value の setter が無い').toBeDefined()
  act(() => {
    setter!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const textareaByPlaceholder = (el: HTMLElement, starts: string): HTMLTextAreaElement => {
  const found = [...el.querySelectorAll('textarea')].find((t) =>
    (t.placeholder ?? '').startsWith(starts),
  )
  expect(found, `placeholder が ${starts} で始まる textarea が無い`).toBeDefined()
  return found!
}

describe('PostInstallStep の「上級者向け」', () => {
  it('タブの一覧から外れ、タブ群の下の折りたたみになっている', () => {
    const el = render()
    const labels = tabLabels(el)
    expect(labels).toEqual([
      ja('postinstall.tabPresets'),
      ja('postinstall.tabDeploy'),
      ja('postinstall.tabServices'),
      ja('postinstall.tabFiles'),
    ])
    // 折りたたみ側には残っている（機能ごと消したのではない）
    expect(disclosureToggle(el).textContent).toContain(ja('postinstall.tabAdvanced'))
  })

  it('既定では閉じていて、中身は DOM に無い', () => {
    const el = render()
    expect(disclosureToggle(el).getAttribute('aria-expanded')).toBe('false')
    expect(el.textContent).not.toContain(ja('adv.errorCommands'))
    expect(el.textContent).not.toContain(ja('adv.adTitle'))
  })

  it('開けば error-commands / debconf / 通知先 / Active Directory / 生の YAML が全部ある', () => {
    const el = render()
    open(el)
    for (const key of [
      'adv.errorCommands',
      'adv.debconf',
      'adv.reporting',
      'adv.adTitle',
      'postinstall.rawYaml',
    ] as const) {
      expect(el.textContent, `${key} が折りたたみの中に無い`).toContain(ja(key))
    }
  })

  it('開いた中の設定は今までどおり操作できる（Active Directory の切り替え）', () => {
    const el = render()
    open(el)
    const label = [...el.querySelectorAll('label')].find((l) =>
      (l.textContent ?? '').includes(ja('adv.adWarning')),
    )
    expect(label, 'Active Directory のスイッチが無い').toBeDefined()
    const box = label!.querySelector('input[type="checkbox"]') as HTMLInputElement
    click(box)
    expect(useStore.getState().profile.activeDirectory.enabled).toBe(true)
    // 「有効にはできるが無効に戻せない」を作らない（落とし穴 61 / 66）
    click(box)
    expect(useStore.getState().profile.activeDirectory.enabled).toBe(false)
  })

  it('移動しても error-commands の下書きが生きている（区切りの改行を打てる）', () => {
    const el = render()
    open(el)
    const area = textareaByPlaceholder(el, 'curl -X POST')
    typeInto(area, 'echo a')
    expect(useStore.getState().profile.postInstall.errorCommands).toEqual(['echo a'])
    // ここが落とし穴 58。正規化すると同じ配列に戻るので、下書きを通していないと
    // 打った改行が消え、2 行目を書き始められない。
    typeInto(area, 'echo a\n')
    expect(area.value).toBe('echo a\n')
    typeInto(area, 'echo a\necho b')
    expect(useStore.getState().profile.postInstall.errorCommands).toEqual(['echo a', 'echo b'])
  })

  it('既定から変わっていれば最初から開いていて、件数が出る', () => {
    const profile = createDefaultProfile('24.04')
    const el = render({
      ...profile,
      postInstall: { ...profile.postInstall, debconfSelections: 'x' },
      behavior: { ...profile.behavior, interactiveAll: true },
    })
    expect(disclosureToggle(el).getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain(ja('nav.changedCount', { n: 2 }))
    expect(el.textContent).toContain(ja('adv.debconf'))
  })
})

describe('countAdvancedChanges', () => {
  const base = createDefaultProfile('24.04')
  const withPost = (over: Partial<AutoinstallProfile['postInstall']>): AutoinstallProfile => ({
    ...base,
    postInstall: { ...base.postInstall, ...over },
  })
  const withBehavior = (over: Partial<AutoinstallProfile['behavior']>): AutoinstallProfile => ({
    ...base,
    behavior: { ...base.behavior, ...over },
  })

  it('既定のプロファイルは 0 件', () => {
    expect(countAdvancedChanges(base)).toBe(0)
  })

  it('折りたたみの中の設定を 1 つずつ数える', () => {
    expect(countAdvancedChanges(withPost({ collectLogsOnError: false }))).toBe(1)
    expect(countAdvancedChanges(withPost({ errorCommands: ['x'] }))).toBe(1)
    expect(countAdvancedChanges(withPost({ debconfSelections: 'x' }))).toBe(1)
    expect(
      countAdvancedChanges(withBehavior({ reporting: { kind: 'webhook', endpoint: '' } })),
    ).toBe(1)
    expect(countAdvancedChanges(withBehavior({ interactiveAll: true }))).toBe(1)
    expect(
      countAdvancedChanges({ ...base, advanced: { ...base.advanced, rawOverlayYaml: 'a: 1' } }),
    ).toBe(1)
  })

  it('複数変えたら合算される', () => {
    const p = {
      ...withBehavior({ refreshInstaller: true, refreshInstallerChannel: 'stable/ubuntu-24.04' }),
      activeDirectory: { enabled: true, domainName: 'corp.example.com', adminName: 'Administrator' },
    }
    expect(countAdvancedChanges(p)).toBe(5)
  })

  it('折りたたみの外にある設定は数えない（要約と件数が食い違わないように）', () => {
    expect(
      countAdvancedChanges(
        withPost({
          presets: ['sudo-nopasswd'],
          lateCommands: ['echo hi'],
          files: [
            { name: 'a', targetPath: '/etc/a', mode: '0644', owner: 'root', content: '' },
          ],
          aptFullUpgrade: true,
        }),
      ),
    ).toBe(0)
  })

  it('壊れた値を「変更なし」に落とさない（黙って隠さない。落とし穴 50）', () => {
    // 手で編集された JSON では配列でない値が届く。0 と偽ると、折りたたまれたまま
    // 気づけない設定ができる。
    const broken = { ...base, postInstall: { ...base.postInstall, errorCommands: 'echo x' } }
    expect(countAdvancedChanges(broken as unknown as AutoinstallProfile)).toBe(1)
  })

  it('セクションごと欠けていても例外を投げない', () => {
    const gutted = { series: '24.04' } as unknown as AutoinstallProfile
    expect(() => countAdvancedChanges(gutted)).not.toThrow()
    // 既定と一致しないことは分かるので 0 にはしない
    expect(countAdvancedChanges(gutted)).toBeGreaterThan(0)
  })
})
