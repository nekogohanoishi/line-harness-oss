'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { eventsApi, type EventBookingItem, type EventDetail, type EventListItem } from '@/lib/api'
import { formatJstDateTime, formatJstTime } from '@line-crm/shared'
import { ResponsiveTable, ConfirmSheet, EmptyState, PageHeader } from '@/components/ui'

// 「全件」を先頭 & 初期表示にする。承認不要イベント (requires_approval=0)
// の予約は最初から confirmed で入るため、「承認待ち」を初期タブにすると
// 新着予約が 1 件も表示されず「予約が入ったのに見えない」事故になる。
const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '全件' },
  { key: 'requested', label: '承認待ち' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'expired', label: '期限切れ' },
  { key: 'attended', label: '参加済' },
  { key: 'no_show', label: '無断' },
]

const statusBadge: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-600',
  expired: 'bg-gray-100 text-gray-500',
  attended: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

function statusLabel(status: string): string {
  return STATUS_TABS.find((t) => t.key === status)?.label ?? status
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadge[status] ?? 'bg-gray-100'}`}>
      {statusLabel(status)}
    </span>
  )
}

/** カード内・表内で共通して使う行アクションボタン。 */
function RowButton({
  onClick,
  disabled,
  tone = 'neutral',
  children,
}: {
  onClick: () => void
  disabled?: boolean
  tone?: 'confirm' | 'reject' | 'attend' | 'noshow' | 'neutral'
  children: React.ReactNode
}) {
  const toneClass = {
    confirm: 'bg-green-600 text-white hover:bg-green-700 border-transparent',
    reject: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
    attend: 'bg-blue-600 text-white hover:bg-blue-700 border-transparent',
    noshow: 'bg-white text-red-600 border-red-200 hover:bg-red-50',
    neutral: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${toneClass}`}
    >
      {children}
    </button>
  )
}

// 実行前に確認シートを出す操作。誤タップで LINE 通知が飛ぶのを防ぐ。
type PendingAction =
  | { kind: 'confirm'; booking: EventBookingItem }
  | { kind: 'reject'; booking: EventBookingItem }
  | { kind: 'cancel'; booking: EventBookingItem }
  | { kind: 'attended'; booking: EventBookingItem }
  | { kind: 'no_show'; booking: EventBookingItem }

const ACTION_COPY: Record<
  PendingAction['kind'],
  { title: string; message: string; confirmLabel: string; danger: boolean }
> = {
  confirm: {
    title: 'この予約を承認しますか？',
    message: '友だちに確定通知が LINE で送られます。',
    confirmLabel: '承認する',
    danger: false,
  },
  reject: {
    title: 'この予約を拒否しますか？',
    message: '友だちには固定文面のお断り通知が LINE で送られます。',
    confirmLabel: '拒否する',
    danger: true,
  },
  cancel: {
    title: '運営側でキャンセルしますか？',
    message: '友だちにキャンセル通知が LINE で送られます。取り消せません。',
    confirmLabel: 'キャンセルする',
    danger: true,
  },
  attended: {
    title: '「参加済」にしますか？',
    message: '出欠の記録だけが変わります。友だちへの通知はありません。',
    confirmLabel: '参加済にする',
    danger: false,
  },
  no_show: {
    title: '「無断欠席」にしますか？',
    message: '出欠の記録だけが変わります。友だちへの通知はありません。',
    confirmLabel: '無断にする',
    danger: true,
  },
}

