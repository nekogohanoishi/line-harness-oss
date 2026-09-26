'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { api, type ScenarioParticipant } from '@/lib/api'
import { ConfirmSheet } from '@/components/ui'

type ParticipantStatus = ScenarioParticipant['status']
type StatusFilter = ParticipantStatus | 'all'

const PAGE_SIZE = 30

const statusLabels: Record<ParticipantStatus, string> = {
  active: '配信待ち',
  paused: '一時停止',
  delivering: '送信処理中',
}

const statusStyles: Record<ParticipantStatus, string> = {
  active: 'bg-blue-50 text-blue-700',
  paused: 'bg-amber-50 text-amber-800',
  delivering: 'bg-green-50 text-green-700',
}

function formatDate(value: string | null): string {
  if (!value) return '予定なし'
  return new Date(value).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ParticipantAvatar({ participant }: { participant: ScenarioParticipant }) {
  if (participant.pictureUrl) {
    return (
      <img
        src={participant.pictureUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    )
  }

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-600">
      {participant.displayName.slice(0, 1)}
    </span>
  )
}

interface Props {
  scenarioId: string
  scenarioActive: boolean
  onChanged?: () => void
}

export default function ScenarioParticipants({ scenarioId, scenarioActive, onChanged }: Props) {
  const [items, setItems] = useState<ScenarioParticipant[]>([])
  const [counts, setCounts] = useState({ active: 0, paused: 0, delivering: 0 })
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionTarget, setActionTarget] = useState<ScenarioParticipant | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const requestRef = useRef(0)

  const loadParticipants = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.participants(scenarioId, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: appliedSearch || undefined,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      if (requestId !== requestRef.current) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setItems(res.data.items)
      setCounts(res.data.counts)
      setTotal(res.data.total)
    } catch {
      if (requestId === requestRef.current) {
        setError('進行中の友だちを読み込めませんでした')
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [appliedSearch, page, scenarioId, statusFilter])

  useEffect(() => {
    void loadParticipants()
  }, [loadParticipants])

  const selectStatus = (nextStatus: StatusFilter) => {
    setPage(0)
    setStatusFilter(nextStatus)
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextSearch = searchInput.trim()
    if (page === 0 && appliedSearch === nextSearch) {
      void loadParticipants()
      return
    }
    setPage(0)
    setAppliedSearch(nextSearch)
  }

  const runAction = async () => {
    if (!actionTarget || actionTarget.status === 'delivering') return
    const action = actionTarget.status === 'paused' ? 'resume' : 'pause'
    setActionBusy(true)
    setActionError('')
    try {
      const res = await api.friends.updateScenarioStatus(
        actionTarget.friendId,
        actionTarget.id,
        action,
      )
      if (!res.success) {
        setActionError(res.error)
        return
      }
      setActionTarget(null)
      await loadParticipants()
      onChanged?.()
    } catch {
      setActionError(action === 'pause' ? '配信を一時停止できませんでした' : '配信を再開できませんでした')
    } finally {
      setActionBusy(false)
    }
  }

  const allCount = counts.active + counts.paused + counts.delivering
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1
  const end = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <section id="participants" className="mb-6 scroll-mt-4 border-y border-gray-200 bg-white sm:rounded-lg sm:border">
      <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">進行中の友だち</h2>
            <p className="mt-1 text-sm text-gray-500">
              配信待ちと一時停止中の友だちを確認し、一人ずつ停止・再開できます。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadParticipants()}
            disabled={loading}
            className="min-h-11 shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? '更新中...' : '最新の状態に更新'}
          </button>
        </div>

        {!scenarioActive && allCount > 0 && (
          <p className="mt-3 border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            このシナリオ全体が停止中です。各友だちが「配信待ち」でも、シナリオを有効にするまで次のメッセージは送られません。
          </p>
        )}

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-full gap-1 overflow-x-auto pb-1" aria-label="配信状態で絞り込み">
            {([
              ['all', 'すべて', allCount],
              ['active', '配信待ち', counts.active],
              ['paused', '一時停止', counts.paused],
              ['delivering', '送信処理中', counts.delivering],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => selectStatus(value)}
                className={`min-h-10 shrink-0 rounded-md px-3 text-sm font-medium ${statusFilter === value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {label} {count}
              </button>
            ))}
          </div>

          <form onSubmit={submitSearch} className="flex w-full gap-2 lg:w-auto">
            <label htmlFor="scenario-participant-search" className="sr-only">友だち名を検索</label>
            <input
              id="scenario-participant-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="友だち名で検索"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 lg:w-64"
            />
            <button type="submit" className="min-h-11 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800">
              検索
            </button>
          </form>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:px-6">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-gray-500 sm:px-6">読み込み中...</p>
      ) : items.length === 0 ? (
        <div className="px-4 py-10 text-center sm:px-6">
          <p className="text-sm font-medium text-gray-700">該当する友だちはいません</p>
          <p className="mt-1 text-sm text-gray-500">
            {appliedSearch ? '検索条件を変えて確認してください。' : '完了した友だちは、この一覧には含まれません。'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map((participant) => (
            <div key={participant.id} className="grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(220px,1.3fr)_130px_170px_150px_112px] lg:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <ParticipantAvatar participant={participant} />
                <div className="min-w-0">
                  <Link
                    href={`/chats?friend=${encodeURIComponent(participant.friendId)}`}
                    className="block truncate text-sm font-semibold text-gray-900 hover:text-green-700 hover:underline"
                  >
                    {participant.displayName}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{participant.sentSteps}/{participant.totalSteps}通送信済み</span>
                    {!participant.isFollowing && <span className="font-medium text-red-600">ブロック中</span>}
                  </div>
                </div>
              </div>

              <div>
                <span className="mr-2 text-xs text-gray-400 lg:hidden">状態</span>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[participant.status]}`}>
                  {statusLabels[participant.status]}
                </span>
              </div>

              <div className="text-sm text-gray-700">
                <span className="mr-2 text-xs text-gray-400 lg:block">現在位置</span>
                ステップ {participant.currentStepOrder}
              </div>

              <div className="text-sm text-gray-700">
                <span className="mr-2 text-xs text-gray-400 lg:block">
                  {participant.status === 'paused' ? '停止前の次回予定' : '次回予定'}
                </span>
                {formatDate(participant.nextDeliveryAt)}
              </div>

              <div className="lg:text-right">
                {participant.status === 'delivering' ? (
                  <span className="text-xs text-gray-500">送信完了後に操作可能</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setActionError(''); setActionTarget(participant) }}
                    className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium ${participant.status === 'paused' ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-red-200 text-red-700 hover:bg-red-50'}`}
                  >
                    {participant.status === 'paused' ? '再開' : '一時停止'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm sm:px-6">
          <span className="text-gray-500">{start}〜{end}件 / 全{total}件</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || loading}
              className="min-h-10 rounded-md border border-gray-300 px-3 text-gray-700 disabled:opacity-40"
            >
              前へ
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={end >= total || loading}
              className="min-h-10 rounded-md border border-gray-300 px-3 text-gray-700 disabled:opacity-40"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <ConfirmSheet
        open={Boolean(actionTarget)}
        title={actionTarget?.status === 'paused' ? 'この友だちへの配信を再開' : 'この友だちへの配信を一時停止'}
        message={actionTarget
          ? actionTarget.status === 'paused'
            ? `「${actionTarget.displayName}」への残り配信を再開します。停止時点で残っていた待ち時間から続行します。`
            : `「${actionTarget.displayName}」への残り配信だけを一時停止します。他の友だちには影響しません。`
          : undefined}
        confirmLabel={actionTarget?.status === 'paused' ? '再開する' : '一時停止する'}
        tone={actionTarget?.status === 'paused' ? 'default' : 'danger'}
        busy={actionBusy}
        error={actionError}
        onClose={() => { if (!actionBusy) { setActionTarget(null); setActionError('') } }}
        onConfirm={() => void runAction()}
      />
    </section>
  )
}
