'use client'

import React, { useCallback, useEffect } from 'react'

/**
 * Sheet — モバイルでは画面下から出るボトムシート、sm 以上では中央モーダル。
 *
 * 既存モーダル (auto-replies/edit-dialog.tsx 等) の
 * `fixed inset-0 bg-black/40 … z-50` パターンを踏襲しつつ、
 * モバイルで「親指の届く位置に操作が来る」形に変えたもの。
 * Portal を使わないので DOM 構造の前提は既存モーダルと同じ。
 *
 * ## 使い方
 * ```tsx
 * const [open, setOpen] = useState(false)
 * <Sheet
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   title="予約枠を追加"
 *   description="JST で入力してください"
 *   footer={
 *     <>
 *       <SheetButton onClick={() => setOpen(false)}>キャンセル</SheetButton>
 *       <SheetButton variant="primary" onClick={submit} busy={saving}>追加</SheetButton>
 *     </>
 *   }
 * >
 *   …フォーム…
 * </Sheet>
 * ```
 *
 * 確認ダイアログ (誤タップ防止) は ConfirmSheet を使う:
 * ```tsx
 * <ConfirmSheet
 *   open={!!target}
 *   title="この予約を承認しますか？"
 *   message="友だちに確定通知が LINE で送られます。"
 *   confirmLabel="承認する"
 *   busy={busy}
 *   error={error}
 *   onConfirm={run}
 *   onClose={() => setTarget(null)}
 * />
 * ```
 */

export interface SheetProps {
  open: boolean
  /** 背景タップ / Esc / 閉じるボタン。busy 中は呼ばれない。 */
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  /** 下部の操作ボタン。モバイルでは全幅で横並びになる。 */
  footer?: React.ReactNode
  /** デスクトップでの最大幅。既定 'md'。 */
  size?: 'sm' | 'md' | 'lg'
  /** 処理中。背景タップ / Esc での閉じるを止める。 */
  busy?: boolean
  /** 背景タップで閉じない (入力途中の破棄を避けたいとき)。 */
  dismissOnBackdrop?: boolean
}

const sizeClass = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
} as const

export default function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy = false,
  dismissOnBackdrop = true,
}: SheetProps) {
  const requestClose = useCallback(() => {
    if (busy) return
    onClose()
  }, [busy, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    // 背面のページがスクロールしてしまうのを止める。
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, requestClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40 lh-fade-in"
        onClick={dismissOnBackdrop ? requestClose : undefined}
      />
      <div
        className={`lh-sheet-panel relative w-full ${sizeClass[size]} bg-white shadow-xl flex flex-col
          max-h-[90vh] rounded-t-2xl
          sm:mx-4 sm:rounded-2xl sm:max-h-[85vh]`}
      >
        {/* モバイル: つまみ (下から出てくることを示す) */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <span className="block h-1 w-10 rounded-full bg-gray-300" />
        </div>

        {(title || description) && (
          <div className="px-5 pt-3 pb-3 sm:pt-5 border-b border-gray-100 shrink-0 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {title && <h3 className="text-base sm:text-lg font-bold text-gray-900">{title}</h3>}
              {description && <p className="mt-1 text-[13px] text-gray-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={busy}
              aria-label="閉じる"
              className="-mr-2 -mt-1 shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-40"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="px-5 py-4 overflow-y-auto overscroll-contain flex-1">{children}</div>

        {footer && (
          <div className="px-5 pt-3 border-t border-gray-100 bg-gray-50 shrink-0 flex gap-2 justify-stretch sm:justify-end lh-safe-pb-3 [&>*]:flex-1 sm:[&>*]:flex-none">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────

export interface SheetButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'primary' | 'secondary' | 'danger'
  /** 処理中。スピナー文言に差し替えて disabled にする。 */
  busy?: boolean
  busyLabel?: string
  children: React.ReactNode
}

const variantClass = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border border-transparent',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 border border-transparent',
} as const

/** Sheet の footer 用ボタン。モバイルで 44px 以上のタップ領域を確保する。 */
export function SheetButton({
  variant = 'secondary',
  busy = false,
  busyLabel = '処理中...',
  children,
  className = '',
  disabled,
  ...rest
}: SheetButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`min-h-11 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {busy ? busyLabel : children}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────

export interface ConfirmSheetProps {
  open: boolean
  title: React.ReactNode
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  /** 実行中。ボタンを processing 表示にし、閉じる操作を止める。 */
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
  /** 確認と一緒に入力させたいもの (拒否理由など)。 */
  children?: React.ReactNode
}

/**
 * ConfirmSheet — 承認 / 却下のような「押し間違えると取り返しがつかない」
 * 操作の前に挟む確認シート。window.confirm と違い処理中の状態を出せる。
 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel = '実行する',
  cancelLabel = 'やめる',
  tone = 'default',
  busy = false,
  error,
  onConfirm,
  onClose,
  children,
}: ConfirmSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <SheetButton onClick={onClose} disabled={busy}>
            {cancelLabel}
          </SheetButton>
          <SheetButton
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            busy={busy}
          >
            {confirmLabel}
          </SheetButton>
        </>
      }
    >
      {message && <p className="text-sm text-gray-600 leading-relaxed">{message}</p>}
      {children && <div className="mt-4">{children}</div>}
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
    </Sheet>
  )
}
