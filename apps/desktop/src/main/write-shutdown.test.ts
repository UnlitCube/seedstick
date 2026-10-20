import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanupTempDirs, makeTempDir } from './test-support/temp-files.js'
import { EventEmitter } from 'node:events'


// electron の app.getPath('userData') だけを差し替える
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

// spawn を差し替えて「応答しないワーカー」と taskkill の振る舞いを制御する
type Fake = EventEmitter & { pid?: number; stderr: EventEmitter; kill: () => void }
const h = vi.hoisted(() => ({
  taskkill: [] as { at: number; pid: string }[],
  // taskkill の結果: 'ok'(0) / 'denied'(1) / 'hang'(応答なし)
  killMode: 'ok' as 'ok' | 'denied' | 'hang',
  // taskkill 成功時に victim が本当に死ぬか
  victimDies: true,
  victims: [] as Fake[],
  now: () => Date.now(),
}))

function makeFake(pid: number): Fake {
  const e = new EventEmitter() as Fake
  e.pid = pid
  e.stderr = new EventEmitter()
  e.kill = () => undefined
  return e
}

vi.mock('node:child_process', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  spawn: (cmd: string, args: string[]) => {
    if (cmd === 'taskkill') {
      h.taskkill.push({ at: h.now(), pid: args[1] ?? '?' })
      const k = makeFake(999)
      if (h.killMode !== 'hang') {
        setTimeout(() => {
          k.emit('exit', h.killMode === 'ok' ? 0 : 1)
          // 実機では taskkill が成功すれば powershell は死に 'exit' が来る
          if (h.killMode === 'ok' && h.victimDies) {
            for (const v of h.victims) v.emit('exit', 1)
          }
        }, 0)
      }
      return k
    }
    // ワーカー（powershell / node）。cancel を無視して沈黙し続ける
    const c = makeFake(4242)
    h.victims.push(c)
    return c
  },
}))

// hasWriteAccess だけ差し替える（他は本物）
vi.mock('@autoinstall/media', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return { ...mod, getPlatformOps: () => ({ hasWriteAccess: async () => false }) }
})

const { WriteSupervisor } = await import('./write-supervisor.js')
state.userData = makeTempDir('zzq-')

const job = {
  isoPath: 'C:/nowhere.iso',
  devicePath: '\\\\.\\PhysicalDrive9',
  deviceSizeBytes: 31_000_000_000,
  deviceSerial: 'X',
  deviceDescription: 'X',
  patches: [],
  seedFiles: [],
  cidataSizeBytes: 64 * 1024 * 1024,
  hideIsoPartitionFromWindows: true,
  verify: false,
  timestampIso: new Date().toISOString(),
  randomSeedBase64: 'AA==',
} as never

