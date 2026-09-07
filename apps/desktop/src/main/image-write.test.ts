import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { localized, type LocalizedText, type WriteStatus } from '@autoinstall/shared'
import { cleanupTempDirs, makeTempDir } from './test-support/temp-files.js'

// イメージファイル (.img) への書き出し経路。
//
// **実 ISO は使わない。** 実 ISO を読むと 3 GB 級のファイルができ、CI でも回らない
// （このリポジトリは実際に %TEMP% を 526 GB 埋めてテストを ENOSPC で落としている）。
// 実際に書いて読み戻す検証は `npm run smoke` が実 ISO で行っている——
// この機能は smoke と**同じコードパス**（`executeWritePlan` + `FileBlockDevice`）を
// GUI に繋いだものなので、ここで見るのは smoke に無いものだけ:
//
//   * 昇格を**しない**こと（`spawnElevated` の経路に入らない）
//   * 保存先の許可（ダイアログを通っていないパスを開かない。落とし穴 55）
//   * 状態遷移と後始末（中止したら書きかけのファイルを消す。消せなければ伝える）
//
// 文言は**キー**で確かめる（落とし穴 56）。

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

// spawn の呼び出しを記録する。**何が起動されたか**が、この経路の肝
// （昇格の入口は powershell / osascript / pkexec の 3 つだけ）。
const h = vi.hoisted(() => ({ spawned: [] as { cmd: string; args: string[] }[] }))
vi.mock('node:child_process', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  spawn: (cmd: string, args: string[]) => {
    h.spawned.push({ cmd, args })
    const e = new EventEmitter() as EventEmitter & { pid?: number; stderr: EventEmitter }
    e.pid = 4242
    e.stderr = new EventEmitter()
    setTimeout(() => e.emit('exit', 0), 0)
    return e
  },
}))

// デバイス列挙・昇格判定に触れたら分かるようにする（ファイル経路では 1 度も呼ばれない）。
const platform = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@autoinstall/media', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return {
    ...mod,
    getPlatformOps: () => ({
      hasWriteAccess: () => {
        platform.calls.push('hasWriteAccess')
        return Promise.resolve(false)
      },
      listDevices: () => {
        platform.calls.push('listDevices')
        return Promise.resolve([])
      },
      prepareForWrite: () => {
        platform.calls.push('prepareForWrite')
        return Promise.resolve()
      },
    }),
  }
})

const {
  WriteSupervisor,
  createEmptyImageFile,
  settleImageFailure,
  toWritingStatus,
  removeImageFile,
} = await import('./write-supervisor.js')

state.userData = makeTempDir('img-write-userdata-')
const dir = makeTempDir('img-write-')

// `WriteSupervisor` は動的 import で受けた**値**なので、型位置には書けない (TS2749)。
// 下の `runToEnd` と同じく `InstanceType<typeof ...>` を通す。
function job(
  overrides: Record<string, unknown> = {},
): Parameters<InstanceType<typeof WriteSupervisor>['startImageWrite']>[0] {
  return {
    // 実在しない ISO。`FileBlockDevice.open` が ENOENT で落ちるので、
    // 「計画が通る前にファイルを作らない」ことまで確かめられる。
    isoPath: join(dir, 'nowhere.iso'),
    imagePath: join(dir, 'out.img'),
    patches: [],
    seedFiles: [],
    cidataSizeBytes: 64 * 1024 * 1024,
    hideIsoPartitionFromWindows: true,
    verify: true,
    timestampIso: '2026-09-03T00:00:00.000Z',
    ...overrides,
  }
}

/** 終端（done / error / cancelled）まで待って、流れた状態をすべて返す。 */
async function runToEnd(
  s: InstanceType<typeof WriteSupervisor>,
  input = job(),
): Promise<{ started: boolean; statuses: WriteStatus[] }> {
  const statuses: WriteStatus[] = []
  const done = new Promise<void>((resolve) => {
    const off = s.onStatus((st) => {
      statuses.push(st)
      if (st.state === 'done' || st.state === 'error' || st.state === 'cancelled') {
        off()
        resolve()
      }
    })
  })
  const started = await s.startImageWrite(input)
  await done
  return { started: started.started, statuses }
}

