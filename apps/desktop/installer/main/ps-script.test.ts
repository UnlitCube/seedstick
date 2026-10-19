import { describe, expect, it } from 'vitest'
import {
  CLEANUP_POLL_MARKER,
  PowerShellScriptError,
  UNINSTALL_REGISTRY_KEY,
  buildDeleteFileScript,
  buildDeleteFolderScript,
  buildDetectRunningInstanceCommand,
  buildKillLeftoverCleanupScript,
  buildReadUninstallFieldCommand,
  buildSelfDeleteScript,
  buildShortcutScript,
  buildUninstallScriptFile,
  buildWriteUninstallEntryScript,
  joinPowerShellScript,
  psSingleQuote,
  uninstallCommandFor,
} from './ps-script.js'

// ここで守りたいのは 2 つ。
//
//   (1) `-Command` に渡すスクリプトが**改行で連結されている**こと。
//       空白で連結すると `#` の行が残り全部を飲み込み、PowerShell は
//       何も実行せずに終了 0 を返す（＝呼んだ側からは成功に見える）。
//   (2) 値が**必ずクォートされる**こと。インストール先は自由入力なので、
//       素で埋めるとリテラルを抜けられる。
//
// **入れた検査は変異させて落ちることまで確かめる**（落とし穴 57）ので、
// 下では実際に「空白連結にしたら何が起きるか」を組み立てて示している。

describe('joinPowerShellScript', () => {
  it('改行で連結する', () => {
    expect(joinPowerShellScript(['a', 'b'])).toBe('a\nb')
  })

  it('空の配列を投げて弾く', () => {
    expect(() => joinPowerShellScript([])).toThrow(PowerShellScriptError)
  })

  it('要素の中の改行を投げて弾く', () => {
    // 1 要素 = 1 論理行、を崩されると行単位の検査が意味を失う。
    expect(() => joinPowerShellScript(['a\nb'])).toThrow(PowerShellScriptError)
    expect(() => joinPowerShellScript(['a\r\nb'])).toThrow(PowerShellScriptError)
  })

  it('文字列でない要素を投げて弾く', () => {
    expect(() => joinPowerShellScript([1 as unknown as string])).toThrow(
      PowerShellScriptError,
    )
  })

  it('空白で連結すると「1 行まるごとコメント」になることを示す（変異の実演）', () => {
    const lines = [`# ${CLEANUP_POLL_MARKER}`, "$dir = 'X'", 'Remove-Item $dir']
    const joined = joinPowerShellScript(lines)
    const spaceJoined = lines.join(' ')

    // 正しい形: `#` の行は 1 行目だけ。実行される行が 2 行残る。
    const effective = (script: string): string[] =>
      script
        .split('\n')
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter((l) => l !== '')
    expect(effective(joined)).toHaveLength(2)
    // 空白連結: 全体が 1 行なので、`#` が残り全部を飲む。
    expect(effective(spaceJoined)).toHaveLength(0)
  })
})

