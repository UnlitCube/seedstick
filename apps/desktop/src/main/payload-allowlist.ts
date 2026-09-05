import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 「利用者がダイアログで選んだことのあるファイル」の記録。**main 専用。**
 *
 * ペイロードとして読めるパスはダイアログで選ばれたものだけ、というのが `ipc.ts` の
 * 不変条件だが、保存したプロファイルを開き直すたびに選び直させるわけにもいかない。
 * そこで「一度でも自分で選んだパス」をここに残し、プロファイルを開いたときは
 * **この記録にあるパスだけ**を許可する。
 *
 * これが無いと、他人からもらったプロファイル JSON に
 * `{"kind":"host-file","path":"C:/Users/…/.ssh/id_rsa"}` と書くだけで、
 * 開いて USB を作った利用者の任意の読めるファイルが CIDATA に載る。
 * 「実在するファイルか」を確かめても、それは安全性の検査にはならない。
 *
 * renderer には渡さない（利用者のファイル構成そのものなので、画面に出す必要が無い）。
 */

/** 際限なく増えないように上限を設ける。古いものから落とす。 */
const MAX_ENTRIES = 500

let cache: string[] | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'payload-allowlist.json')
}

/** Windows は大小を区別しないので、比較用のキーに正規化する。 */
function key(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase().replaceAll('\\', '/') : path
}

async function load(): Promise<string[]> {
  if (cache !== null) return cache
  try {
    const raw = JSON.parse(await readFile(storePath(), 'utf8')) as unknown
    cache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    // 初回起動・壊れたファイルはどちらも「まだ何も選んでいない」と同じ扱いでよい
    cache = []
  }
  return cache
}

/** 利用者がダイアログで選んだパスを記録する。 */
export async function rememberChosenPayload(path: string): Promise<void> {
  const list = await load()
  const k = key(path)
  const next = [path, ...list.filter((p) => key(p) !== k)].slice(0, MAX_ENTRIES)
  cache = next
  try {
    await mkdir(dirname(storePath()), { recursive: true })
    await writeFile(storePath(), JSON.stringify(next), { encoding: 'utf8', mode: 0o600 })
  } catch {
    // 保存できなくても動作は続けられる（次回また選び直してもらうだけ）
  }
}

/** 利用者が自分で選んだことのあるパスか。 */
export async function wasChosenByUser(path: string): Promise<boolean> {
  const list = await load()
  const k = key(path)
  return list.some((p) => key(p) === k)
}

/** テスト用。プロセス内のキャッシュを捨てる。 */
export function resetPayloadAllowlistCache(): void {
  cache = null
}
