import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Info, X } from 'lucide-react'
import { useT } from '../lib/i18n.js'

// 画面共通の部品。
// 大きな面には backdrop-blur を使わない（塗る面積に比例して GPU 負荷が上がり、
// 全画面表示や進捗バー更新中に顕著に重くなる）。ぼかしはモーダルの覆いだけに限定する。

/**
 * カンマ／改行区切りの複数値を、制御コンポーネントで編集するための下書き。
 *
 * `value={list.join(', ')}` と `onChange={split → trim → filter(Boolean)}` を
 * そのまま組み合わせると、**区切り文字を打った瞬間に消える**。
 * 「1.1.1.1」まで打って `,` を足しても、正規化すると打つ前と同じ配列に戻るので
 * value prop が変わらず、React が DOM の値を元へ書き戻すため。
 * 貼り付け（一度に全体が変わる）は動くが、キーボードでは 2 個目を足せない。
 *
 * 入力中の生テキストを下書きとして保持し、配列は下書きから導く。
 * プロファイルを開くなど**外から値が変わったとき**だけ下書きを作り直す。
 */
export function useListDraft(
  values: readonly string[],
  separator: ',' | '\n',
): { text: string; change: (next: string) => string[] } {
  const joiner = separator === ',' ? ', ' : '\n'
  return useDraft<string[]>(
    [...values],
    (list) => list.join(joiner),
    (text) =>
      text
        .split(separator)
        .map((v) => v.trim())
        .filter(Boolean),
  )
}

/**
 * 「正規化した値」を編集する制御コンポーネントのための下書き。
 *
 * `value` を state から毎回作り直すと、**まだ正規化を通らない途中の入力**が
 * 打った瞬間に消える。区切り文字がその代表（`useListDraft` のコメント参照）だが、
 * 空白区切りのパッケージ名、行ごとに構造へ解釈する snaps なども同じ。
 * 貼り付け（一度に全体が変わる）は動くので、テストでも見落としやすい。
 *
 * 入力中の生テキストを保持し、値は下書きから導く。
 * **外から値が変わったとき**（プロファイルを開く、リセット）だけ作り直す。
 */
export function useDraft<T>(
  value: T,
  toText: (value: T) => string,
  parse: (text: string) => T,
): { text: string; change: (next: string) => T } {
  const canonical = toText(value)
  const [draft, setDraft] = useState(canonical)

  useEffect(() => {
    // 下書きを正規化した結果が今の値と同じなら、入力中なので触らない。
    // 違うなら外から差し替わったので作り直す。
    setDraft((cur) => (toText(parse(cur)) === canonical ? cur : canonical))
    // toText / parse は呼び出し側でインライン定義されるので依存に入れない
    // （毎レンダリング別物になり、effect が回り続ける）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical])

  return {
    text: draft,
    change: (next: string) => {
      setDraft(next)
      return parse(next)
    },
  }
}

export function Card({
  title,
  description,
  children,
  tone = 'default',
}: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  tone?: 'default' | 'warning' | 'danger'
}): React.JSX.Element {
  const border =
    tone === 'danger'
      ? 'border-rose-300 dark:border-rose-800'
      : tone === 'warning'
        ? 'border-amber-300 dark:border-amber-800'
        : 'border-slate-200 dark:border-slate-700'
  return (
    <section className={`rounded-xl border ${border} bg-white p-5 dark:bg-slate-800`}>
      {title !== undefined && (
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      )}
      {description !== undefined && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
      )}
      <div className={title !== undefined || description !== undefined ? 'mt-4' : ''}>{children}</div>
    </section>
  )
}

