// ウィザードの骨格。
//
// 版組は左に段（240px）、右に内容の 2 段組み。上端は枠なしウィンドウの
// 自前タイトルバー。段の遷移は `key` を変えて `.step` のアニメーションを
// 走らせる（React に作り直させるので、前の段の状態が残らない）。
//
// **文言は 1 つも直書きしない**（`shared/labels.ts` を引く）。
// これは `labels.test.ts` が機械で数える。

import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import type {
  InstallProgress,
  InstallResult,
  InstallerInfo,
} from '../../shared/protocol.js'
import type { Locale } from '../../shared/labels.js'
import { LocaleContext, useT } from './i18n.js'
import { TitleBar } from './components/TitleBar.js'
import { StepRail } from './components/StepRail.js'
import { Mark } from './components/Mark.js'
import { ConfirmModal } from './components/ui.js'
import { WelcomeStep } from './components/steps/Welcome.js'
import { OptionsStep, type OptionsValue } from './components/steps/Options.js'
import { ProgressStep } from './components/steps/Progress.js'
import { DoneStep } from './components/steps/Done.js'
import { UninstallConfirmStep } from './components/steps/UninstallConfirm.js'

type InstallStep = 'welcome' | 'options' | 'progress' | 'done'
type UninstallStep = 'confirm' | 'progress' | 'done'

export function App(): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>('ja')
  const [info, setInfo] = useState<InstallerInfo | null>(null)

  useEffect(() => {
    void window.installer.locale().then(setLocale)
    void window.installer.info().then(setInfo)
  }, [])

  return (
    <LocaleContext.Provider value={locale}>
      <Ambient />
      {info === null ? <Booting /> : <Shell info={info} />}
    </LocaleContext.Provider>
  )
}

/** 背景の気配。動かすのは transform と opacity だけ（`styles.css` を参照）。 */
function Ambient(): React.JSX.Element {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="orb orb-indigo" />
      <div className="orb orb-sky" />
      <div className="grid-veil" />
    </div>
  )
}

function Booting(): React.JSX.Element {
  const t = useT()
  return (
    <div className="relative z-10 flex h-screen w-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-sm text-white/55">
        <Mark size={48} glow />
        <span className="inline-flex items-center gap-2">
          <span className="spinner" />
          {t('common.loading')}
        </span>
      </div>
    </div>
  )
}

