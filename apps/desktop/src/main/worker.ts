import { readFile } from 'node:fs/promises'
import { connectReporter, runWorkerJob, type WorkerJob } from '@autoinstall/media'
import { displayTextOf } from './worker-message.js'

// 昇格プロセスのエントリポイント。
// `ELECTRON_RUN_AS_NODE=1 <electron> out/main/worker.js <job.json>` として起動される。
// Electron の API は一切使わない（GUI を持たない素の Node として動く）。

async function main(): Promise<void> {
  const jobPath = process.argv[2]
  if (!jobPath) {
    // 開発者向け診断。supervisor は spawnDirect / spawnElevated のどちらでも必ず
    // ジョブファイルを渡すので、手でワーカーを叩いたときにしか到達しない。
    process.stderr.write('no job file given\n')
    process.exit(2)
  }
  const job = JSON.parse(await readFile(jobPath, 'utf8')) as WorkerJob
  const reporter = await connectReporter(job.reportPort, job.reportToken)
  try {
    await runWorkerJob(job, reporter)
    reporter.close()
    process.exit(0)
  } catch (err) {
    const e = err as Error
    reporter.send({
      type: 'error',
      jobId: job.jobId,
      // 訳した総括文 + 生の詳細。開発者向けの日本語 message は stack の 1 行目に残る
      // （stack が無い実装でも消えないよう message へフォールバックする）。
      message: displayTextOf(e),
      name: e.name,
      detail: e.stack ?? e.message,
    })
    reporter.close()
    // 親が exit コードで区別できるようにする
    process.exit(e.name === 'WriteCancelledError' ? 3 : 1)
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`)
  process.exit(1)
})
