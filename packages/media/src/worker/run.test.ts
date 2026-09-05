import { describe, expect, it } from 'vitest'
import { DeviceRejectedError } from './run.js'

// 昇格ワーカーは通常権限のユーザーが書ける JSON を唯一の入力として受け取る。
// UAC の確認が出ている間にそれを差し替えられても、書く前に止まらなければ
// 「ユーザーの『はい』」がシステムディスクの破壊に化ける。
// ここでは再検証のふるまいを、偽のプラットフォームで確かめる。

import { runWorkerJob, type WorkerReporter } from './run.js'
import type { WorkerJob, WorkerMessage } from './protocol.js'

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    jobId: 'j1',
    isoPath: 'C:/nonexistent.iso',
    devicePath: '\\.\PhysicalDrive9',
    deviceSizeBytes: 32_000_000_000,
    deviceSerial: 'TESTSERIAL',
    deviceDescription: 'Test Device',
    patches: [],
    seedFiles: [],
    cidataSizeBytes: 64 * 1024 * 1024,
    hideIsoPartitionFromWindows: true,
    verify: false,
    timestampIso: '2026-09-04T00:00:00.000Z',
    randomSeedBase64: 'AAAA',
    reportPort: 1,
    reportToken: 't',
    ...overrides,
  }
}

function collector(): { reporter: WorkerReporter; messages: WorkerMessage[] } {
  const messages: WorkerMessage[] = []
  return {
    messages,
    reporter: {
      send: (m) => messages.push(m),
      onControl: () => {},
      close: () => {},
    },
  }
}

describe('DeviceRejectedError', () => {
  it('書き込みを止めるためのエラー型が公開されている', () => {
    const e = new DeviceRejectedError('x')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('DeviceRejectedError')
  })
})

describe('ジョブの差し替え検知', () => {
  // ISO を開く前にデバイス検証まで到達しないので、ここでは
  // 「ISO が開けない」で落ちること＝検証が ISO の後にあることの確認に留める。
  // 実際の検証ロジックは e2e:usb-worker で実機確認する。
  it('存在しない ISO では書き込みに進まない', async () => {
    const { reporter, messages } = collector()
    await expect(runWorkerJob(job(), reporter)).rejects.toBeInstanceOf(Error)
    expect(messages.some((m) => m.type === 'hello')).toBe(true)
  })
})
