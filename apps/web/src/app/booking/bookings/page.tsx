'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import {
  bookingApi,
  eventsApi,
  type BookingRequest,
  type EventBookingItem,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type Source = 'event' | 'individual'
type Tab = 'unseen' | 'requested' | 'confirmed' | 'finished' | 'all'

interface UnifiedBooking {
  key: string
  id: string
  source: Source
  eventId?: string
  title: string
  friendName: string
  staffName?: string
  startsAt: string
  requestedAt: string
  status: string
  customerNote: string | null
  adminSeenAt: string | null
  price?: number
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'unseen', label: '未確認' },
  { key: 'requested', label: '承認待ち' },
  { key: 'confirmed', label: '確定' },
  { key: 'finished', label: '終了' },
  { key: 'all', label: '全件' },
]

const STATUS_LABEL: Record<string, string> = {
  requested: '承認待ち',
  confirmed: '確定',
  rejected: '拒否',
  expired: '期限切れ',
  cancelled: 'キャンセル',
  completed: '完了',
  attended: '参加済み',
  no_show: '無断キャンセル',
}

const STATUS_STYLE: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-700',
  expired: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-700',
  completed: 'bg-blue-100 text-blue-800',
  attended: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

function fromIndividual(item: BookingRequest): UnifiedBooking {
  return {
    key: `individual:${item.id}`,
    id: item.id,
    source: 'individual',
    title: item.menu_name,
    friendName: item.friend_name ?? '名前未取得',
    staffName: item.staff_name,
    startsAt: item.starts_at,
    requestedAt: item.requested_at,
    status: item.status,
    customerNote: item.customer_note,
    adminSeenAt: item.admin_seen_at,
    price: item.price_at_booking,
  }
}

