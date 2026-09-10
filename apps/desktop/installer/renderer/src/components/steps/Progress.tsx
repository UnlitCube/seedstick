// 展開中の画面。
//
// 段の名前は `phase`（判別子）で届くので、ここで 1 対 1 に訳す
// （main に日本語を持たせない。落とし穴 78）。
// **割合が出ていない間は不定形の帯**にする。0% で止まって見えるより正しい。

import type { InstallProgress, ProgressPhase } from '../../../../shared/protocol.js'
import type { LabelKey } from '../../../../shared/labels.js'
import { useT } from '../../i18n.js'
import { Button } from '../ui.js'

/** `satisfies` で全部の段を網羅させる（増えたときに落ちる）。 */
const PHASE_LABEL = {
  preparing: 'phase.preparing',
  extracting: 'phase.extracting',
  shortcuts: 'phase.shortcuts',
  registering: 'phase.registering',
  cleaning: 'phase.cleaning',
  finished: 'phase.finished',
} satisfies Record<ProgressPhase, LabelKey>

interface Props {
  readonly title: string
  readonly progress: InstallProgress | null
  /** アンインストール中は中止できない（消し始めたら戻れない）。 */
  readonly onCancel: (() => void) | null
}

export function ProgressStep({ title, progress, onCancel }: Props): React.JSX.Element {
  const t = useT()
  const ratio = progress?.ratio ?? null
  const indeterminate = ratio === null || progress === null
  const pct = ratio === null ? 0 : Math.max(0, Math.min(100, Math.round(ratio * 100)))
  const running = progress === null || progress.phase !== 'finished'

  return (
    <div className="step flex h-full flex-col">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-sm text-white/55">{t('progress.lead')}</p>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-2.5 text-white/80">
              {running ? <span className="spinner" /> : null}
              {t(PHASE_LABEL[progress?.phase ?? 'preparing'])}
            </span>
            <span className="font-mono text-white/55 tabular-nums">{pct}%</span>
          </div>

          <div className="track">
            <div
              className="fill"
              data-indeterminate={indeterminate ? 'true' : 'false'}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-3 min-h-[16px] font-mono text-[12px] text-white/35">
            {progress?.files === undefined
              ? ''
              : t('progress.files', { count: progress.files })}
          </div>
        </div>
      </div>

      <div className="mt-auto flex justify-end pt-6">
        {onCancel !== null ? (
          <Button tone="ghost" onClick={onCancel} disabled={!running}>
            {t('progress.cancel')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
