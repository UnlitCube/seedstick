import { describe, expect, it } from 'vitest'
import { ja, en, type MsgKey } from '@autoinstall/shared'
import { STEP_GROUPS, STEP_LABELS, STEP_ORDER, type StepId } from './store.js'

// ステップの並びとグループ分け。
//
// 「順序」と「グループ」を別々に書くと必ず食い違うので、`STEP_ORDER` は
// `STEP_GROUPS` から導いている。ここではその導出が壊れていないこと
// （落ちも重複も無いこと）と、意図した並びであることを固定する。

describe('ステップの並び', () => {
  it('STEP_ORDER は STEP_GROUPS から導かれていて、落ちも重複も無い', () => {
    const all = Object.keys(STEP_LABELS) as StepId[]
    expect([...STEP_ORDER].sort()).toEqual([...all].sort())
    expect(new Set(STEP_ORDER).size).toBe(STEP_ORDER.length)
    expect(STEP_ORDER).toEqual(STEP_GROUPS.flatMap((g) => [...g.steps]))
  })

  it('runtime は software / postinstall より後ろ', () => {
    // 起動メニューで値を差し替える仕組みはこのアプリで最も上級の概念。
    // 以前は 6 番目（ソフトウェアより前）にあった。
    const at = (id: StepId): number => STEP_ORDER.indexOf(id)
    expect(at('runtime')).toBeGreaterThan(at('software'))
    expect(at('runtime')).toBeGreaterThan(at('postinstall'))
  })

  it('並びは意図どおり', () => {
    expect(STEP_ORDER).toEqual([
      'iso',
      'basics',
      'user',
      'network',
      'storage',
      'software',
      'postinstall',
      'runtime',
      'review',
      'write',
    ])
  })

  it('review / write は最後のグループ（設定より後ろ）', () => {
    expect(STEP_GROUPS[STEP_GROUPS.length - 1]?.steps).toEqual(['review', 'write'])
  })

  it('必ず設定するグループは飛ばせないステップだけ', () => {
    expect(STEP_GROUPS[0]?.id).toBe('required')
    expect(STEP_GROUPS[0]?.steps).toEqual(['iso', 'basics', 'user'])
  })
})

describe('サイドバーの文言', () => {
  it('グループの見出しと説明が両方の辞書に実在する', () => {
    const keys: MsgKey[] = STEP_GROUPS.flatMap((g) => [g.title, g.hint])
    expect(keys.length).toBe(8)
    for (const key of keys) {
      expect(ja[key], `ja に ${key} が無い`).toBeTruthy()
      expect(en[key], `en に ${key} が無い`).toBeTruthy()
      expect(/[ぁ-んァ-ヶ一-龠]/.test(en[key]), `en.${key} に日本語`).toBe(false)
    }
  })

  it('ステップ名も両方の辞書に実在する', () => {
    for (const key of Object.values(STEP_LABELS)) {
      expect(ja[key], `ja に ${key} が無い`).toBeTruthy()
      expect(en[key], `en に ${key} が無い`).toBeTruthy()
    }
  })
})
