// 最初の画面。**このツールが何をするものかを 3 つで言い切る。**
//
// インストーラの最初の段は「次へ」を押すだけの空白になりがちなので、
// ここでアプリの考え方（ISO を壊さない／危ないディスクを出さない／
// 昇格は書き込みだけ）を出しておく。

import type { InstallerInfo } from '../../../../shared/protocol.js'
import { useT } from '../../i18n.js'
import { Mark } from '../Mark.js'
import { ArrowRight, Button } from '../ui.js'

interface Props {
  readonly info: InstallerInfo
  readonly onNext: () => void
  /** 既にインストールされているときだけ出す出口。`null` なら出さない。 */
  readonly onUninstall: (() => void) | null
}

export function WelcomeStep({ info, onNext, onUninstall }: Props): React.JSX.Element {
  const t = useT()
  const features = [
    { key: 'f1', icon: <IsoIcon /> },
    { key: 'f2', icon: <ShieldIcon /> },
    { key: 'f3', icon: <KeyIcon /> },
  ] as const

  return (
    <div className="step flex h-full flex-col">
      <div className="stagger flex flex-col">
        <div className="flex items-center gap-4">
          <Mark size={56} glow animateArrow />
          <div>
            <h1 className="gradient-text text-[27px] leading-tight font-semibold tracking-tight">
              {t('welcome.title')}
            </h1>
            <p className="mt-1 text-sm text-white/55">{t('welcome.tagline')}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-white/60">
            {t('welcome.version', { version: info.version })}
          </span>
          <span
            data-experimental-badge
            className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200/90"
          >
            {t('welcome.experimental')}
          </span>
          {info.installedAt !== null ? (
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200/90">
              {t('welcome.upgrade', { version: info.version })}
            </span>
          ) : null}
        </div>

        <div className="hairline mt-4" />

        <div className="mt-4 grid gap-2.5">
          {features.map((f) => (
            <div key={f.key} className="card flex items-start gap-3.5 px-4 py-3.5">
              <span className="mt-0.5 text-indigo-300/90">{f.icon}</span>
              <div>
                <div className="text-sm font-semibold text-white/90">
                  {t(`welcome.${f.key}.title`)}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-white/50">
                  {t(`welcome.${f.key}.body`)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* 実験的であること・ライセンス・「Canonical とは無関係」（docs/LEGAL.md）。
            インストーラだけを受け取った人にも届くように */}
        <p className="mt-4 text-[11px] leading-relaxed text-white/40">
          <span className="text-amber-200/80">{t('welcome.experimentalNote')}</span>{' '}
          {t('welcome.disclaimer')}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between pt-5">
        {/* 「プログラムと機能」からは uninstall.ps1 が黙って走るので、
            画面つきで消したい人のための出口をここに置く。 */}
        {onUninstall !== null ? (
          <Button tone="ghost" onClick={onUninstall}>
            {t('welcome.uninstall')}
          </Button>
        ) : (
          <span />
        )}
        <Button tone="primary" onClick={onNext} autoFocus>
          {t('welcome.next')}
          <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

function IsoIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function ShieldIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5l6 2.2v4.6c0 3.6-2.4 6.6-6 8.2-3.6-1.6-6-4.6-6-8.2V4.7l6-2.2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.4 10.1l1.9 1.9 3.4-3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function KeyIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="8.5"
        width="14"
        height="8.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M6.5 8.5V6a3.5 3.5 0 017 0v2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
