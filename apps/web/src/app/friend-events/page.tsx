'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api, type FriendLifecycleEvent } from '@/lib/api'

const PAGE_SIZE = 30

type EventFilter = 'all' | FriendLifecycleEvent['eventType']

const eventPresentation: Record<FriendLifecycleEvent['eventType'], {
  label: string
  dotClass: string
  textClass: string
}> = {
  added: {
    label: '追加されました（新規友だち）',
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-800',
  },
  blocked: {
    label: 'ブロックされました',
    dotClass: 'bg-red-500',
    textClass: 'text-red-700',
  },
  unblocked: {
    label: 'ブロック解除（復活）しました',
    dotClass: 'bg-green-500',
    textClass: 'text-green-800',
  },
}

const filterOptions: Array<{ value: EventFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'added', label: '友だち追加' },
  { value: 'blocked', label: 'ブロック' },
  { value: 'unblocked', label: 'ブロック解除' },
]

function formatEventDate(value: string): { date: string; time: string; full: string } {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: value, time: '', full: value }

  const datePart = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return {
    date: datePart,
    time: timePart,
    full: `${datePart} ${timePart}`,
  }
}

function FriendAvatar({ event }: { event: FriendLifecycleEvent }) {
  if (event.pictureUrl) {
    return (
      <img
        src={event.pictureUrl}
        alt=""
        className="h-12 w-12 shrink-0 rounded-full object-cover sm:h-14 sm:w-14"
      />
    )
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 text-base font-semibold text-gray-500 sm:h-14 sm:w-14">
      {(event.displayName || '?').charAt(0)}
    </div>
  )
}

export default function FriendEventsPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [events, setEvents] = useState<FriendLifecycleEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const loadEvents = useCallback(async (silent = false) => {
    if (accountLoading) return

    const currentRequest = ++requestId.current
    if (!silent) setLoading(true)
    if (!silent) setError('')
    try {
      const response = await api.friendEvents.list({
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        eventType: eventFilter === 'all' ? undefined : eventFilter,
        search: searchSubmitted || undefined,
        accountId: selectedAccountId || undefined,
      })
      if (currentRequest !== requestId.current) return

      if (response.success) {
        setEvents(response.data.items)
        setTotal(response.data.total)
        setHasNextPage(response.data.hasNextPage)
        if (response.data.items.some((item) => item.isUnread)) {
          void api.friendEvents
            .markRead(selectedAccountId || undefined)
            .then((markResponse) => {
              if (markResponse.success) {
                window.dispatchEvent(new Event('lh:notification-counts-changed'))
              }
            })
            .catch(() => undefined)
        }
      } else {
        setError(response.error)
      }
    } catch {
      if (currentRequest === requestId.current) {
        setError('履歴の読み込みに失敗しました。もう一度お試しください。')
      }
    } finally {
      if (!silent && currentRequest === requestId.current) setLoading(false)
    }
  }, [accountLoading, eventFilter, page, searchSubmitted, selectedAccountId])

  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    void loadEvents()
    const id = window.setInterval(() => { void loadEvents(true) }, 30_000)
    return () => window.clearInterval(id)
  }, [loadEvents])

  const applyFilter = (value: EventFilter) => {
    setEventFilter(value)
    setPage(1)
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setSearchSubmitted(searchInput.trim())
    setPage(1)
  }

  const changeSearchInput = (value: string) => {
    setSearchInput(value)
    if (!value.trim() && searchSubmitted) {
      setSearchSubmitted('')
      setPage(1)
    }
  }

  return (
    <div>
      <Header title="友だち追加・ブロック" />

      <div className="mb-5 border border-gray-200 bg-white p-4 rounded-lg">
        <form onSubmit={submitSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <svg
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
            </svg>
            <input
              type="search"
              value={searchInput}
              onChange={(event) => changeSearchInput(event.target.value)}
              placeholder="友だち名を検索"
              className="h-10 w-full rounded-md border border-gray-300 pl-9 pr-3 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-md bg-[#06C755] px-5 text-sm font-medium text-white hover:bg-[#05b34c] focus:outline-none focus:ring-2 focus:ring-green-300"
          >
            検索
          </button>
        </form>

        <div className="mt-4 flex overflow-x-auto border-b border-gray-200" role="tablist" aria-label="履歴の種類">
          {filterOptions.map((option) => {
            const active = eventFilter === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => applyFilter(option.value)}
                className={`h-10 shrink-0 border-b-2 px-4 text-sm font-medium transition-colors ${
                  active
                    ? 'border-green-500 text-green-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between text-sm text-gray-500">
        <span>{total.toLocaleString('ja-JP')}件</span>
        {total > 0 && (
          <span>{(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件を表示</span>
        )}
      </div>

      <div className="border-y border-gray-200 bg-white">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex h-28 animate-pulse items-center gap-4 px-4 sm:px-5">
                <div className="h-12 w-12 shrink-0 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-44 rounded bg-gray-200" />
                  <div className="h-3 w-28 rounded bg-gray-100" />
                  <div className="h-3 w-36 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-4 py-14 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => { void loadEvents() }}
              className="mt-4 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              再読み込み
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-gray-500">
            該当する履歴はありません。
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {events.map((event) => {
              const presentation = eventPresentation[event.eventType]
              const formatted = formatEventDate(event.eventAt)
              const inflow = event.firstTrackedLinkName || event.refCode
              return (
                <li key={event.id} className="px-4 py-4 transition-colors hover:bg-gray-50 sm:px-5">
                  <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_9rem] sm:gap-4">
                    <FriendAvatar event={event} />
                    <div className="min-w-0">
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${presentation.dotClass}`} />
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className={`text-sm font-semibold leading-5 ${presentation.textClass}`}>
                            {presentation.label}
                          </p>
                          {event.isUnread && (
                            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">新着</span>
                          )}
                        </div>
                      </div>
                      <Link
                        href={`/chats?friend=${encodeURIComponent(event.friendId)}`}
                        className="mt-1 block truncate text-base font-medium text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                      >
                        {event.displayName || '名前なし'}
                      </Link>
                      {event.eventType !== 'blocked' && (
                        <p className="mt-1 truncate text-xs text-gray-500">
                          <span className="mr-3 text-gray-400">流入アクション</span>
                          {inflow || '−'}
                        </p>
                      )}
                    </div>
                    <time
                      dateTime={event.eventAt}
                      title={formatted.full}
                      className="self-start whitespace-nowrap text-right text-sm tabular-nums text-gray-500 sm:self-center"
                    >
                      <span className="hidden sm:inline">{formatted.date}<br />{formatted.time}</span>
                      <span className="sm:hidden">{formatted.date.slice(5)}</span>
                    </time>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page === 1}
            title="前のページ"
            aria-label="前のページ"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span className="min-w-16 text-center text-sm tabular-nums text-gray-600">{page} / {Math.ceil(total / PAGE_SIZE)}</span>
          <button
            type="button"
            onClick={() => setPage((value) => value + 1)}
            disabled={!hasNextPage}
            title="次のページ"
            aria-label="次のページ"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
