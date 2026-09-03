import { readFile } from 'node:fs/promises'
import { connectReporter, runWorkerJob, type WorkerJob } from '@autoinstall/media'

// 昇格プロセスのエントリポイント。
// `ELECTRON_RUN_AS_NODE=1 <electron> out/main/worker.js <job.json>` として起動される。
// Electron の API は一切使わない（GUI を持たない素の Node として動く）。

async function main(): Promise<void> {
  const jobPath = process.argv[2]
  if (!jobPath) {
    process.stderr.write('ジョブファイルが指定されていません。\n')
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
      message: e.message,
      name: e.name,
      detail: e.stack ?? null,
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
