// 最後の画面。成功・中止・失敗の 3 通りを 1 つのコンポーネントで出す。
//
// **失敗は理由の判別子から 1 対 1 で文言を引く**（総称に潰さない。落とし穴 77）。
// 診断（`detail`）は訳さない生の文字列なので、等幅の折りたたみに入れる。

import { useState } from 'react'
import type { FailureReason, InstallResult } from '../../../../shared/protocol.js'
import type { LabelKey } from '../../../../shared/labels.js'
import { useT } from '../../i18n.js'
import { Mark } from '../Mark.js'
import { Button } from '../ui.js'

/** `satisfies` が網羅を守る。理由が増えたらここが落ちる。 */
const FAIL_LABEL = {
  'no-space': 'fail.no-space',
  'dir-not-writable': 'fail.dir-not-writable',
  'dir-invalid': 'fail.dir-invalid',
  'payload-missing': 'fail.payload-missing',
  'extract-failed': 'fail.extract-failed',
  'shortcut-failed': 'fail.shortcut-failed',
  'registry-failed': 'fail.registry-failed',
  unknown: 'fail.unknown',
} satisfies Record<FailureReason, LabelKey>

interface Props {
  readonly result: InstallResult
  /** アンインストールの完了画面では見出しが変わる。 */
  readonly uninstallMode: boolean
  readonly onLaunch: (exePath: string) => void
  readonly onClose: () => void
  readonly launchByDefault: boolean
}

export function DoneStep({
  result,
  uninstallMode,
  onLaunch,
  onClose,
  launchByDefault,
}: Props): React.JSX.Element {
  const t = useT()
  const [openDetail, setOpenDetail] = useState(false)

  const tone =
    result.kind === 'ok' ? 'ok' : result.kind === 'cancelled' ? 'cancelled' : 'failed'

  const title =
    result.kind === 'ok'
      ? uninstallMode
        ? t('uninstall.done.title')
        : t('done.ok.title')
      : result.kind === 'cancelled'
        ? t('done.cancelled.title')
        : uninstallMode
          ? t('uninstall.failed.title')
          : t('done.failed.title')

  const lead =
    result.kind === 'ok'
      ? uninstallMode
        ? t('uninstall.done.lead')
        : t('done.ok.lead')
      : result.kind === 'cancelled'
        ? t('done.cancelled.lead')
        : // **片付けを走らせたときだけ「削除しました」と言う**（落とし穴 50）。
          result.rolledBack
          ? t('done.failed.lead')
          : t('done.failedNoChange.lead')

  return (
    <div className="step flex h-full flex-col">
      <div className="stagger flex flex-1 flex-col items-center justify-center text-center">
        <StatusBadge tone={tone} />

        <h2 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">{lead}</p>

        {result.kind === 'failed' ? (
          <p className="mt-3 max-w-md text-sm leading-relaxed text-rose-200/90">
            {t(FAIL_LABEL[result.reason])}
          </p>
        ) : null}

        {result.kind === 'ok' && !uninstallMode ? (
          <div className="card mt-6 w-full max-w-md px-4 py-3 text-left">
            <div className="text-[11px] font-semibold tracking-wide text-white/40 uppercase">
              {t('done.ok.where')}
            </div>
            <div className="mt-1 font-mono text-[12px] break-all text-white/70 select-text">
              {result.installDir}
            </div>
          </div>
        ) : null}

        {result.kind === 'failed' && result.detail !== '' ? (
          <div className="mt-5 w-full max-w-md text-left">
            <button
              type="button"
              onClick={() => setOpenDetail((v) => !v)}
              className="text-[12px] text-white/45 underline decoration-white/20 underline-offset-4 hover:text-white/80"
            >
              {t('done.detail')}
            </button>
            {openDetail ? (
              <pre className="card mt-2 max-h-40 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-white/60 select-text">
                {result.detail}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-end gap-2 pt-6">
        <Button tone="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
        {result.kind === 'ok' && !uninstallMode ? (
          <Button
            tone="primary"
            onClick={() => onLaunch(result.exePath)}
            autoFocus={launchByDefault}
          >
            {t('done.launch')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function StatusBadge({ tone }: { readonly tone: 'ok' | 'cancelled' | 'failed' }): React.JSX.Element {
  if (tone === 'ok') {
    return (
      <div className="relative">
        <Mark size={64} glow />
        <span className="absolute -right-1.5 -bottom-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0b1020] bg-emerald-400 text-[#062015]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 7.4l2.8 2.8L11 4.8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    )
  }
  const isFail = tone === 'failed'
  return (
    <span
      className={
        'inline-flex h-16 w-16 items-center justify-center rounded-2xl border ' +
        (isFail
          ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
          : 'border-white/10 bg-white/5 text-white/50')
      }
    >
      {isFail ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 7v6M12 16.5v.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ) : (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </span>
  )
}