describe('psSingleQuote', () => {
  it("単一引用符を 2 つにする", () => {
    expect(psSingleQuote("O'Brien")).toBe("O''Brien")
  })

  it('引用符を含むパスでもリテラルを抜けられない', () => {
    // `'; calc; #` はリテラルを閉じて任意コマンドを足そうとする形。
    const evil = "C:\\x'; Start-Process calc; #"
    const script = buildDeleteFolderScript(evil)
    // クォートは必ず 2 個組で閉じる。閉じ損ねると奇数個になる。
    expect((script.match(/'/g) ?? []).length % 2).toBe(0)
    // 素の `'; ` が残っていない（= リテラルの外へ出ていない）。
    expect(script).not.toMatch(/[^']'; /)
    expect(script).toContain("''")
  })
})

describe('組み立てたスクリプトの形', () => {
  it('ショートカットは値を素で埋めない', () => {
    const s = buildShortcutScript("C:\\a'b\\x.lnk", "C:\\a'b\\app.exe", "C:\\a'b")
    expect(s).toContain("''")
    expect(s.split('\n').length).toBeGreaterThan(3)
    // 失敗を終了コードで拾えること（COM は黙って失敗しうる）。
    expect(s).toContain('exit 1')
  })

  it('削除系は -LiteralPath を使う（ワイルドカードで別のものを消さない）', () => {
    // `[` を含むフォルダ名は実在しうる。`-Path` だと glob として解釈される。
    for (const s of [buildDeleteFileScript('C:\\x[1]\\a.lnk'), buildDeleteFolderScript('C:\\x[1]')]) {
      expect(s).toContain('-LiteralPath')
      expect(s).not.toMatch(/Remove-Item[^\n]*\s-Path\s/)
    }
    expect(buildSelfDeleteScript('C:\\x[1]')).toContain('-LiteralPath')
  })

  it('アンインストール情報は HKCU に書く（このユーザーだけ）', () => {
    expect(UNINSTALL_REGISTRY_KEY.startsWith('HKCU:')).toBe(true)
    const s = buildWriteUninstallEntryScript({
      productName: 'P',
      version: '1.2.3',
      publisher: 'pub',
      installDir: 'C:\\dir',
      uninstallCommand: uninstallCommandFor('C:\\dir\\uninstall.ps1'),
      iconPath: 'C:\\dir\\P.exe',
    })
    expect(s).not.toContain('HKLM')
    expect(s).toContain('UninstallString')
    expect(s).toContain('QuietUninstallString')
  })

  it('「プログラムと機能」のコマンドはパスをダブルクォートで括る', () => {
    // 既定のインストール先は `…\Programs\Seedstick\` で**空白を含む**。
    // 括らないと CreateProcess が途中で引数を割る。
    const cmd = uninstallCommandFor('C:\\Program Files\\A B\\uninstall.ps1')
    expect(cmd).toMatch(/-File "C:\\Program Files\\A B\\uninstall\.ps1"$/)
    expect(cmd).toContain('-NoProfile')
    expect(cmd).toContain('-ExecutionPolicy Bypass')
  })

  it('uninstall.ps1 は「置いたものだけ」を消す', () => {
    const s = buildUninstallScriptFile({
      installDir: 'C:\\dir',
      desktopLink: 'C:\\Users\\u\\Desktop\\P.lnk',
      startMenuLink: 'C:\\Users\\u\\AppData\\Roaming\\...\\P.lnk',
    })
    const lines = s.split('\n')
    // ショートカット 2 つ・レジストリ 1 つ・インストール先 1 つ。それ以外は消さない。
    expect(s).toContain('C:\\Users\\u\\Desktop\\P.lnk')
    expect(s).toContain(UNINSTALL_REGISTRY_KEY)
    expect(s).toContain("$dir = 'C:\\dir'")
    // 利用者のデータ（%APPDATA% のアプリ設定）には触れない。
    expect(s).not.toMatch(/AppData\\Roaming\\Autoinstall/)
    // **カレントディレクトリを外へ移す**。中にいるとそのフォルダは消せない。
    expect(lines).toContain('Set-Location $env:TEMP')
    // ファイルが残ったら終了コードで伝える（黙って成功にしない）。
    expect(s).toContain('exit 1')
    // ただし**空フォルダだけ残った**のは失敗ではない。中身を数えてから分ける。
    expect(s).toContain('Get-ChildItem')
    expect(s).toMatch(/if \(\$left\.Count -gt 0\)/)
    // ワイルドカードで別のものを消さない。
    expect(s).not.toMatch(/Remove-Item[^\n]*\s-Path\s/)
    // 常駐ポーラの目印は**混ぜない**。あの目印は次のインストール時に
    // WMI の CommandLine で探して殺すためのもので、この `.ps1` は
    // `-File` で呼ばれるので CommandLine には出ない（＝目印として働かない）。
    expect(s).not.toContain(CLEANUP_POLL_MARKER)
  })

  it('自己削除のポーラと、それを殺す側が同じ目印を使う', () => {
    // 片方だけ書き換えると「居残ったポーラを殺せない」形で静かに壊れる。
    expect(buildSelfDeleteScript('C:\\dir')).toContain(CLEANUP_POLL_MARKER)
    expect(buildKillLeftoverCleanupScript()).toContain(CLEANUP_POLL_MARKER)
  })

  it('cmd.exe へ渡す 1 行のコマンドに改行が入らない', () => {
    // こちらは `exec()` 経由なので、改行が入るとクォートが壊れる。
    expect(buildReadUninstallFieldCommand('InstallLocation')).not.toMatch(/\r|\n/)
    expect(buildDetectRunningInstanceCommand('C:\\dir')).not.toMatch(/\r|\n/)
  })
})
