'use client'

import Sheet from '@/components/ui/sheet'
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
 * 画面幅に関係なく友だち詳細を必要時だけ開くシート。
 * 会話ペインを常時3列目で圧迫せず、中身は既存のサイドバーを再利用する。
 */
export default function FriendInfoSheet({ open, onClose, friendId, chatStatus, operatorName }: Props) {
  if (!friendId) return null

  return (
    <Sheet open={open} onClose={onClose} title="友だち詳細">
      {/* Sheet 本体の余白を打ち消して、サイドバーと同じ区切り線の見た目に戻す。 */}
      <div className="-mx-5 -my-4">
        <FriendInfoSidebar
          friendId={friendId}
          chatStatus={chatStatus}
          operatorName={operatorName}
          embedded
        />
      </div>
    </Sheet>
  )
}
