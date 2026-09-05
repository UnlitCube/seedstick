import { describe, expect, it } from 'vitest'
import {
  formatLocalized,
  isLocalizedText,
  migrateProfile,
  type IsoFileInfo,
  type LocalizedText,
} from '@autoinstall/shared'
import { useStore } from './store.js'

// プロファイルを開いたときの箇条書き（App.tsx の Callout）は、
// **移行の notes（shared）と series 合わせの一文（store）が混ざる 1 つのリスト**。
// 片方だけを訳した状態で state に置くと、同じ箇条書きの中で英語と日本語が並ぶ。
// 実際にそうなっていた（`_alignSeriesToIso` だけが `createTranslator` で訳していた）。
//
// `startWrite` のコメントが明言しているとおり、state には訳す前のまま置き、
// 訳すのは描画するときだけ（`useTl`）。そうしないと、表示中に言語を切り替えても
// この一文だけ古い言語のまま残る。

/** series だけが意味を持つ最小の ISO 情報。 */
function isoWith(series: IsoFileInfo['identity']['series']): IsoFileInfo {
  return {
    path: 'C:/iso/ubuntu.iso',
    fileName: 'ubuntu.iso',
    sizeBytes: 0,
    volumeId: 'Ubuntu-Server',
    diskInfo: null,
    identity: { series, kind: 'server', variant: 'live-server', supported: true },
    grubCfg: '',
    patchedGrubCfg: '',
    casperFiles: [],
    minimumDeviceBytes: 0,
  } as unknown as IsoFileInfo
}

describe('プロファイルの注意書きは訳す前のまま state に置く', () => {
  it('_alignSeriesToIso が積むのは LocalizedText（訳した文字列ではない）', () => {
    useStore.setState({ iso: isoWith('24.04'), locale: 'en' })
    const { notes } = useStore.getState()._alignSeriesToIso({
      profile: { ...useStore.getState().profile, series: '22.04' },
      notes: [],
    })
    expect(notes.length).toBe(1)
    const note = notes[0]!
    expect(typeof note).not.toBe('string')
    expect(isLocalizedText(note, true), JSON.stringify(note)).toBe(true)
    expect(note.key).toBe('store.seriesAligned')
    expect(note.params).toEqual({ savedSeries: '22.04', isoSeries: '24.04' })
  })

  it('言語を切り替えると、既に積んだ一文も新しい言語で読める', () => {
    // 訳した文字列を state に置くと、ここが「切り替え前の言語のまま」になる。
    useStore.setState({ iso: isoWith('24.04'), locale: 'ja' })
    const { notes } = useStore.getState()._alignSeriesToIso({
      profile: { ...useStore.getState().profile, series: '22.04' },
      notes: [],
    })
    const ja = formatLocalized('ja', notes[0]!)
    const en = formatLocalized('en', notes[0]!)
    expect(ja).not.toBe(en)
    expect(/[ぁ-んァ-ヶ一-龠]/.test(en)).toBe(false)
    expect(en).toContain('22.04')
    expect(en).toContain('24.04')
  })

  it('移行の notes と混ざっても、英語の画面に日本語が残らない', () => {
    // 実際に起きていた壊れ方: 見出しは英語 (Profile loaded)、箇条書きは日本語。
    useStore.setState({ iso: isoWith('24.04'), locale: 'en' })
    const migrated = migrateProfile({
      profileVersion: 1,
      series: '22.04',
      apt: { fallback: 'bogus-fallback' },
    })
    const { notes } = useStore.getState()._alignSeriesToIso({
      profile: migrated.profile,
      notes: [...migrated.notes],
    })
    expect(notes.length).toBeGreaterThanOrEqual(3)
    const rendered = notes.map((n: LocalizedText) => formatLocalized('en', n))
    for (const line of rendered) {
      expect(line.length).toBeGreaterThan(0)
      expect(/[ぁ-んァ-ヶ一-龠]/.test(line), line).toBe(false)
    }
  })
})
