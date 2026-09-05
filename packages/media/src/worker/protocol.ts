// 昇格ワーカーとの通信プロトコル。
//
// GUI 本体は通常権限で動き、USB への書き込みだけを管理者/root で起動した別プロセスに任せる。
// 昇格したプロセスの標準出力は親から確実には読めない（Windows の runas がその代表）ので、
// ローカルの TCP ポートに NDJSON を流す方式にしている。
// 127.0.0.1 に限定し、1 回限りのトークンで認証する。
//
// 画面に出す文言はここで訳さない。ワーカーは別プロセスで利用者の言語を知らないので、
// `LocalizedText`（キー + 差し込み値）のまま運び、renderer が訳す。
// `LocalizedText` は JSON 往復で同じものになる純粋なデータなので、この NDJSON に載せられる。

import type { LocalizedText } from '@autoinstall/shared'

export interface WorkerJob {
  /** ジョブ ID（ログの相関に使う） */
  readonly jobId: string
  readonly isoPath: string
  readonly devicePath: string
  readonly deviceSizeBytes: number
  /**
   * ユーザーが選んだ実物を昇格側でも見分けるための情報。
   * デバイスノード（`\\.\PhysicalDriveN` / `/dev/sdX`）は抜き差しで再利用されるので、
   * パスと容量だけでは「同じ容量の別のディスク」を止められない。
   * 列挙で取れなければ null。
   */
  readonly deviceSerial: string | null
  readonly deviceDescription: string
  /** grub.cfg 等のインプレース改変。オフセットと base64 のデータ。 */
  readonly patches: readonly { readonly offset: number; readonly data: string; readonly label: string }[]
  /** CIDATA に入れるファイル。内容は base64。 */
  readonly seedFiles: readonly { readonly name: string; readonly content: string }[]
  readonly cidataSizeBytes: number
  readonly hideIsoPartitionFromWindows: boolean
  readonly verify: boolean
  /** 再現性のための固定値 */
  readonly timestampIso: string
  readonly randomSeedBase64: string
  /** 進捗の送信先 */
  readonly reportPort: number
  readonly reportToken: string
}

export type WorkerMessage =
  | { readonly type: 'hello'; readonly jobId: string; readonly pid: number }
  | {
      readonly type: 'progress'
      readonly jobId: string
      readonly phase: string
      readonly bytesDone: number
      readonly bytesTotal: number
      /** いま何を書いているか。訳さずに運ぶ（`WriteProgress.label` と同じもの）。 */
      readonly label: LocalizedText
      readonly bytesPerSecond: number | null
      readonly etaSeconds: number | null
    }
  | {
      readonly type: 'done'
      readonly jobId: string
      readonly digest: string
      readonly bytesWritten: number
      readonly verified: boolean
      readonly elapsedMs: number
    }
  | {
      readonly type: 'error'
      readonly jobId: string
      /**
       * 画面に出す総括。訳さずに運ぶ（`WriteStatus.error.message` にそのまま入る）。
       * 総括を持たない例外（素の `Error`）では送り手が汎用のキーに落とす。
       */
      readonly message: LocalizedText
      readonly name: string
      /**
       * 開発者向けの生の詳細（stack など。**日本語のまま**）。
       * `@autoinstall/media` の例外は `Error.message` に生の値つきの日本語を残すので、
       * stack の 1 行目としてここに入る。等幅で出す前提。
       */
      readonly detail: string | null
    }
  | {
      readonly type: 'log'
      readonly jobId: string
      readonly level: 'info' | 'warn'
      /** 準備中の 1 行として画面に出る。訳さずに運ぶ。 */
      readonly text: LocalizedText
    }

export type ControlMessage = { readonly type: 'cancel'; readonly jobId: string }

/** NDJSON の 1 行を作る。 */
export function encodeMessage(msg: WorkerMessage | ControlMessage, token: string): string {
  return `${JSON.stringify({ token, ...msg })}\n`
}

/** 受信バッファから完全な行だけを取り出す（部分受信に対応）。 */
export function decodeMessages(
  buffer: string,
  expectedToken: string,
): { messages: (WorkerMessage | ControlMessage)[]; rest: string } {
  const messages: (WorkerMessage | ControlMessage)[] = []
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as { token?: string } & Record<string, unknown>
      // トークンが一致しないメッセージは黙って捨てる（ポートを他プロセスに握られた場合の防御）
      if (parsed.token !== expectedToken) continue
      const { token: _ignored, ...msg } = parsed
      messages.push(msg as WorkerMessage | ControlMessage)
    } catch {
      // 壊れた行は捨てる
    }
  }
  return { messages, rest }
}
