import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Disc3, Info, Languages } from 'lucide-react'
import { isLocale, LOCALE_META, LOCALES } from '@autoinstall/shared'
import { STEP_GROUPS, STEP_LABELS, STEP_ORDER, useStore, type StepId } from './store.js'
import { useT, useTl } from './lib/i18n.js'
import { summarizeStep } from './lib/summary.js'
import { Button, Callout } from './components/ui.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { AboutDialog } from './components/AboutDialog.js'
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
  // 移行の notes は訳す前の LocalizedText で届く（main は利用者の言語を知らない）
  const tl = useTl()
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const step = useStore((s) => s.step)
  const setStep = useStore((s) => s.setStep)
  const iso = useStore((s) => s.iso)
  // サイドバーの 1 行要約はプロファイルから導く（純粋関数なので描画のたびに作る）
  const profile = useStore((s) => s.profile)
  const config = useStore((s) => s.config)
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  const [aboutOpen, setAboutOpen] = useState(false)
  const writeStatus = useStore((s) => s.writeStatus)
  const profileNotes = useStore((s) => s.profileNotes)
  const dismissProfileNotes = useStore((s) => s.dismissProfileNotes)
  // プロファイルを丸ごと差し替えた回数。画面の `key` に混ぜて作り直す理由は下記。
  const profileGeneration = useStore((s) => s.profileGeneration)

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
          {/*
            言語は**その言語自身での名前**で並べる（English の利用者が「日本語」を
            読めなくても、日本語の利用者は「日本語」を探せる）。名前は locales.ts の表から引き、
            訳さない。e2e は data-locale の値で言語を読み書きする（表示文言に頼らない）。
          */}
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-300">
            <Languages className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">{t('common.language')}</span>
            <select
              data-locale
              value={locale}
              onChange={(e) => {
                if (isLocale(e.target.value)) void setLocale(e.target.value)
              }}
              className="bg-transparent py-0.5 text-xs outline-none"
              title={t('common.language')}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={LOCALE_META[l].htmlLang}>
                  {LOCALE_META[l].endonym}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            aria-label={t('about.open')}
            title={t('about.open')}
            className="rounded-lg border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <div className="flex min-h-0 flex-1">
        {/*
          サイドバーは 4 つのグループに分ける。
          「必ず設定する」を通り終えれば、残りは既定のままでも動く——という道筋を
          見出しそのもので示す。**番号は全体の通し番号のまま**にする
          （グループごとに 1 から振り直すと、いま全体の何番目かが分からなくなる）。
          到達可能性の規則は変えていない（`STEP_ORDER` 上の位置で決める）。
        */}
        <nav className="w-64 shrink-0 space-y-4 overflow-y-auto border-r border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          {STEP_GROUPS.map((group) => (
            <section key={group.id}>
              <h2 className="px-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t(group.title)}
              </h2>
              <p className="px-2 pb-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {t(group.hint)}
              </p>
              <ol className="space-y-1">
                {group.steps.map((id) => {
                  const i = STEP_ORDER.indexOf(id)
                  const done = i < index
                  const current = id === step
                  // 書き込み中はステップ移動を禁じる（設定が変わると危険なため）
                  const reachable = !writing && (i <= index || iso !== null)
                  // 折りたたんだ先が何になっているか分からないのは、
                  // 折りたたまないより悪い。いまの設定を 1 行で出す。
                  const summary = summarizeStep(id, profile)
                  const summaryText = summary === null ? '' : tl(summary)
                  return (
                    <li key={id}>
                      <button
                        disabled={!reachable}
                        onClick={() => setStep(id)}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          current
                            ? 'bg-sky-100 font-medium text-sky-900 dark:bg-sky-900/60 dark:text-sky-100'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                            done
                              ? 'bg-emerald-500 text-white'
                              : current
                                ? 'bg-sky-600 text-white'
                                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                          }`}
                        >
                          {done ? <Check className="size-3" aria-hidden /> : i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{t(STEP_LABELS[id])}</span>
                          {summaryText !== '' && (
                            // 幅に収まらない要約は切るが、title で全文が読める。
                            <span
                              title={summaryText}
                              className="mt-0.5 block truncate text-[11px] font-normal text-slate-500 dark:text-slate-400"
                            >
                              {summaryText}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 p-6">
            {profileNotes.length > 0 && (
              <Callout tone="info" title={t('profile.migrated')}>
                <ul className="list-inside list-disc">
                  {profileNotes.map((n, i) => (
                    <li key={`${n.key}-${i}`}>{tl(n)}</li>
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
            {/*
              画面ごとに囲む。1 つのステップが落ちても他のステップへ移動でき、
              白画面にはしない（プロファイルは手で編集できるので、
              「型は合っているが中身が違う」データは実際に届く）。
              key を step にしておくと、別のステップへ移ったときに自動で復帰する。

              key には **プロファイルの世代** も混ぜる。画面の中には
              「開いた時点の設定」から初期値を決めるものがあり（`Disclosure` の
              開閉が代表）、`profile` を差し替えただけでは作り直されない。
              `Disclosure` は件数が 0 をまたいだときに開き直すが、
              **件数が同じなら**（2 件のプロファイルを閉じて、別の 2 件の
              プロファイルを開く）何も起きず、設定が折りたたみの中に隠れる。
              世代は丸ごと差し替えた 3 か所でしか増えないので、
              ただの編集で作り直されることはない（下書きは消えない）。
            */}
            <ErrorBoundary key={`${step}:${profileGeneration}`}>
              <View />
            </ErrorBoundary>
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
