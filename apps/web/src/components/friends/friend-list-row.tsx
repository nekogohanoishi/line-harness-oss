'use client'

import { useRouter } from 'next/navigation'
import type { FriendListItem } from '@/lib/api'
import TagBadge from './tag-badge'

interface Props {
  friend: FriendListItem
  // Toggles the inline tag-management section underneath the row. Wired up
  // to a discrete button (with stopPropagation) inside this component, NOT
  // to the row body — the row body navigates to /chats and we don't want
  // the tag-edit affordance to compete with that primary click target.
  onTagEditClick?: () => void
}

// カード表示で並べるタグの上限。超過分は「他N」に畳む。
const MOBILE_TAG_LIMIT = 3

// Single row of the L-step style friend list.
//
// Layout is viewport-dependent:
//  - lg 以上: 5カラムのグリッド
//    対応マーク / 名前 / シナリオ / 受信メッセージ / ★つきタグ・友だち情報
//  - lg 未満: 1枚のカード。横スクロールを起こさずに 375px 幅へ収めるため、
//    表示は「アイコン+表示名 / ステータス / 登録日 / 受信メッセージ / タグ」に
//    絞り、シナリオなどの補助情報は詳細（チャット画面）側に委ねる。
//
// Clicking the row navigates to the per-friend chat view at
// `/chats?friend=<id>` so the operator can read history / reply / mark as
// resolved without leaving the list. The "タグ編集" button opens an inline
// tag editor (handled by the parent table).
export default function FriendListRow({ friend, onTagEditClick }: Props) {
  const router = useRouter()
  const navigateToChat = () => router.push(`/chats?friend=${friend.id}`)
  const incoming = friend.latestIncomingMessage
  const scenario = friend.activeScenario
  const isFollowing = friend.isFollowing
  const incomingPreview = incoming
    ? (incoming.messageType === 'text' ? incoming.content : `[${incoming.messageType}]`)
    : null
  const visibleTags = friend.tags.slice(0, MOBILE_TAG_LIMIT)
  const hiddenTagCount = friend.tags.length - visibleTags.length

  // 行本体のクリック/キー操作は両レイアウトで共通。
  const rowInteractionProps = {
    onClick: navigateToChat,
    role: 'link' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Only react when the row itself is the keyboard target. Otherwise
      // an Enter/Space pressed on a nested button (e.g. タグ編集) would
      // bubble up here and override the button's own click handler,
      // navigating away instead of toggling the tag editor.
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        navigateToChat()
      }
    },
  }

  const tagEditButton = onTagEditClick && (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onTagEditClick() }}
      className="text-[11px] text-blue-600 hover:text-blue-800 underline"
    >
      タグ編集
    </button>
  )

  return (
    <>
      {/* ------------------------------ モバイル: カード ------------------------------ */}
      <div
        {...rowInteractionProps}
        className="lg:hidden px-4 py-3.5 border-b border-gray-100 active:bg-gray-50 cursor-pointer focus:outline-none focus:bg-gray-50"
      >
        <div className="flex items-start gap-3">
          <Avatar friend={friend} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-gray-900 truncate">{friend.displayName}</p>
              <StatusBadge chatStatus={friend.chatStatus} />
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">登録: {formatJstDate(friend.createdAt)}</p>
            {!isFollowing && (
              <p className="text-[11px] font-medium text-red-500 mt-0.5">
                ブロック中
                <span className="ml-1 font-normal text-gray-400">
                  {friend.blockedAt ? formatJstTimestamp(friend.blockedAt) : '日時不明'}
                </span>
              </p>
            )}
          </div>
        </div>

        {incomingPreview && (
          <p className="mt-2 text-xs text-gray-600 line-clamp-2 break-all">{incomingPreview}</p>
        )}

        {(visibleTags.length > 0 || onTagEditClick) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {visibleTags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
            {hiddenTagCount > 0 && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-500">
                他{hiddenTagCount}
              </span>
            )}
            {tagEditButton}
          </div>
        )}
      </div>

      {/* ------------------------------ デスクトップ: 5カラム ------------------------------ */}
      <div
        {...rowInteractionProps}
        className="hidden lg:grid grid-cols-[80px_220px_120px_1fr_280px] gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer items-start focus:outline-none focus:bg-gray-50"
      >
        {/* 対応マーク — chats.status 由来 (unread / in_progress / resolved). */}
        <div className="pt-1">
          <StatusBadge chatStatus={friend.chatStatus} />
        </div>

        {/* 名前 + アバター + 登録日 */}
        <div className="flex items-start gap-2">
          <Avatar friend={friend} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{friend.displayName}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">登録: {formatJstDate(friend.createdAt)}</p>
            {!isFollowing && (
              <div className="mt-0.5">
                <p className="text-[10px] font-medium text-red-500">ブロック中</p>
                <p className="text-[10px] text-gray-400">
                  {friend.blockedAt ? `日時: ${formatJstTimestamp(friend.blockedAt)}` : '日時不明（記録開始前）'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* シナリオ */}
        <div className="pt-1">
          {scenario ? (
            <div>
              <p className="text-xs font-medium text-blue-700 truncate" title={scenario.name}>
                {scenario.name}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {scenario.status === 'active' ? '配信中' : scenario.status === 'delivering' ? '配信処理中' : scenario.status}
              </p>
            </div>
          ) : (
            <span className="text-xs text-gray-400">停止中</span>
          )}
        </div>

        {/* 受信メッセージ */}
        <div className="min-w-0">
          {incoming ? (
            <>
              <p className="text-xs text-gray-700 line-clamp-2 break-all">{incomingPreview}</p>
              <p className="text-[10px] text-gray-400 mt-1">
                ({formatJstTimestamp(incoming.createdAt)})
              </p>
            </>
          ) : (
            <span className="text-xs text-gray-400">受信なし</span>
          )}
        </div>

        {/* ★つきタグ・友だち情報 */}
        <div className="space-y-1">
          {friend.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {friend.tags.map((tag) => (
                <TagBadge key={tag.id} tag={tag} />
              ))}
            </div>
          )}
          {friend.firstTrackedLinkName && (
            <p className="text-[10px] text-gray-500">
              <span className="text-gray-400">ASP_LP名：</span>
              {friend.firstTrackedLinkName}
            </p>
          )}
          {friend.refCode && !friend.firstTrackedLinkName && (
            <p className="text-[10px] text-gray-500">
              <span className="text-gray-400">流入：</span>
              {friend.refCode}
            </p>
          )}
          {friend.tags.length === 0 && !friend.firstTrackedLinkName && !friend.refCode && (
            <span className="text-[10px] text-gray-300">—</span>
          )}
          {tagEditButton}
        </div>
      </div>
    </>
  )
}

