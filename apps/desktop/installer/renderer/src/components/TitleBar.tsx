// 枠なしウィンドウの上端。帯全体がドラッグ領域で、右のボタンだけ除く。
//
// 出すのは最小化と閉じるだけ。ウィザードは大きさを変えられない
// （段ごとの版組を固定幅で作っているので、広げても得が無い）。

import { useT } from '../i18n.js'
import { Mark } from './Mark.js'

interface Props {
  readonly title: string
  readonly subtitle?: string
  readonly onClose: () => void
  readonly onMinimize: () => void
}

export function TitleBar({ title, subtitle, onClose, onMinimize }: Props): React.JSX.Element {
  const t = useT()
  return (
    <header className="drag relative z-10 flex h-12 items-center border-b border-white/5 px-4">
      <div className="flex items-center gap-2.5 text-sm">
        <Mark size={18} />
        <span className="font-semibold tracking-wide text-white/90">{title}</span>
        {subtitle !== undefined && subtitle !== '' ? (
          <>
            <span className="text-white/25">/</span>
            <span className="text-white/50">{subtitle}</span>
          </>
        ) : null}
      </div>
      <div className="no-drag ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onMinimize}
          aria-label={t('common.minimize')}
          title={t('common.minimize')}
          className="inline-flex h-7 w-9 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="6" width="8" height="1.5" rx="0.75" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="inline-flex h-7 w-9 items-center justify-center rounded-md text-white/55 hover:bg-rose-500/80 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