function fromEvent(item: EventBookingItem): UnifiedBooking {
  return {
    key: `event:${item.id}`,
    id: item.id,
    source: 'event',
    eventId: item.event_id,
    title: item.event_name ?? 'イベント予約',
    friendName: item.friend_display_name ?? '名前未取得',
    startsAt: item.slot_starts_at,
    requestedAt: item.requested_at,
    status: item.status,
    customerNote: item.customer_note,
    adminSeenAt: item.admin_seen_at,
  }
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function matchesTab(item: UnifiedBooking, tab: Tab): boolean {
  if (tab === 'unseen') return item.adminSeenAt == null
  if (tab === 'requested') return item.status === 'requested'
  if (tab === 'confirmed') return item.status === 'confirmed'
  if (tab === 'finished') return item.status !== 'requested' && item.status !== 'confirmed'
  return true
}

export default function BookingsPage() {
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<Tab>('unseen')
  const [source, setSource] = useState<'all' | Source>('all')
  const [items, setItems] = useState<UnifiedBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [individual, event] = await Promise.all([
        bookingApi.listRequests(selectedAccountId, 'all'),
        eventsApi.listAllBookings(selectedAccountId, 'all'),
      ])
      const merged = [
        ...individual.requests.map(fromIndividual),
        ...event.items.map(fromEvent),
      ].sort((a, b) => {
        if (a.adminSeenAt == null && b.adminSeenAt != null) return -1
        if (a.adminSeenAt != null && b.adminSeenAt == null) return 1
        return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
      })
      setItems(merged)
    } catch (e) {
      setItems([])
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => Object.fromEntries(
    TABS.map(({ key }) => [key, items.filter((item) => matchesTab(item, key)).length]),
  ) as Record<Tab, number>, [items])

  const visibleItems = useMemo(() => items.filter((item) => (
    matchesTab(item, tab) && (source === 'all' || item.source === source)
  )), [items, source, tab])

  async function markSeen(item: UnifiedBooking) {
    if (!selectedAccountId) return
    setBusyKey(`${item.key}:seen`)
    try {
      if (item.source === 'event' && item.eventId) {
        await eventsApi.markBookingSeen(selectedAccountId, item.eventId, item.id)
      } else {
        await bookingApi.markSeen(selectedAccountId, item.id)
      }
      await load()
    } catch (e) {
      alert(`確認済みへの変更に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusyKey(null)
    }
  }

  async function runAction(
    item: UnifiedBooking,
    action: 'confirm' | 'reject' | 'cancel' | 'complete' | 'no_show' | 'attended' | 'restore',
  ) {
    if (!selectedAccountId) return
    const actionLabel = {
      confirm: '承認',
      reject: '拒否',
      cancel: 'キャンセル',
      complete: '完了',
      no_show: '無断キャンセル',
      attended: '参加済み',
      restore: '承認待ちへ復元',
    }[action]
    if (!confirm(`${item.friendName}さんの予約を「${actionLabel}」にしますか？`)) return
    setBusyKey(`${item.key}:${action}`)
    try {
      if (item.source === 'event' && item.eventId) {
        if (action === 'confirm' || action === 'reject') {
          await eventsApi.decideBooking(selectedAccountId, item.eventId, item.id, action)
        } else if (action === 'cancel') {
          await eventsApi.adminCancelBooking(selectedAccountId, item.eventId, item.id)
        } else if (action === 'attended' || action === 'no_show') {
          await eventsApi.updateBooking(selectedAccountId, item.eventId, item.id, { status: action })
        } else if (action === 'restore') {
          await eventsApi.restoreBooking(selectedAccountId, item.eventId, item.id)
        }
      } else if (action === 'restore') {
        await bookingApi.restoreRequest(selectedAccountId, item.id)
      } else if (action !== 'attended') {
        const individualAction = action === 'confirm' ? 'approve' : action
        await bookingApi.decideRequest(selectedAccountId, item.id, individualAction)
      }
      await load()
    } catch (e) {
      alert(`予約の変更に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div>
      <Header
        title="予約管理"
        description="イベント予約と個別予約をまとめて確認できます"
      />

      {error && (
        <div className="mb-4 border border-red-200 bg-red-50 p-4 text-sm text-red-700 rounded-md">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="予約状態">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {label} <span className={tab === key ? 'text-gray-300' : 'text-gray-400'}>{counts[key]}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          種類
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as 'all' | Source)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="all">すべて</option>
            <option value="event">イベント予約</option>
            <option value="individual">個別予約</option>
          </select>
        </label>
      </div>

      {!selectedAccountId ? (
        <div className="py-14 text-center text-sm text-gray-500">アカウントを選択してください</div>
      ) : loading ? (
        <div className="py-14 text-center text-sm text-gray-500">予約を読み込み中...</div>
      ) : visibleItems.length === 0 ? (
        <div className="py-14 text-center text-sm text-gray-500">該当する予約はありません</div>
      ) : (
        <div className="border-y border-gray-200 bg-white">
          <div className="hidden grid-cols-[minmax(160px,0.9fr)_minmax(150px,0.8fr)_minmax(180px,1.2fr)_110px_minmax(220px,1fr)] gap-4 border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-500 md:grid">
            <div>予約日時</div>
            <div>友だち</div>
            <div>内容</div>
            <div>状態</div>
            <div className="text-right">操作</div>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleItems.map((item) => (
              <BookingRow
                key={item.key}
                item={item}
                busy={busyKey?.startsWith(`${item.key}:`) ?? false}
                onSeen={() => void markSeen(item)}
                onAction={(action) => void runAction(item, action)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BookingRow({
  item,
  busy,
  onSeen,
  onAction,
}: {
  item: UnifiedBooking
  busy: boolean
  onSeen: () => void
  onAction: (action: 'confirm' | 'reject' | 'cancel' | 'complete' | 'no_show' | 'attended' | 'restore') => void
}) {
  const canRestore = item.status === 'expired' && new Date(item.startsAt).getTime() > Date.now()
  return (
    <div className={`grid gap-3 px-4 py-4 md:grid-cols-[minmax(160px,0.9fr)_minmax(150px,0.8fr)_minmax(180px,1.2fr)_110px_minmax(220px,1fr)] md:items-center md:gap-4 ${item.adminSeenAt == null ? 'bg-amber-50/60' : ''}`}>
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          {item.adminSeenAt == null && <span className="h-2 w-2 rounded-full bg-red-500" aria-label="未確認" />}
          {formatDateTime(item.startsAt)}
        </div>
        <div className="mt-1 text-xs text-gray-500">受付 {formatDateTime(item.requestedAt)}</div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-gray-900">{item.friendName}</div>
        {item.customerNote && (
          <div className="mt-1 truncate text-xs text-gray-500" title={item.customerNote}>{item.customerNote}</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600">
            {item.source === 'event' ? 'イベント' : '個別'}
          </span>
          <span className="truncate text-sm text-gray-900">{item.title}</span>
        </div>
        {item.staffName && <div className="mt-1 text-xs text-gray-500">担当 {item.staffName}</div>}
      </div>

      <div>
        <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${STATUS_STYLE[item.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {STATUS_LABEL[item.status] ?? item.status}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-start gap-1.5 md:justify-end">
        {item.adminSeenAt == null && (
          <button type="button" disabled={busy} onClick={onSeen} className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            確認済みにする
          </button>
        )}
        {item.status === 'requested' && (
          <>
            <button type="button" disabled={busy} onClick={() => onAction('confirm')} className="rounded bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">承認</button>
            <button type="button" disabled={busy} onClick={() => onAction('reject')} className="rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">拒否</button>
          </>
        )}
        {item.status === 'confirmed' && item.source === 'event' && (
          <>
            <button type="button" disabled={busy} onClick={() => onAction('attended')} className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">参加済み</button>
            <button type="button" disabled={busy} onClick={() => onAction('no_show')} className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">無断</button>
            <button type="button" disabled={busy} onClick={() => onAction('cancel')} className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">取消</button>
          </>
        )}
        {item.status === 'confirmed' && item.source === 'individual' && (
          <>
            <button type="button" disabled={busy} onClick={() => onAction('complete')} className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">完了</button>
            <button type="button" disabled={busy} onClick={() => onAction('no_show')} className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">無断</button>
            <button type="button" disabled={busy} onClick={() => onAction('cancel')} className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">取消</button>
          </>
        )}
        {canRestore && (
          <button type="button" disabled={busy} onClick={() => onAction('restore')} className="rounded border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50">復元</button>
        )}
        {item.source === 'event' && item.eventId && (
          <Link href={`/events/bookings?id=${encodeURIComponent(item.eventId)}`} className="rounded px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
            詳細
          </Link>
        )}
      </div>
    </div>
  )
}
