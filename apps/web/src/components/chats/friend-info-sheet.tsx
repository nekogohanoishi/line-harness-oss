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
 * xl 未満で友だち詳細を出すためのシート。
 *
 * xl 以上では従来どおり右端のサイドバー (FriendInfoSidebar) を常時表示するため、
 * このシートは開かない。中身はサイドバーと同じコンポーネントを embedded で
 * 描画しているので、表示項目が二重管理にならない。
 *
 * 枠・開閉まわりは共通プリミティブの Sheet に任せる (Esc / 背景タップ /
 * 背面スクロール抑止 / モバイルはボトムシート・sm 以上は中央モーダル)。
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
