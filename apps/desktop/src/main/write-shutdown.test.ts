import { describe, expect, it, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
state.userData = mkdtempSync(join(tmpdir(), 'zzq-'))

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
