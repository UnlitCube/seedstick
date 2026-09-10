// 小さな部品。**文言は持たない**（受け取るだけ）。

import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'

type ButtonTone = 'primary' | 'ghost' | 'danger'

interface ButtonProps {
  readonly tone?: ButtonTone
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly children: React.ReactNode
  readonly className?: string
  readonly autoFocus?: boolean
}

export function Button({
  tone = 'ghost',
  onClick,
  disabled = false,
  children,
  className = '',
  autoFocus = false,
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={`btn btn-${tone} ${className}`}
    >
      {children}
    </button>
  )
}

export function ArrowRight(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface CheckboxProps {
  readonly checked: boolean
  /** **必ず boolean を渡す。** `undefined` を「既定」に使わない（規約）。 */
  readonly onChange: (next: boolean) => void
  readonly label: string
  readonly disabled?: boolean
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: CheckboxProps): React.JSX.Element {
  return (
    <label
      className={
        'flex cursor-pointer items-center gap-3 text-sm ' +
        (disabled ? 'cursor-not-allowed opacity-50' : 'text-white/80 hover:text-white')
      }
    >
      <input
        type="checkbox"
        className="box"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

interface ConfirmProps {
  readonly open: boolean
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * 確認の覆い。**`createPortal` で `document.body` に出す**
 * （`transform` を持つ祖先があると `position: fixed` の基準がそこになる。
 * このリポジトリの規約）。
 *
 * `Escape` で閉じる。`onCancel` は呼び出し側で毎回新しい関数になるので、
 * **依存配列には入れず ref で最新を持つ**（落とし穴 59）。
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmProps): React.JSX.Element | null {
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="overlay fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      role="presentation"
    >
      <div
        className="modal card w-[420px] p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button tone="ghost" onClick={onCancel} autoFocus>
            {cancelLabel}
          </Button>
          <Button tone="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
