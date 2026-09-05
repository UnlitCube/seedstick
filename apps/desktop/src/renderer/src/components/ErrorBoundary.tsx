import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * 画面が白くなるのを防ぐ。
 *
 * renderer に Error Boundary が 1 つも無かったため、描画中の例外がそのまま
 * ウィンドウを白くしていた。プロファイル JSON は手で編集できるし、
 * 別バージョンのツールで保存されたものも開ける。`software.snaps: [null]` のような
 * 「型は合っているのに中身が違う」データが 1 つあるだけで、
 * 利用者は理由の分からない白い画面を見ることになる（CLAUDE.md 落とし穴 23）。
 *
 * ここで受け止めて、何が起きたかと次にできることを出す。
 */
interface Props {
  readonly children: ReactNode
  /** 「この画面をやり直す」で呼ぶ。プロファイルを既定に戻すなど。 */
  readonly onReset?: () => void
}

interface State {
  readonly error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // main 側のログにも残す。白画面のままだと利用者からは何も分からない。
    console.error('画面の描画に失敗しました', error, info.componentStack)
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 dark:border-rose-800 dark:bg-rose-950/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
          <div className="min-w-0 space-y-3">
            <h2 className="text-base font-semibold text-rose-900 dark:text-rose-200">
              この画面を表示できませんでした
            </h2>
            <p className="text-sm text-rose-800 dark:text-rose-300">
              設定の内容が想定と違うため、画面の描画に失敗しました。
              手で編集したプロファイルや、別のバージョンで保存されたプロファイルを開くと
              起こることがあります。
            </p>
            <pre className="max-h-40 overflow-auto rounded-lg bg-white/70 p-3 font-mono text-xs text-rose-900 dark:bg-slate-900/60 dark:text-rose-200">
              {error.message}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.reset}
                className="inline-flex items-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
              >
                もう一度表示する
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-800 transition hover:bg-rose-50 dark:border-rose-700 dark:bg-slate-800 dark:text-rose-200"
              >
                アプリを読み込み直す
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
