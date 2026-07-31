'use client'

import { useEffect, type ReactNode } from 'react'

interface EditSheetProps {
  open: boolean
  title: string
  onClose: () => void
  /** 常に画面下に固定して表示したい操作 (保存 / キャンセル等) */
  footer?: ReactNode
  children: ReactNode
}

/**
 * 編集フォーム用のレスポンシブなコンテナ。
 *
 * - モバイル (< md): 画面下から立ち上がるボトムシート。本文だけがスクロールし、
 *   フッター (保存ボタン) は常に親指の届く位置に固定される。上端の `top-[72px]` は
 *   AppShell のモバイル固定ヘッダー (`pt-[72px]`) と重ならないための値。
 * - デスクトップ (>= md): 従来どおりページ内にインライン展開する (既存レイアウトを維持)。
 *
 * ブレークポイントの出し分けは CSS だけで行うため、SSR と初回描画がずれない。
 * 共通の `components/ui/sheet` が用意されたら、この実装をそのまま差し替えられる。
 */
export default function EditSheet({ open, title, onClose, footer, children }: EditSheetProps) {
  // モバイルでシートを開いている間だけ背面のスクロールを止める。
  // デスクトップではインライン表示なのでロックしない。
  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined') return
    const mobile = window.matchMedia('(max-width: 767px)')
    if (!mobile.matches) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 top-[72px] z-50 flex flex-col rounded-t-2xl bg-white shadow-2xl md:static md:z-auto md:mb-6 md:rounded-lg md:border md:border-gray-200 md:bg-gray-50 md:shadow-none"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 md:border-b-0 md:px-4 md:pb-0 md:pt-4">
          <h4 className="text-sm font-medium text-gray-700">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 md:hidden"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3 md:overflow-y-visible md:p-4 md:pt-3">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:border-t-0 md:bg-transparent md:px-4 md:pb-4 md:pt-0">
            {footer}
          </div>
        )}
      </div>
    </>
  )
}
