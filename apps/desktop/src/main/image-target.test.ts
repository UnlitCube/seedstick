import { describe, expect, it } from 'vitest'
import { formatLocalized, type LocalizedText } from '@autoinstall/shared'
import {
  checkFreeSpace,
  checkImageDestination,
  isSamePath,
  suggestImageFileName,
} from './image-target.js'

// イメージファイル (.img) の保存先の検査。
//
// ここで確かめるのは **書き出す前に断ること**。実際の書き出しには実 ISO が要り、
// 数 GB のファイルができるので、そちらは smoke / e2e に任せている
// （`npm run smoke` が実 ISO を `.img` に書いて読み戻しまで検証する。
//   この機能はその経路をそのまま GUI に繋いだもの）。
//
// 文言は**キー**で確かめる。日本語の文面を固定すると、English に切り替えても
// 日本語を返す実装をテストが「正」として要求してしまう（落とし穴 56）。

const CHOSEN = '/tmp/out/autoinstall.img'
const ISO = '/tmp/iso/ubuntu-24.04.iso'
const PAYLOAD = '/tmp/payload/myapp.tar.gz'

function check(overrides: Partial<Parameters<typeof checkImageDestination>[0]> = {}): LocalizedText | null {
  return checkImageDestination({
    imagePath: CHOSEN,
    allowedImagePaths: [CHOSEN],
    isoPaths: [ISO],
    payloadPaths: [PAYLOAD],
    ...overrides,
  })
}

describe('保存先の許可', () => {
  it('ダイアログで選ばれた保存先は通る', () => {
    expect(check()).toBeNull()
  })

  it('ダイアログを通っていないパスは拒否する（落とし穴 55）', () => {
    // renderer から来た文字列をそのまま開かない。実在するかどうかは関係ない。
    expect(check({ imagePath: '/tmp/out/somewhere-else.img' })).toEqual({
      key: 'image.pathNotChosen',
    })
  })

  it('許可リストが空なら何も通らない', () => {
    expect(check({ allowedImagePaths: [] })).toEqual({ key: 'image.pathNotChosen' })
  })

  it.runIf(process.platform === 'win32')(
    'Windows では大文字小文字と区切り文字の違いを同じパスとみなす',
    () => {
      // 許可リストに `C:\out\a.img` を入れて `c:/OUT/A.IMG` で来ても通る。
      // ここを取り違えると、選んだのに「選ばれていません」と断ってしまう。
      expect(isSamePath('C:\\out\\a.img', 'c:/OUT/A.IMG')).toBe(true)
      expect(
        checkImageDestination({
          imagePath: 'c:/OUT/A.IMG',
          allowedImagePaths: ['C:\\out\\a.img'],
          isoPaths: [],
          payloadPaths: [],
        }),
      ).toBeNull()
    },
  )

  it.runIf(process.platform !== 'win32')('POSIX では大文字小文字を区別する', () => {
    expect(isSamePath('/out/a.img', '/out/A.IMG')).toBe(false)
  })
})

describe('自分の入力を壊す保存先を断る', () => {
  it('選んでいる ISO そのものには書き出せない', () => {
    // 許可リストには入っている（ダイアログで ISO を選んでしまった）状態。
    // それでも断る——書き出しは ISO を読みながら進むので、読んでいる最中の
    // ファイルを潰すことになる。
    expect(check({ imagePath: ISO, allowedImagePaths: [ISO] })).toEqual({ key: 'image.sameAsIso' })
  })

  it('今回選んでいない ISO も守る（再ダウンロードが要るため）', () => {
    const other = '/tmp/iso/ubuntu-22.04.iso'
    expect(check({ imagePath: other, allowedImagePaths: [other], isoPaths: [ISO, other] })).toEqual({
      key: 'image.sameAsIso',
    })
  })

  it('展開するファイルには書き出せない。どのファイルかを差し込み値で運ぶ', () => {
    const r = check({ imagePath: PAYLOAD, allowedImagePaths: [PAYLOAD] })
    expect(r).toEqual({ key: 'image.overwritesPayload', params: { path: 'myapp.tar.gz' } })
    // 名前は利用者が付けた自由入力。訳文には差し込まれるだけ。
    expect(formatLocalized('en', r!)).toContain('myapp.tar.gz')
    expect(formatLocalized('en', r!)).not.toMatch(/[ぁ-んァ-ヶ一-龠]/u)
  })

  it('ISO の判定はダイアログの許可より先に効く（順番を入れ替えても素通りしない）', () => {
    // 許可リストに入っていない ISO は pathNotChosen で断る。どちらにせよ通らない。
    expect(check({ imagePath: ISO })).toEqual({ key: 'image.pathNotChosen' })
  })
})

describe('空き容量', () => {
  it('足りなければ必要量と空きを差し込んで断る', () => {
    const r = checkFreeSpace(4_000_000_000, 1_500_000_000)
    expect(r).toEqual({ key: 'image.noSpace', params: { required: '4.0 GB', free: '1.5 GB' } })
    expect(formatLocalized('en', r!)).toContain('4.0 GB')
  })

  it('足りていれば通る', () => {
    expect(checkFreeSpace(4_000_000_000, 4_000_000_000)).toBeNull()
    expect(checkFreeSpace(4_000_000_000, 9_000_000_000)).toBeNull()
  })

  it('空き容量が取れなかった環境では判定しない（分からないことを「足りない」と言わない）', () => {
    expect(checkFreeSpace(4_000_000_000, null)).toBeNull()
  })
})

describe('既定のファイル名', () => {
  it('プロファイル名から .img の名前を作る', () => {
    expect(suggestImageFileName('web-server')).toBe('web-server.img')
  })

  it('パス区切りと Windows で使えない文字を落とす（defaultPath に渡る値なので）', () => {
    // 区切りは落ちるので、フォルダを遡る名前にはならない（残る `..` はただの文字）
    expect(suggestImageFileName('../../etc/passwd')).toBe('-..-etc-passwd.img')
    for (const name of ['../../etc/passwd', 'C:\\Windows\\System32', 'a/b']) {
      expect(suggestImageFileName(name)).not.toMatch(/[\\/]/)
    }
    expect(suggestImageFileName('a:b*c?d"e<f>g|h')).toBe('a-b-c-d-e-f-g-h.img')
    expect(suggestImageFileName('C:\\Windows\\System32')).toBe('C--Windows-System32.img')
  })

  it('.img を二重に付けない', () => {
    expect(suggestImageFileName('disk.img')).toBe('disk.img')
  })

  it('前後のドットと空白を落とす（Windows が黙って落とすので、こちらで落とす）', () => {
    expect(suggestImageFileName('  ..name..  ')).toBe('name.img')
  })

  it('空になった候補は飛ばして次の候補を使う', () => {
    expect(suggestImageFileName('', '   ', 'node-01')).toBe('node-01.img')
  })

  it('Windows の予約名は使わない', () => {
    expect(suggestImageFileName('CON', 'nul', 'ok')).toBe('ok.img')
  })

  it('候補が全部だめなら既定の名前になる（ダイアログが開けないほうが困る）', () => {
    expect(suggestImageFileName()).toBe('autoinstall.img')
    expect(suggestImageFileName('', '...')).toBe('autoinstall.img')
  })

  it('長すぎる名前は切り詰める', () => {
    const name = suggestImageFileName('x'.repeat(300))
    expect(name.length).toBe(64 + '.img'.length)
  })
})