function Shell({ info }: { readonly info: InstallerInfo }): React.JSX.Element {
  const t = useT()
  // `--uninstall` で起動されたか、ようこそ画面で「アンインストール」を選んだか。
  const [uninstalling, setUninstalling] = useState(info.uninstallMode)
  return (
    <div className="relative z-10 flex h-screen flex-col">
      <TitleBar
        title={info.productName}
        subtitle={uninstalling ? t('app.uninstall') : t('app.setup')}
        onClose={() => void window.installer.close()}
        onMinimize={() => void window.installer.minimize()}
      />
      <div className="grid flex-1 grid-cols-[240px_1fr] overflow-hidden">
        <Boundary>
          {uninstalling ? (
            <UninstallFlow info={info} />
          ) : (
            <InstallFlow info={info} onUninstall={() => setUninstalling(true)} />
          )}
        </Boundary>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// インストール
// ---------------------------------------------------------------------------

function InstallFlow({
  info,
  onUninstall,
}: {
  readonly info: InstallerInfo
  readonly onUninstall: () => void
}): React.JSX.Element {
  const t = useT()
  const [step, setStep] = useState<InstallStep>('welcome')
  const [options, setOptions] = useState<OptionsValue>({
    installDir: info.defaultInstallDir,
    // **`undefined` を既定に使わない**（規約）。ここで明示的に決める。
    desktopShortcut: true,
    startMenuShortcut: true,
    launchAfter: true,
  })
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [result, setResult] = useState<InstallResult | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => window.installer.onProgress(setProgress), [])

  const start = useCallback(() => {
    setProgress(null)
    setResult(null)
    setStep('progress')
    void window.installer.start(options).then((r) => {
      setResult(r)
      setStep('done')
      // 「終わったら起動する」を選んでいたら、そのまま起動して閉じる。
      if (r.kind === 'ok' && options.launchAfter) {
        void window.installer.launchAndExit(r.exePath)
      }
    })
  }, [options])

  const steps = [
    { key: 'welcome', label: t('rail.welcome') },
    { key: 'options', label: t('rail.options') },
    { key: 'progress', label: t('rail.progress') },
    { key: 'done', label: t('rail.done') },
  ]

  return (
    <>
      <Rail steps={steps} current={step} />
      <main className="overflow-y-auto px-10 py-8" key={step}>
        {step === 'welcome' ? (
          <WelcomeStep
            info={info}
            onNext={() => setStep('options')}
            onUninstall={info.installedAt === null ? null : onUninstall}
          />
        ) : null}
        {step === 'options' ? (
          <OptionsStep
            info={info}
            value={options}
            onChange={setOptions}
            onBack={() => setStep('welcome')}
            onStart={start}
          />
        ) : null}
        {step === 'progress' ? (
          <ProgressStep
            title={t('progress.title')}
            progress={progress}
            onCancel={() => setConfirmCancel(true)}
          />
        ) : null}
        {step === 'done' && result !== null ? (
          <DoneStep
            result={result}
            uninstallMode={false}
            launchByDefault={options.launchAfter}
            onLaunch={(exe) => void window.installer.launchAndExit(exe)}
            onClose={() => void window.installer.close()}
          />
        ) : null}
      </main>

      <ConfirmModal
        open={confirmCancel}
        title={t('progress.confirm.title')}
        body={t('progress.confirm.body')}
        confirmLabel={t('progress.confirm.ok')}
        cancelLabel={t('progress.confirm.no')}
        onConfirm={() => {
          setConfirmCancel(false)
          void window.installer.cancel()
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// アンインストール
// ---------------------------------------------------------------------------

function UninstallFlow({ info }: { readonly info: InstallerInfo }): React.JSX.Element {
  const t = useT()
  const [step, setStep] = useState<UninstallStep>('confirm')
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [result, setResult] = useState<InstallResult | null>(null)

  useEffect(() => window.installer.onProgress(setProgress), [])

  const steps = [
    { key: 'confirm', label: t('rail.uninstallConfirm') },
    { key: 'progress', label: t('rail.uninstallProgress') },
    { key: 'done', label: t('rail.uninstallDone') },
  ]

  const run = (): void => {
    setProgress(null)
    setStep('progress')
    void window.installer.uninstall().then((r) => {
      setResult(r)
      setStep('done')
    })
  }

  return (
    <>
      <Rail steps={steps} current={step} />
      <main className="overflow-y-auto px-10 py-8" key={step}>
        {step === 'confirm' ? (
          <UninstallConfirmStep
            info={info}
            installDir={info.defaultInstallDir}
            onRun={run}
            onClose={() => void window.installer.close()}
          />
        ) : null}
        {step === 'progress' ? (
          // **消し始めたら戻れない**ので中止は出さない。
          <ProgressStep
            title={t('uninstall.progress.title')}
            progress={progress}
            onCancel={null}
          />
        ) : null}
        {step === 'done' && result !== null ? (
          <DoneStep
            result={result}
            uninstallMode
            launchByDefault={false}
            onLaunch={() => {}}
            onClose={() => void window.installer.close()}
          />
        ) : null}
      </main>
    </>
  )
}

function Rail({
  steps,
  current,
}: {
  readonly steps: readonly { key: string; label: string }[]
  readonly current: string
}): React.JSX.Element {
  return (
    <aside className="flex flex-col border-r border-white/5 px-6 py-8">
      <StepRail steps={steps} current={current} />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// 描画中の例外でウィンドウが白くならないようにする（落とし穴 60）
// ---------------------------------------------------------------------------

interface BoundaryState {
  readonly message: string | null
}

class Boundary extends Component<{ readonly children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children
    // ここは**開発者向け**。訳文を持たないのは意図的で、
    // ここに来た時点で辞書が引ける保証が無い。
    return (
      <div className="col-span-2 flex items-center justify-center p-10">
        <pre className="card max-w-lg p-4 font-mono text-[12px] whitespace-pre-wrap text-rose-200/80 select-text">
          {this.state.message}
        </pre>
      </div>
    )
  }
}
