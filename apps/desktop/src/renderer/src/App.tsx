import { useEffect } from 'react'
import { Check, ChevronLeft, ChevronRight, Disc3, Languages } from 'lucide-react'
import type { MsgKey } from '@autoinstall/shared'
import { STEP_ORDER, useStore, type StepId } from './store.js'
import { useT } from './lib/i18n.js'
import { Button, Callout } from './components/ui.js'
import { ProfileBar } from './views/ProfileBar.js'
import { IsoStep } from './views/IsoStep.js'
import { BasicsStep } from './views/BasicsStep.js'
import { UserStep } from './views/UserStep.js'
import { NetworkStep } from './views/NetworkStep.js'
import { StorageStep } from './views/StorageStep.js'
import { RuntimeStep } from './views/RuntimeStep.js'
import { SoftwareStep } from './views/SoftwareStep.js'
import { PostInstallStep } from './views/PostInstallStep.js'
import { ReviewStep } from './views/ReviewStep.js'
import { WriteStep } from './views/WriteStep.js'

const STEP_LABELS: Record<StepId, MsgKey> = {
  iso: 'step.iso',
  basics: 'step.basics',
  user: 'step.user',
  network: 'step.network',
  storage: 'step.storage',
  runtime: 'step.runtime',
  software: 'step.software',
  postinstall: 'step.postinstall',
  review: 'step.review',
  write: 'step.write',
}

const STEP_VIEWS: Record<StepId, () => React.JSX.Element> = {
  iso: IsoStep,
  basics: BasicsStep,
  user: UserStep,
  network: NetworkStep,
  storage: StorageStep,
  runtime: RuntimeStep,
  software: SoftwareStep,
  postinstall: PostInstallStep,
  review: ReviewStep,
  write: WriteStep,
}

export function App(): React.JSX.Element {
  const t = useT()
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const step = useStore((s) => s.step)
  const setStep = useStore((s) => s.setStep)
  const iso = useStore((s) => s.iso)
  const config = useStore((s) => s.config)
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  const writeStatus = useStore((s) => s.writeStatus)
  const profileNotes = useStore((s) => s.profileNotes)
  const dismissProfileNotes = useStore((s) => s.dismissProfileNotes)

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </div>
    )
  }

  const index = STEP_ORDER.indexOf(step)
  const View = STEP_VIEWS[step]
  const writing = writeStatus.state === 'preparing' || writeStatus.state === 'writing'
  // ISO を選ぶまでは先に進めない。設定にエラーがあるうちは書き込み画面に入れない。
  const canGoNext =
    index < STEP_ORDER.length - 1 &&
    !writing &&
    (step !== 'iso' || iso !== null) &&
    (step !== 'review' || config?.ok === true)

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2.5">
          <Disc3 className="size-5 text-sky-600" aria-hidden />
          <div>
            <h1 className="text-sm font-semibold leading-tight">{t('app.name')}</h1>
            <p className="text-xs leading-tight text-slate-500 dark:text-slate-400">{t('app.tagline')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ProfileBar />
          {iso !== null && (
            <span className="hidden truncate text-xs text-slate-500 sm:block dark:text-slate-400">
              Ubuntu Server {iso.identity.version} {iso.identity.arch}
            </span>
          )}
          <button
            onClick={() => void setLocale(locale === 'ja' ? 'en' : 'ja')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Languages className="size-3.5" aria-hidden />
            {locale === 'ja' ? 'English' : '日本語'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <ol className="space-y-1">
            {STEP_ORDER.map((id, i) => {
              const done = i < index
              const current = id === step
              // 書き込み中はステップ移動を禁じる（設定が変わると危険なため）
              const reachable = !writing && (i <= index || iso !== null)
              return (
                <li key={id}>
                  <button
                    disabled={!reachable}
                    onClick={() => setStep(id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      current
                        ? 'bg-sky-100 font-medium text-sky-900 dark:bg-sky-900/60 dark:text-sky-100'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        done
                          ? 'bg-emerald-500 text-white'
                          : current
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      }`}
                    >
                      {done ? <Check className="size-3" aria-hidden /> : i + 1}
                    </span>
                    <span className="truncate">{t(STEP_LABELS[id])}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 p-6">
            {profileNotes.length > 0 && (
              <Callout tone="info" title={t('profile.migrated')}>
                <ul className="list-inside list-disc">
                  {profileNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <button
                  onClick={dismissProfileNotes}
                  className="mt-2 text-xs text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                >
                  {t('common.close')}
                </button>
              </Callout>
            )}
            <View />
          </div>
        </main>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
        <Button
          onClick={() => setStep(STEP_ORDER[index - 1]!)}
          disabled={index === 0 || writing}
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t('common.back')}
        </Button>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {index + 1} / {STEP_ORDER.length}
        </p>
        <Button
          variant="primary"
          onClick={() => setStep(STEP_ORDER[index + 1]!)}
          disabled={!canGoNext}
        >
          {t('common.next')}
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </footer>
    </div>
  )
}