/** ipc.ts:573-580 の shutdownWrite をそのまま写したもの（supervisor を差し替えるため） */
async function shutdownWrite(sup: InstanceType<typeof WriteSupervisor>, timeoutMs = 15000): Promise<void> {
  if (!sup.isBusy()) return
  await sup.cancel()
  const deadline = Date.now() + timeoutMs
  while (sup.isBusy() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** index.ts:81-110 の before-quit → app.quit() → will-quit の順序を再現する */
async function quitSequence(sup: InstanceType<typeof WriteSupervisor>): Promise<
  { beforeQuitMs: number; willQuitMs: number; totalMs: number }
> {
  const t0 = Date.now()
  // before-quit：「中止して終了する」を選んだ → shutdownWrite() → app.quit()
  const end1 = await runUntil(shutdownWrite(sup))
  // app.quit() → before-quit(confirmedQuit=true で素通り) → will-quit → shutdownWrite()
  const end2 = await runUntil(shutdownWrite(sup))
  return { beforeQuitMs: end1 - t0, willQuitMs: end2 - end1, totalMs: end2 - t0 }
}

/** 偽タイマーを 100ms 刻みで進め、promise が解決した時点の偽時刻を返す（最大 60 秒） */
async function runUntil(p: Promise<void>): Promise<number> {
  let at = -1
  void p.then(() => {
    at = Date.now()
  })
  for (let i = 0; i < 600 && at < 0; i++) await vi.advanceTimersByTimeAsync(100)
  await p
  return at < 0 ? Date.now() : at
}

afterEach(() => {
  vi.useRealTimers()
  h.taskkill = []
  h.victims = []
})

// main は利用者の言語を知らない（昇格ワーカーは別プロセスで locale を持たない）。
// 画面に出す文言は **訳さずにキーで運び**、renderer が訳す。
// ここで日本語の文面を正として固定すると、English に切り替えても直らない状態が
// テストで守られてしまう（落とし穴 56）。だから見るのは文面ではなくキー。
const JAPANESE = /[぀-ヿ㐀-鿿]/

// このファイルは **Windows の経路**（昇格した PowerShell と taskkill）を、spawn を差し替えて再現する。
// write-supervisor は `process.platform` を実行時に見るので、macOS / Linux の CI では
// POSIX の経路（process.kill）に入り、差し替えた taskkill が一度も呼ばれずに落ちていた。
// このファイルの間だけ win32 に見せて、どの OS の CI でも同じ経路を確かめる。
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeAll(() => {
  Object.defineProperty(process, 'platform', { ...realPlatform, value: 'win32' })
})
afterAll(() => {
  Object.defineProperty(process, 'platform', realPlatform)
})

describe('書き込みの文言はキーで運ぶ', () => {
  it('二重に start すると write.errorAlreadyRunning を返す', async () => {
    const sup = new WriteSupervisor()
    h.killMode = 'ok'
    h.victimDies = true
    await sup.start(job)
    const second = await sup.start(job)
    expect(second).toEqual({ started: false, message: { key: 'write.errorAlreadyRunning' } })
    expect(JSON.stringify(second)).not.toMatch(JAPANESE)
    await sup.dispose()
  })

  it('準備中の状態もキーで運ぶ（昇格を待っている間）', async () => {
    const sup = new WriteSupervisor()
    h.killMode = 'ok'
    h.victimDies = true
    await sup.start(job)
    // hasWriteAccess は false に差し替えてあるので「許可を待っています」になる
    expect(sup.getStatus()).toEqual({
      state: 'preparing',
      message: { key: 'write.statusWaitingElevation' },
    })
    // IPC を通るので JSON で往復しても同じものであること
    expect(JSON.parse(JSON.stringify(sup.getStatus()))).toEqual(sup.getStatus())
    await sup.dispose()
  })

  it('止められなかったときは write.errorCancelFailed を運び、detail は生の診断だけにする', async () => {
    const sup = new WriteSupervisor()
    h.killMode = 'denied' // 昇格ワーカーは taskkill を拒否する（落とし穴 38 / 52）
    await sup.start(job)
    vi.useFakeTimers()
    await quitSequence(sup)
    const status = sup.getStatus()
    // 「止めました」と嘘をつかない：cancelled ではなく error のままであること
    expect(status).toEqual({
      state: 'error',
      message: { key: 'write.errorCancelFailed' },
      // 利用者への指示（抜かないで／タスクマネージャーで終了して）は訳せる message 側。
      // detail は等幅で出す開発者向けの欄なので、案内文を入れない。
      detail: null,
    })
    expect(JSON.stringify(status)).not.toMatch(JAPANESE)
    await sup.dispose()
  })
})

describe('終了時に shutdownWrite が二重に走るか（index.ts:98 / index.ts:104）', () => {
  it('現実の経路：cancel を無視するワーカーでも taskkill が通れば ~5 秒で busy が下り、2 回目は即座に返る', async () => {
    const sup = new WriteSupervisor()
    h.killMode = 'ok'
    h.victimDies = true
    await sup.start(job)
    expect(sup.isBusy()).toBe(true)

    vi.useFakeTimers()
    const t = await quitSequence(sup)
    expect(sup.isBusy()).toBe(false)
    console.log('[ok]', JSON.stringify(t), 'taskkill=', h.taskkill.length)

    expect(t.beforeQuitMs).toBeLessThan(6000) // 15000 まで待たない
    expect(t.willQuitMs).toBeLessThan(300) // 2 回目は待たない
    expect(h.taskkill.length).toBe(1) // killTree は 1 回だけ
    await sup.dispose()
  })

  it('taskkill が拒否される（昇格プロセス）場合も 5 秒で error になり、2 回目は即座に返る', async () => {
    const sup = new WriteSupervisor()
    h.killMode = 'denied'
    await sup.start(job)
    vi.useFakeTimers()
    const t = await quitSequence(sup)
    console.log('[denied]', JSON.stringify(t), 'status=', JSON.stringify(sup.getStatus()).slice(0, 60), 'taskkill=', h.taskkill.length)
    expect(sup.isBusy()).toBe(false)
    expect(t.beforeQuitMs).toBeLessThan(6000)
    expect(t.willQuitMs).toBeLessThan(300)
    expect(h.taskkill.length).toBe(1)
    await sup.dispose()
  })

  it('taskkill 自体が応答しない場合だけ 15+15 秒になる（このとき killTimer は重ならない）', async () => {
    const sup = new WriteSupervisor()
    h.killMode = 'hang'
    await sup.start(job)
    vi.useFakeTimers()
    const t = await quitSequence(sup)
    console.log('[hang]', JSON.stringify(t), 'taskkill at=', JSON.stringify(h.taskkill.map((x) => x.at - h.taskkill[0]!.at)))
    expect(sup.isBusy()).toBe(true)
    expect(t.totalMs).toBeGreaterThan(29000)
    await sup.dispose()
  })
})

afterAll(() => {
  cleanupTempDirs()
})
