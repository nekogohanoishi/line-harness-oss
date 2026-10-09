'use client'

import Link from 'next/link'
import type { FriendListItem } from '@/lib/api'
import TagBadge from './tag-badge'

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatDate(value: string | null): string {
  if (!value) return '日時不明（記録なし）'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '日時不明（記録なし）' : dateFormatter.format(date)
}

export default function BlockedFriendList({
  friends,
  filtered,
}: {
  friends: FriendListItem[]
  filtered: boolean
}) {
  if (friends.length === 0) {
    return (
      <div className="border-y border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-600">
        {filtered ? '条件に一致するブロック中の友だちはいません。' : '現在ブロック中の友だちはいません。'}
      </div>
    )
  }

  return (
    <div className="border-y border-gray-200 bg-white">
      <div className="hidden gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 md:grid md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto]">
        <span>友だち</span>
        <span>ブロック日時（日本時間）</span>
        <span>タグ</span>
        <span className="w-16">トーク</span>
      </div>
      <ul className="divide-y divide-gray-200">
        {friends.map((friend) => (
          <li key={friend.id} className="grid min-w-0 gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto] md:items-center md:gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {friend.pictureUrl ? (
                <img src={friend.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                  {(friend.displayName || '?').charAt(0)}
                </span>
              )}
              <div className="min-w-0">
                <Link href={`/chats?friend=${friend.id}`} className="block break-words text-sm font-semibold text-gray-900 hover:underline">
                  {friend.displayName || '名前未取得'}
                </Link>
                <span className="mt-1 inline-flex rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">ブロック中</span>
              </div>
            </div>
            <div className="text-sm text-gray-700">
              <span className="mr-2 text-xs text-gray-500 md:hidden">ブロック日時</span>
              {friend.blockedAt ? <time dateTime={friend.blockedAt}>{formatDate(friend.blockedAt)}</time> : formatDate(null)}
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {friend.tags.length > 0 ? friend.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />) : <span className="text-xs text-gray-500">タグなし</span>}
            </div>
            <Link href={`/chats?friend=${friend.id}`} className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-blue-700 hover:underline md:w-16">
              確認する
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