function BookingsInner() {
  const params = useSearchParams()
  const router = useRouter()
  const eventId = params.get('id')
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [eventChoices, setEventChoices] = useState<EventListItem[] | null>(null)
  const [items, setItems] = useState<EventBookingItem[]>([])
  const [tab, setTab] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    setLoading(true)
    setError(null)
    try {
      const filters = tab === 'all' ? {} : { status: tab }
      // event を state キャッシュから再利用しない。Next.js の app router は
      // 同一ルート内のクエリ変更 (?id=A → ?id=B) でコンポーネントを
      // remount しないため、キャッシュすると別イベントの予約一覧に
      // 前のイベント名ヘッダが表示され続ける。
      const [evRes, listRes] = await Promise.all([
        eventsApi.getEvent(selectedAccountId, eventId),
        eventsApi.listBookings(selectedAccountId, eventId, filters),
      ])
      setEvent(evRes)
      setItems(listRes.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, eventId, tab])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // イベント切替時に前イベントの表示 (ヘッダ名・一覧) を即座に消す
  useEffect(() => {
    setEvent(null)
    setItems([])
  }, [eventId])

  useEffect(() => {
    if (eventId || !selectedAccountId) return

    let cancelled = false
    setLoading(true)
    setError(null)
    void eventsApi.listEvents(selectedAccountId)
      .then((response) => {
        if (cancelled) return
        if (response.items.length === 1) {
          router.replace(`/events/bookings?id=${encodeURIComponent(response.items[0].id)}`)
          return
        }
        setEventChoices(response.items)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [eventId, router, selectedAccountId])

  if (!eventId) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader
          title="予約を確認するイベント"
          description="イベントを選ぶと、承認待ち・確定・キャンセルを確認できます"
        />

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading || eventChoices === null ? (
          <div className="py-12 text-center text-gray-500">予約情報を読み込み中...</div>
        ) : eventChoices.length === 0 ? (
          <EmptyState
            iconPath="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            title="予約受付中のイベントがありません"
            description="イベントを作成して公開すると、ここに予約状況が並びます。"
            action={
              <Link
                href="/events/new"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                イベントを作成
              </Link>
            }
          />
        ) : (
          <div className="border border-gray-200 bg-white rounded-lg overflow-hidden">
            {eventChoices.map((choice) => (
              <Link
                key={choice.id}
                href={`/events/bookings?id=${encodeURIComponent(choice.id)}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-16 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 active:bg-gray-100"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{choice.name}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    予約 {choice.total_active}件 ・ 承認待ち {choice.pending_count}件
                  </div>
                </div>
                {choice.pending_count > 0 ? (
                  <span className="shrink-0 bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap">
                    承認待ち {choice.pending_count}
                  </span>
                ) : (
                  <span className="shrink-0 text-gray-300" aria-hidden="true">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  function openAction(action: PendingAction) {
    setRejectReason('')
    setActionError(null)
    setPending(action)
  }

  // 確認シートで「実行する」を押したときだけ API を呼ぶ。
  // 成功したら一覧を取り直して即座に表示へ反映する。
  async function runPendingAction() {
    if (!pending || !selectedAccountId || !eventId) return
    const { kind, booking } = pending
    setBusy(true)
    setActionError(null)
    try {
      if (kind === 'confirm') {
        await eventsApi.decideBooking(selectedAccountId, eventId, booking.id, 'confirm')
      } else if (kind === 'reject') {
        await eventsApi.decideBooking(
          selectedAccountId,
          eventId,
          booking.id,
          'reject',
          rejectReason.trim() || undefined,
        )
      } else if (kind === 'cancel') {
        await eventsApi.adminCancelBooking(selectedAccountId, eventId, booking.id)
      } else {
        await eventsApi.updateBooking(selectedAccountId, eventId, booking.id, { status: kind })
      }
      setPending(null)
      await refresh()
    } catch (e) {
      // シートは開いたままにして、その場でリトライできるようにする。
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pendingCopy = pending ? ACTION_COPY[pending.kind] : null

  return (
    <>
      <div className="max-w-6xl mx-auto">
        <PageHeader
          breadcrumbs={[
            { label: 'イベント一覧', href: '/events' },
            { label: event?.name ?? '編集', href: `/events/edit?id=${eventId}` },
            { label: '予約管理' },
          ]}
          title={event?.name ?? 'イベント予約管理'}
          description="予約の承認・キャンセル・出欠管理"
        />

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* 絞り込み。狭い画面では下線タブが潰れるので、
            横スクロールするチップにして全ラベルを読めるようにする。 */}
        <div className="mb-3 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto lh-no-scrollbar">
          <div className="flex gap-2 w-max pb-1">
            {STATUS_TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-pressed={active}
                  className={`min-h-11 px-4 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 active:bg-gray-100'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        <ResponsiveTable
          rows={items}
          rowKey={(b) => b.id}
          loading={loading}
          loadingLabel="読み込み中..."
          empty={
            <EmptyState
              size="sm"
              title="該当する予約はありません"
              description={tab === 'all' ? undefined : '別の絞り込みも確認してみてください。'}
            />
          }
          columns={[
            {
              key: 'friend',
              label: '予約者',
              priority: 'primary',
              render: (b) => b.friend_display_name ?? b.friend_id.slice(0, 8),
            },
            {
              key: 'status',
              label: '状態',
              priority: 'meta',
              render: (b) => <StatusBadge status={b.status} />,
            },
            {
              key: 'slot',
              label: '予約枠（JST）',
              render: (b) => (
                <span className="whitespace-nowrap">
                  {formatJstDateTime(b.slot_starts_at, { withYear: true })}
                  <span className="text-gray-400"> 〜 {formatJstTime(b.slot_ends_at)}</span>
                </span>
              ),
            },
            {
              key: 'note',
              label: '備考',
              render: (b) => {
                const customer = b.customer_note?.trim()
                const internal = b.internal_note?.trim()
                if (!customer && !internal) return <span className="text-gray-300">-</span>
                return (
                  <span className="whitespace-pre-wrap">
                    {customer}
                    {internal && (
                      <span className="block text-xs text-gray-500 mt-0.5">メモ: {internal}</span>
                    )}
                  </span>
                )
              },
            },
            {
              key: 'account',
              label: '経由アカ',
              render: (b) => {
                const acct = accounts.find((a) => a.id === b.line_account_id)
                return (
                  <span className="text-xs text-gray-600">
                    {acct
                      ? `${acct.country ? acct.country + ' ' : ''}${acct.name}`
                      : (b.line_account_id ?? '').slice(0, 8)}
                  </span>
                )
              },
            },
            {
              key: 'requested',
              label: '受付日時',
              render: (b) => (
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {formatJstDateTime(b.requested_at, { withYear: true })}
                </span>
              ),
            },
          ]}
          actions={(b) => {
            if (b.status === 'requested') {
              return (
                <>
                  <RowButton tone="confirm" disabled={busy} onClick={() => openAction({ kind: 'confirm', booking: b })}>
                    承認
                  </RowButton>
                  <RowButton tone="reject" disabled={busy} onClick={() => openAction({ kind: 'reject', booking: b })}>
                    拒否
                  </RowButton>
                </>
              )
            }
            if (b.status === 'confirmed') {
              return (
                <>
                  <RowButton tone="attend" disabled={busy} onClick={() => openAction({ kind: 'attended', booking: b })}>
                    参加済
                  </RowButton>
                  <RowButton tone="noshow" disabled={busy} onClick={() => openAction({ kind: 'no_show', booking: b })}>
                    無断
                  </RowButton>
                  <RowButton tone="neutral" disabled={busy} onClick={() => openAction({ kind: 'cancel', booking: b })}>
                    キャンセル
                  </RowButton>
                </>
              )
            }
            return null
          }}
        />
      </div>

      <ConfirmSheet
        open={pending !== null}
        title={pendingCopy?.title ?? ''}
        message={
          pending && pendingCopy ? (
            <>
              {pendingCopy.message}
              <span className="mt-3 block rounded-lg bg-gray-50 p-3 text-[13px] text-gray-700">
                <span className="block font-medium text-gray-900">
                  {pending.booking.friend_display_name ?? pending.booking.friend_id.slice(0, 8)}
                </span>
                <span className="block mt-0.5">
                  {formatJstDateTime(pending.booking.slot_starts_at, { withYear: true })}
                  {' 〜 '}
                  {formatJstTime(pending.booking.slot_ends_at)}
                </span>
              </span>
            </>
          ) : null
        }
        confirmLabel={pendingCopy?.confirmLabel ?? '実行する'}
        tone={pendingCopy?.danger ? 'danger' : 'default'}
        busy={busy}
        error={actionError}
        onConfirm={() => void runPendingAction()}
        onClose={() => setPending(null)}
      >
        {pending?.kind === 'reject' && (
          <label className="block">
            <span className="text-sm font-medium text-gray-700">拒否理由（任意・運営メモ）</span>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="友だちには固定文面が送られます"
              className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        )}
      </ConfirmSheet>
    </>
  )
}

export default function EventBookingsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">読み込み中...</div>}>
      <BookingsInner />
    </Suspense>
  )
}
