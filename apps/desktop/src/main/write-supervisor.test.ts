import { describe, expect, it } from 'vitest'
import { isElevationDeclined, planKill, taskkillMeansStopped } from './write-supervisor.js'

// 昇格を断られたのか本当に失敗したのかを取り違えると、
// ユーザーに「もう一度許可してください」ではなく意味不明な OS のエラーを見せることになる。
describe('isElevationDeclined', () => {
  it('Windows で UAC を拒否したときの stderr を判定できる', () => {
    // 実際に UAC をキャンセルして得られた出力（日本語ロケール）
    const stderr = [
      'Start-Process : この操作は、次のエラーのため実行できません: この操作はユーザーによって取り消されました。。',
      '発生場所 行:1 文字:32',
      "+ ... S_NODE='1'; Start-Process -FilePath 'C:\dev\autoinstall-ui\node_modul ...",
      '    + CategoryInfo          : InvalidOperation: (:) [Start-Process]、InvalidOperationException',
      '    + FullyQualifiedErrorId : InvalidOperationException,Microsoft.PowerShell.Commands.StartProcessCommand',
    ].join('\n')
    expect(isElevationDeclined(stderr)).toBe(true)
  })

  it('OS の言語が変わっても判定できる（識別子で見ている）', () => {
    const stderr =
      'Start-Process : This command cannot be run due to the error: The operation was canceled by the user.\n' +
      '    + FullyQualifiedErrorId : InvalidOperationException,Microsoft.PowerShell.Commands.StartProcessCommand'
    expect(isElevationDeclined(stderr)).toBe(true)
  })

  it('macOS の osascript キャンセルを判定できる', () => {
    expect(isElevationDeclined('execution error: ユーザーによって取り消されました。 (-128)')).toBe(true)
  })

  it('Linux の pkexec 拒否を判定できる', () => {
    expect(isElevationDeclined('Error executing command as another user: Request dismissed')).toBe(true)
  })

  it('本当の書き込みエラーは拒否と混同しない', () => {
    expect(isElevationDeclined('Error: EIO: i/o error, write')).toBe(false)
    expect(isElevationDeclined('')).toBe(false)
    // 「canceled」という語が出てくるだけの別のエラー
    expect(isElevationDeclined('the download was canceled by the server')).toBe(false)
  })
})

// キャンセルで「止めました」と表示したのにワーカーが書き続けていると、
// ユーザーは USB を抜いてしまう。何を落とし、何をもって成功と見なすかは
// この 2 つの純粋関数に集約してある。
describe('キャンセル時に落とす対象', () => {
  it('昇格経路ではワーカー本体を狙い、ラッパーも一緒に落とす', () => {
    // child = PowerShell のラッパー (4321)、hello が知らせたワーカー = 8765
    const { targets, decisive } = planKill(8765, 4321)
    expect(targets).toEqual([8765, 4321])
    // ラッパーは自分の子なので必ず落ちる。成否の判断に使ってはいけない。
    expect(decisive).toBe(8765)
  })

  it('昇格済みで直接 spawn した場合は同じ pid を 2 回落とさない', () => {
    const { targets, decisive } = planKill(1234, 1234)
    expect(targets).toEqual([1234])
    expect(decisive).toBe(1234)
  })

  it('hello がまだ来ていなければラッパーで判断する', () => {
    const { targets, decisive } = planKill(null, 4321)
    expect(targets).toEqual([4321])
    expect(decisive).toBe(4321)
  })

  it('落とす相手がいなければ何もしない', () => {
    expect(planKill(null, null)).toEqual({ targets: [], decisive: null })
  })
})

describe('taskkill の終了コードの解釈', () => {
  it('0 は落とせた', () => {
    expect(taskkillMeansStopped(0)).toBe(true)
  })

  it('128（プロセスが存在しない）は既に終わっているので成功扱い', () => {
    expect(taskkillMeansStopped(128)).toBe(true)
  })

  it('1（アクセス拒否）は失敗。昇格ワーカーはここに来る', () => {
    expect(taskkillMeansStopped(1)).toBe(false)
  })

  it('シグナルで落ちた場合 (code=null) も成功と見なさない', () => {
    expect(taskkillMeansStopped(null)).toBe(false)
  })
})