/**
 * 「詳しい設定」の折りたたみ。**インストーラが決して聞かないもの**をここへ入れる。
 *
 * `<details>` / `<summary>` は使わない。開閉の見た目を自分で制御したいのと、
 * `<summary>` の中に `<Badge>` のような要素を置いたときの扱いがブラウザで違うため。
 * `<button>` + `aria-expanded` + `aria-controls` で書くので、キーボードでも開閉できる
 * （`div` + `onClick` にすると Tab で到達できず Enter でも開かない）。
 *
 * **閉じているときは中身を描画しない**（`hidden` で残さない）。実際に両方作って
 * 試した結果は次のとおり:
 *
 *   - 描画しない … 閉じている間だけ `useListDraft` の下書きが消える。
 *     再び開くと「正規化した値」が出る（`1.1.1.1,` と打ちかけていたら `1.1.1.1`）。
 *     **確定した値は消えない**（`change()` の時点でプロファイルへ入っている）ので、
 *     失われるのは正規化を通らない途中の入力だけ。
 *   - `hidden` で残す … 下書きは保たれるが、閉じている画面の副作用（`useEffect`）と
 *     再描画が profile を触るたびに走り続け、**壊れた値で落ちるのも閉じたまま**になる。
 *     `postinstall` の「上級者向け」だけでコマンド 3 種・ファイル・ユーザー・展開・
 *     サービスが全部その対象になる。
 *
 * 後者の「閉じた画面のせいでステップ全体が Error Boundary に落ちる」ほうが
 * 実害が大きい（手で編集したプロファイルは実際に届く。落とし穴 23 / 60）ので、
 * 描画しないほうを採った。`aria-controls` が指す領域そのものは常に置いておく
 * （参照先が無い `aria-controls` は支援技術にとって壊れた参照になる）。
 */
export function Disclosure({
  title,
  description,
  changedCount = 0,
  defaultOpen,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  /** 既定から変わっている件数。0 なら Badge を出さない。 */
  changedCount?: number
  /**
   * 既定で開くか。省略すると **`changedCount > 0` なら開く**。
   * 保存済みプロファイルを開いたときに、設定したはずのものが隠れていると
   * 「消えた」と誤解される。省略時の既定はその事故が起きない側に倒してある。
   */
  defaultOpen?: boolean
  children: ReactNode
}): React.JSX.Element {
  const t = useT()
  const regionId = useId()
  const [open, setOpen] = useState(defaultOpen ?? changedCount > 0)

  // 閉じたまま「既定から変わった」状態になったら開く。
  // ステップを移動すると `App.tsx` の `key={step}` で作り直されるが、
  // **同じステップに居るままプロファイルを開いた**ときは作り直されないので、
  // ここが無いと変更が折りたたみの中に隠れる。
  // 依存はプリミティブだけにする（インラインのコールバックを入れない。落とし穴 59）。
  const hadChanges = useRef(changedCount > 0)
  useEffect(() => {
    const has = changedCount > 0
    if (has && !hadChanges.current) setOpen(true)
    hadChanges.current = has
  }, [changedCount])

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          // GUI の E2E ヘルパ（`.e2e/drive.mjs` の `openDisclosure`）が
          // **表示文言ではなくこの目印で**見出しを探す。訳文を変えるたびに
          // E2E が壊れるのを避けるため。見た目と振る舞いには影響しない。
          data-disclosure=""
          onClick={() => setOpen(!open)}
          className="flex w-full items-start gap-2.5 rounded-xl px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/50"
        >
          <ChevronRight
            className={`mt-0.5 size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </span>
              {changedCount > 0 && (
                <Badge tone="info">{t('nav.changedCount', { n: changedCount })}</Badge>
              )}
            </span>
            {description !== undefined && (
              <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">
                {description}
              </span>
            )}
          </span>
        </button>
      </h3>
      <div
        id={regionId}
        role="region"
        hidden={!open}
        className="border-t border-slate-200 px-5 py-4 dark:border-slate-700"
      >
        {open && children}
      </div>
    </section>
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: (id: string) => ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
        {label}
        {required && <span className="ml-1 text-rose-600 dark:text-rose-400">*</span>}
      </label>
      {children(id)}
      {hint !== undefined && !error && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
      {error !== undefined && (
        <p className="flex items-start gap-1 text-xs text-rose-600 dark:text-rose-400">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800'

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean },
): React.JSX.Element {
  const { invalid, className, ...rest } = props
  return (
    <input
      {...rest}
      className={`${INPUT_CLASS} ${invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/30' : ''} ${className ?? ''}`}
    />
  )
}

export function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
): React.JSX.Element {
  const { className, ...rest } = props
  return <textarea {...rest} className={`${INPUT_CLASS} font-mono ${className ?? ''}`} />
}