function Avatar({ friend }: { friend: FriendListItem }) {
  if (friend.pictureUrl) {
    return (
      <img
        src={friend.pictureUrl}
        alt={friend.displayName}
        className="w-9 h-9 rounded-full object-cover bg-gray-100 flex-shrink-0"
      />
    )
  }
  return (
    <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium flex-shrink-0">
      {friend.displayName?.charAt(0) ?? '?'}
    </div>
  )
}

function StatusBadge({ chatStatus }: { chatStatus: FriendListItem['chatStatus'] }) {
  if (chatStatus === 'unread') {
    return (
      <span className="inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">
        未対応
      </span>
    )
  }
  if (chatStatus === 'in_progress') {
    return (
      <span className="inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded text-[11px] font-medium bg-yellow-100 text-yellow-700">
        対応中
      </span>
    )
  }
  return (
    <span className="inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500">
      対応済み
    </span>
  )
}

// Format ISO ts to "YYYY-MM-DD HH:MM:SS" in JST. The DB stores values
// already in JST (`+09:00` strftime), so we render as-is — using the
// browser's locale formatter would re-interpret as UTC and shift 9h.
function formatJstTimestamp(iso: string): string {
  // Accept both `2026-05-08T13:45:00.000+09:00` and `2026-05-08T13:45:00`.
  // Slice off the timezone suffix and the millisecond decimals to land on
  // the 19-char canonical form, then swap T → space.
  const trimmed = iso.replace(/(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?$/, '')
  return trimmed.replace('T', ' ').slice(0, 19)
}

// Date-only variant for the registration column. Same JST-as-stored
// rationale — slice off everything after the date portion.
function formatJstDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/')
}