const keyOf = (st: WriteStatus): string | null =>
  'message' in st && st.message ? st.message.key : null

beforeEach(() => {
  h.spawned = []
  platform.calls = []
})

describe('イメージ書き出しは昇格しない', () => {
  it('権限を確認せず、昇格プロセスも起動しない', async () => {
    const s = new WriteSupervisor()
    const imagePath = join(dir, 'no-elevation.img')
    const { started, statuses } = await runToEnd(s, job({ imagePath }))

    expect(started).toBe(true)
    // 昇格の入口は 3 つ。どれも通っていない。
    const elevators = h.spawned.filter((x) =>
      ['powershell.exe', 'osascript', 'pkexec'].includes(x.cmd),
    )
    expect(elevators).toEqual([])
    // 昇格するかどうかの判定 (`hasWriteAccess`) にも触れていない。
    expect(platform.calls).toEqual([])
    // 「権限を確認しています」「管理者権限の許可を待っています」は出ない。
    // 昇格しないのに権限の話をするのは嘘になる。
    const keys = statuses.map(keyOf)
    expect(keys).not.toContain('write.statusCheckingPrivileges')
    expect(keys).not.toContain('write.statusWaitingElevation')
    expect(statuses[0]).toEqual({ state: 'preparing', message: { key: 'image.statusPreparing' } })
  })

  it('ISO を開けなければエラーで終わり、空のファイルを残さない', async () => {
    const s = new WriteSupervisor()
    const imagePath = join(dir, 'never-created.img')
    const { statuses } = await runToEnd(s, job({ imagePath }))

    const last = statuses.at(-1)!
    expect(last.state).toBe('error')
    // 生の ENOENT は detail に落ち、総括は訳せるキーで運ぶ。
    expect(keyOf(last)).toBe('error.unknown')
    expect('detail' in last && last.detail).toMatch(/ENOENT/)
    // ファイルを作るのは計画がすべて通ったあと。ここでは作られていない。
    expect(existsSync(imagePath)).toBe(false)
    // 終わったら次の書き出しを始められる。
    expect(s.isBusy()).toBe(false)
  })

  it('走っている最中の 2 本目は断る', async () => {
    const s = new WriteSupervisor()
    const first = s.startImageWrite(job({ imagePath: join(dir, 'busy-1.img') }))
    const second = await s.startImageWrite(job({ imagePath: join(dir, 'busy-2.img') }))
    expect(second).toEqual({ started: false, message: { key: 'write.errorAlreadyRunning' } })
    await first
  })
})

describe('中止したら書きかけのファイルを消す', () => {
  const cancelled = (): Error => {
    const e = new Error('cancelled')
    e.name = 'WriteCancelledError'
    return e
  }

  it('消せたら「中止しました」で終わる', async () => {
    const path = join(dir, 'cancel-ok.img')
    writeFileSync(path, 'half written')
    const status = await settleImageFailure(cancelled(), path, true)
    expect(status).toEqual({ state: 'cancelled' })
    // 中途半端な .img を残すと「焼いたのに起動しない」原因になる。
    expect(existsSync(path)).toBe(false)
  })

  it('消せなかったら黙って成功にしない（残った場所を伝える）', async () => {
    // 中身のあるディレクトリは `rm` が recursive 無しでは消せない。
    const path = join(dir, 'cancel-undeletable')
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'inside'), 'x')
    const status = await settleImageFailure(cancelled(), path, true)
    expect(status).toEqual({
      state: 'error',
      message: { key: 'image.cancelledLeftover', params: { path } },
      detail: null,
    })
    expect(existsSync(path)).toBe(true)
  })

  it('失敗したときも消す。総括は例外の text を使う', async () => {
    const path = join(dir, 'failure.img')
    writeFileSync(path, 'half written')
    const err = Object.assign(new Error('mismatch at 0'), {
      name: 'VerificationError',
      text: localized('write.verifyMismatch', { offset: 4096 }),
    })
    const status = await settleImageFailure(err, path, true)
    expect(status.state).toBe('error')
    expect(status).toMatchObject({
      message: { key: 'write.verifyMismatch', params: { offset: 4096 } },
    })
    expect(existsSync(path)).toBe(false)
  })

  it('失敗したうえに消せなかったら、元の理由を入れ子のまま包む', async () => {
    const path = join(dir, 'failure-undeletable')
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'inside'), 'x')
    const err = Object.assign(new Error('mismatch'), {
      name: 'VerificationError',
      text: localized('write.verifyMismatch', { offset: 8192 }),
    })
    const status = await settleImageFailure(err, path, true)
    const message = (status as { message: LocalizedText }).message
    expect(message.key).toBe('image.errorLeftover')
    // 理由は捨てずに入れ子で運ぶ（どちらの言語でも 1 文にまとまる）。
    expect(message.params).toMatchObject({
      reason: { key: 'write.verifyMismatch', params: { offset: 8192 } },
      path,
    })
  })

  it('ファイルを作る前に失敗したら、同じ名前の既存ファイルに触らない', async () => {
    // 前回作った .img が同じ場所にあることは普通にある。**それを消したら事故。**
    const path = join(dir, 'previous.img')
    writeFileSync(path, 'a previous image')
    const status = await settleImageFailure(cancelled(), path, false)
    expect(status).toEqual({ state: 'cancelled' })
    expect(readFileSync(path, 'utf8')).toBe('a previous image')
  })

  it('消せたかどうかを正直に返す', async () => {
    const path = join(dir, 'remove-me.img')
    writeFileSync(path, 'x')
    expect(await removeImageFile(path)).toBe(true)
    // 無いものを消すのは成功（目的は達成されている）
    expect(await removeImageFile(path)).toBe(true)
    const undeletable = join(dir, 'remove-fail')
    mkdirSync(undeletable, { recursive: true })
    writeFileSync(join(undeletable, 'inside'), 'x')
    expect(await removeImageFile(undeletable)).toBe(false)
  })
})

