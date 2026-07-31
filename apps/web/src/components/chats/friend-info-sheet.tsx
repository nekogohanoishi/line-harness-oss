'use client'

import { useEffect } from 'react'
import FriendInfoSidebar from './friend-info-sidebar'

interface ChatStatusInfo {
  status: 'unread' | 'in_progress' | 'resolved' | null
  notes: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  friendId: string | null
  chatStatus?: ChatStatusInfo
  operatorName?: string | null
}

/**
 * xl 未満で友だち詳細を出すためのボトムシート。
 *
 * xl 以上では従来どおり右端のサイドバー (FriendInfoSidebar) を常時表示するため、
 * このシートは開かない。中身はサイドバーと同じコンポーネントを embedded で
 * 描画しているので、表示項目が二重管理にならない。
 *
 * 将来 components/ui/sheet.tsx が用意されたら、この薄いラッパーを差し替える
 * だけで移行できるように、外部からは open / onClose だけを受け取る。
 */
export default function FriendInfoSheet({ open, onClose, friendId, chatStatus, operatorName }: Props) {
  // Esc で閉じる + 背面のスクロールを止める。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open || !friendId) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end xl:hidden" role="dialog" aria-modal="true" aria-label="友だち詳細">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      {/*
        dvh を使うことで、iOS のアドレスバーが伸縮してもシートが画面外へ
        追い出されない。sm 以上では中央寄せの角丸パネルにする。
      */}
      <div className="relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:mx-auto sm:mb-6 sm:max-w-md sm:rounded-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700">友だち詳細</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="-mr-2 flex h-11 w-11 items-center justify-center text-gray-400 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <FriendInfoSidebar
          friendId={friendId}
          chatStatus={chatStatus}
          operatorName={operatorName}
          embedded
        />
      </div>
    </div>
  )
}