export function Select({
  value,
  onChange,
  options,
  id,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string; disabled?: boolean }[]
  id?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} appearance-none pr-9`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  tone = 'default',
  disabled,
}: {
  checked: boolean
  /** 必ず明示的な boolean を渡す。undefined を「既定」に使うと再有効化できなくなる。 */
  onChange: (value: boolean) => void
  label: ReactNode
  description?: ReactNode
  tone?: 'default' | 'warning'
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
        disabled
          ? 'cursor-not-allowed border-slate-200 opacity-60 dark:border-slate-700'
          : checked
            ? tone === 'warning'
              ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40'
              : 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40'
            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-sky-600"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
          {label}
          {tone === 'warning' && <AlertTriangle className="size-3.5 text-amber-600" aria-hidden />}
        </span>
        {description !== undefined && (
          <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{description}</span>
        )}
      </span>
    </label>
  )
}

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: ReactNode; description?: ReactNode; badge?: ReactNode }[]
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
            value === o.value
              ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'
          }`}
        >
          <input
            type="radio"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-0.5 size-4 shrink-0 accent-sky-600"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              {o.label}
              {o.badge}
            </span>
            {o.description !== undefined && (
              <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                {o.description}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}

export function Button({
  variant = 'secondary',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}): React.JSX.Element {
  const styles = {
    primary:
      'bg-sky-600 text-white hover:bg-sky-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500',
    secondary:
      'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
    ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800',
    danger: 'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-slate-300 disabled:text-slate-500',
  }[variant]
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}): React.JSX.Element {
  const styles = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    danger: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
    info: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  )
}

export function Callout({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success'
  title?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const config = {
    info: { cls: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40', Icon: Info },
    warning: {
      cls: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40',
      Icon: AlertTriangle,
    },
    danger: {
      cls: 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40',
      Icon: AlertTriangle,
    },
    success: {
      cls: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40',
      Icon: Check,
    },
  }[tone]
  const { Icon } = config
  return (
    <div className={`flex gap-3 rounded-lg border p-3 text-sm ${config.cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-700 dark:text-slate-300" aria-hidden />
      <div className="min-w-0 text-slate-800 dark:text-slate-200">
        {title !== undefined && <p className="font-semibold">{title}</p>}
        <div className={title !== undefined ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  )
}

/**
 * モーダルは必ず document.body へ portal する。
 * transform や backdrop-filter を持つ祖先があると position: fixed の基準がそこになり、
 * 画面中央に出ず切れてしまうため。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}): React.JSX.Element | null {
  // フックは早期 return より前に呼ぶ（`!open` のときも呼び出し順を変えない）。
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  // onClose は呼び出し側でインラインの矢印関数なので、毎レンダリング別物になる。
  // 依存に入れると effect が毎回まわり直し、モーダル内の入力欄からダイアログへ
  // focus を奪い返してしまう（1 文字打つたびにフォーカスが飛ぶ）。
  // 最新の onClose は ref で持ち、effect の依存からは外す。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // 初期フォーカスは「開いたとき」だけ。再レンダリングでは動かさない。
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl outline-none dark:bg-slate-800"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer !== undefined && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function CodeBlock({ code, maxHeight = '24rem' }: { code: string; maxHeight?: string }): React.JSX.Element {
  return (
    <pre
      style={{ maxHeight }}
      className="overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 dark:bg-slate-950"
    >
      <code>{code}</code>
    </pre>
  )
}

export function ProgressBar({
  value,
  max,
  tone = 'default',
}: {
  value: number
  max: number
  tone?: 'default' | 'success'
}): React.JSX.Element {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div
        className={`h-full rounded-full transition-[width] duration-200 ${tone === 'success' ? 'bg-emerald-500' : 'bg-sky-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
