// 左の縦の段。いまどこにいるかだけを示す。**押しても移動しない**
// （進捗の途中に戻れる段は無いので、押せるように見せない）。

interface RailStep {
  readonly key: string
  readonly label: string
}

interface Props {
  readonly steps: readonly RailStep[]
  readonly current: string
}

export function StepRail({ steps, current }: Props): React.JSX.Element {
  const index = steps.findIndex((s) => s.key === current)

  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const state = i < index ? 'done' : i === index ? 'active' : 'pending'
        return (
          <li key={step.key} className="flex min-h-[46px] items-stretch gap-3">
            <div className="flex flex-col items-center">
              <span
                className="rail-dot"
                data-state={state}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                {state === 'done' ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6.5l2.5 2.5 4.5-5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {i < steps.length - 1 ? (
                <span className="rail-line" data-state={state === 'done' ? 'done' : 'pending'} />
              ) : null}
            </div>
            <div
              className={
                'pt-1 pb-3 text-sm ' +
                (state === 'active'
                  ? 'font-semibold text-white'
                  : state === 'done'
                    ? 'text-emerald-300/80'
                    : 'text-white/40')
              }
            >
              {step.label}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
