import { describe, expect, it } from 'vitest'
import { InstallDirError, normalizeInstallDir } from './install-dir.js'

// インストール先は renderer からの自由入力で、この先には
// `mkdir` と「中身を空にしてから展開」と、失敗時の `rm -r` が待っている。
// **通してはいけない形をここで数える。**

function problemOf(raw: unknown): string {
  try {
    normalizeInstallDir(raw)
    return 'ok'
  } catch (e) {
    return e instanceof InstallDirError ? e.problem : 'threw'
  }
}

describe('normalizeInstallDir', () => {
  it('ふつうのパスは通る', () => {
    expect(normalizeInstallDir('C:\\Users\\me\\Programs\\App')).toBe(
      'C:\\Users\\me\\Programs\\App',
    )
  })

  it('末尾の区切りを畳む', () => {
    expect(normalizeInstallDir('C:\\Users\\me\\App\\')).toBe('C:\\Users\\me\\App\\')
  })

  it('文字列でない・空は empty', () => {
    for (const bad of [undefined, null, 0, {}, [], '', '   ']) {
      expect(problemOf(bad)).toBe('empty')
    }
  })

  it('ドライブのルートを断る（rollback の rm -r がドライブを消す）', () => {
    for (const bad of ['C:\\', 'C:/', 'D:\\\\', 'C:\\.\\']) {
      expect(problemOf(bad), bad).toBe('not-absolute')
    }
  })

  it('相対パスを断る', () => {
    for (const bad of ['App', '.\\App', '..\\App', 'Programs\\App']) {
      expect(problemOf(bad), bad).toBe('not-absolute')
    }
  })

  it('UNC を断る', () => {
    expect(problemOf('\\\\server\\share\\App')).toBe('not-absolute')
  })

  it('引用符を断る', () => {
    expect(problemOf('C:\\a"b\\App')).toBe('has-quote')
    expect(problemOf("C:\\a'b\\App")).toBe('has-quote')
  })

  it('Windows システムフォルダを断る', () => {
    const winDir = process.env['WINDIR'] ?? 'C:\\Windows'
    expect(problemOf(winDir)).toBe('not-writable')
    expect(problemOf(`${winDir}\\System32\\App`)).toBe('not-writable')
    // 大小は無視して見る（`c:\windows` でも同じ場所）。
    expect(problemOf(winDir.toLowerCase())).toBe('not-writable')
  })

  it('似た名前のフォルダは断らない（過剰に塞がない）', () => {
    const winDir = process.env['WINDIR'] ?? 'C:\\Windows'
    // `C:\WindowsApps` は `C:\Windows` で始まるが別のフォルダ。
    expect(problemOf(`${winDir}Apps\\App`)).toBe('ok')
  })

  it('`..` を畳んだ結果がルートになる形も断る', () => {
    // 畳む前は「ルートではない」ので、正規化の**あとに**見ないと抜ける。
    expect(problemOf('C:\\Users\\..\\')).toBe('not-absolute')
    expect(problemOf('C:\\a\\b\\..\\..')).toBe('not-absolute')
  })
})