describe('イメージファイルの作成', () => {
  it('空のファイルを作る', async () => {
    const path = join(dir, 'created.img')
    await createEmptyImageFile(path)
    expect(statSync(path).size).toBe(0)
  })

  it('既存のファイルは切り詰める（上書きの確認は保存ダイアログ済み）', async () => {
    const path = join(dir, 'overwrite.img')
    writeFileSync(path, 'old content')
    await createEmptyImageFile(path)
    expect(statSync(path).size).toBe(0)
  })

  it.runIf(process.platform === 'win32')('Windows では大きさを決める前に疎フラグを立てる', async () => {
    const path = join(dir, 'sparse.img')
    h.spawned = []
    await createEmptyImageFile(path)
    expect(h.spawned).toEqual([{ cmd: 'fsutil', args: ['sparse', 'setflag', path] }])
  })

  it('作れない場所なら訳せる総括を持つ例外になる', async () => {
    const path = join(dir, 'no-such-dir', 'x.img')
    let thrown: unknown = null
    try {
      await createEmptyImageFile(path)
    } catch (err) {
      thrown = err
    }
    expect(thrown).not.toBeNull()
    expect((thrown as { text?: LocalizedText }).text).toEqual({ key: 'image.createFailed' })
    // 生の理由は残す（detail に出る）
    expect((thrown as Error).message).toMatch(/ENOENT/)
  })
})

describe('進捗は WriteStatus に流れる', () => {
  it('WriteProgress をそのまま写す（デバイス経路の progress と同じ形）', () => {
    const label = localized('writeOp.verifying')
    expect(
      toWritingStatus({
        phase: 'writing',
        bytesDone: 123,
        bytesTotal: 456,
        label,
        bytesPerSecond: 78,
        etaSeconds: 9,
      }),
    ).toEqual({
      state: 'writing',
      phase: 'writing',
      bytesDone: 123,
      bytesTotal: 456,
      label,
      bytesPerSecond: 78,
      etaSeconds: 9,
    })
  })

  it('測れていない速度は null のまま運ぶ（0 に丸めると「残り 0 秒」になる）', () => {
    const st = toWritingStatus({
      phase: 'verifying',
      bytesDone: 0,
      bytesTotal: 1,
      label: localized('writeOp.verifying'),
      bytesPerSecond: null,
      etaSeconds: null,
    })
    expect(st).toMatchObject({ bytesPerSecond: null, etaSeconds: null, phase: 'verifying' })
  })
})

afterAll(() => {
  cleanupTempDirs()
})
