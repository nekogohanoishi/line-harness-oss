'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import type { Scenario } from '@line-crm/shared'
import {
  api,
  type ScenarioProgressItem,
  type ScenarioProgressStatus,
  type ScenarioProgressSummary,
} from '@/lib/api'

type ProgressFilter = ScenarioProgressStatus | 'current' | 'all'
type ScenarioWithCount = Scenario & { stepCount?: number }

const PAGE_SIZE = 30

const statusLabels: Record<ScenarioProgressStatus, string> = {
  active: '配信待ち',
  paused: '一時停止',
  delivering: '送信処理中',
  completed: '完了',
}

const statusStyles: Record<ScenarioProgressStatus, string> = {
  active: 'bg-sky-50 text-sky-700',
  paused: 'bg-amber-50 text-amber-800',
  delivering: 'bg-green-50 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

function formatDate(value: string | null): string {
  if (!value) return '予定なし'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時を確認できません'
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Avatar({ item }: { item: ScenarioProgressItem }) {
  if (item.pictureUrl) {
    return <img src={item.pictureUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-800">
      {item.displayName.slice(0, 1)}
    </span>
  )
}

function ProgressRail({ item }: { item: ScenarioProgressItem }) {
  const percentage = item.status === 'completed' ? 100
    : item.totalSteps > 0 ? Math.min(100, Math.round(item.passedSteps / item.totalSteps * 100))
      : 0
  const label = item.status === 'completed'
    ? 'すべて完了'
    : item.totalSteps === 0
      ? 'ステップ未設定'
      : item.passedSteps === 0
        ? '開始前'
        : `${item.passedSteps} / ${item.totalSteps}通目まで通過`
  const nextLabel = item.status === 'completed' || item.totalSteps === 0
    ? null
    : item.passedSteps < item.totalSteps
      ? `次は${item.passedSteps + 1}通目`
      : '最終ステップ通過後'

  return (
    <div className="min-w-[160px]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-800">{label}</span>
        <span className="shrink-0 text-gray-500">{nextLabel}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${item.scenarioName}の進行: ${label}`}
        aria-valuenow={item.status === 'completed' && item.totalSteps === 0 ? 1 : item.passedSteps}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, item.totalSteps)}
        className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100"
      >
        <div
          className={`h-full rounded-full ${item.status === 'completed' ? 'bg-gray-400' : 'bg-green-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

interface Props {
  scenarios: ScenarioWithCount[]
  accountId: string | null
  initialScenarioId?: string
}

export default function ScenarioProgress({ scenarios, accountId, initialScenarioId = '' }: Props) {
  const [summary, setSummary] = useState<ScenarioProgressSummary[]>([])
  const [items, setItems] = useState<ScenarioProgressItem[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<ProgressFilter>('current')
  const [scenarioId, setScenarioId] = useState(initialScenarioId)
  const [stage, setStage] = useState<number | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const requestRef = useRef(0)
  const accountRef = useRef(accountId)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const response = await api.scenarios.progress({
        accountId: accountId || undefined,
        scenarioId: scenarioId || undefined,
        status: filter,
        stage: stage ?? undefined,
        search: search || undefined,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      if (requestId !== requestRef.current) return
      if (!response.success) {
        setError(response.error)
        setSummary([])
        setItems([])
        setTotal(0)
        return
      }
      setSummary(response.data.summary)
      setItems(response.data.items)
      setTotal(response.data.total)
      setUpdatedAt(new Date())
    } catch {
      if (requestId === requestRef.current) {
        setError('進行状況を読み込めませんでした。もう一度お試しください。')
        setSummary([])
        setItems([])
        setTotal(0)
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [accountId, filter, page, scenarioId, search, stage])

  useEffect(() => {
    void load()
    return () => { requestRef.current += 1 }
  }, [load])

  useEffect(() => {
    if (accountRef.current === accountId) return
    accountRef.current = accountId
    setScenarioId('')
    setStage(null)
    setPage(0)
    setSummary([])
    setItems([])
  }, [accountId])

  const counts = useMemo(() => {
    const result = { active: 0, paused: 0, delivering: 0, completed: 0 }
    for (const entry of summary) result[entry.status] += entry.count
    return result
  }, [summary])
  const visibleCounts = useMemo(() => {
    const result = { active: 0, paused: 0, delivering: 0, completed: 0 }
    for (const entry of summary) {
      if (!scenarioId || entry.scenarioId === scenarioId) result[entry.status] += entry.count
    }
    return result
  }, [scenarioId, summary])
  const currentCount = visibleCounts.active + visibleCounts.paused + visibleCounts.delivering
  const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioId)
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1
  const end = Math.min((page + 1) * PAGE_SIZE, total)

  const changeFilter = (next: ProgressFilter) => {
    setPage(0)
    setStage(null)
    setFilter(next)
  }

  const selectScenario = (id: string, selectedStage: number | null = null) => {
    setPage(0)
    setScenarioId(id)
    setStage(selectedStage)
    if (selectedStage !== null) setFilter('current')
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = searchInput.trim()
    if (next === search && page === 0) {
      void load()
      return
    }
    setPage(0)
    setSearch(next)
  }

  if (scenarios.length === 0) {
    return <p className="border-y border-gray-200 bg-white px-5 py-10 text-sm text-gray-500 sm:rounded-lg sm:border">シナリオを作成すると、ここに進行状況が表示されます。</p>
  }

  return (
    <div className="space-y-5">
      <section className="border-y border-gray-200 bg-white sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">配信の現在地</h2>
            <p className="mt-1 text-sm text-gray-500">シナリオを選ぶと、その友だちと進行段階を下に表示します。</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? '更新中...' : '最新の状態に更新'}
          </button>
        </div>

        <div className="grid grid-cols-3 divide-x divide-gray-200 border-b border-gray-200 px-2 py-5 sm:px-6">
          <div className="px-2 sm:px-4">
            <p className="text-xs text-gray-500">配信待ち・処理中</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-green-700">{counts.active + counts.delivering}<span className="ml-1 text-sm font-normal text-gray-500">件</span></p>
          </div>
          <div className="px-2 sm:px-4">
            <p className="text-xs text-gray-500">一時停止</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">{counts.paused}<span className="ml-1 text-sm font-normal text-gray-500">件</span></p>
          </div>
          <div className="px-2 sm:px-4">
            <p className="text-xs text-gray-500">完了</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-700">{counts.completed}<span className="ml-1 text-sm font-normal text-gray-500">件</span></p>
          </div>
        </div>

        <div className="border-b border-gray-200 px-4 py-3 text-xs text-gray-500 sm:px-6">
          ステップの数字は「そこまで処理が進んだ位置」です。条件で送信を飛ばした場合も通過に含みます。人数はシナリオごとの参加件数です。
          {updatedAt && <span className="ml-2">{formatDate(updatedAt.toISOString())}時点</span>}
        </div>

        {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:px-6">{error}</p>}

        <div className="divide-y divide-gray-200">
          {scenarios.map((scenario) => {
            const stepCount = scenario.stepCount ?? 0
            const entries = summary.filter((entry) => entry.scenarioId === scenario.id)
            const ongoing = entries.filter((entry) => entry.status !== 'completed')
            const ongoingCount = ongoing.reduce((sum, entry) => sum + entry.count, 0)
            const completedCount = entries.filter((entry) => entry.status === 'completed').reduce((sum, entry) => sum + entry.count, 0)
            const stages = Array.from({ length: stepCount + 1 }, (_, index) => ongoing
              .filter((entry) => entry.passedSteps === index)
              .reduce((sum, entry) => sum + entry.count, 0))
            const maxStage = Math.max(1, ...stages)
            return (
              <div key={scenario.id} className={`px-4 py-4 sm:px-6 ${scenarioId === scenario.id ? 'bg-green-50/50' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => selectScenario(scenario.id)}
                      aria-pressed={scenarioId === scenario.id && stage === null}
                      className="text-left text-sm font-semibold text-gray-900 hover:text-green-700 hover:underline"
                    >
                      {scenario.name}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{stepCount}通</span>
                      <span>未完了 {ongoingCount}人</span>
                      <span>完了 {completedCount}人</span>
                      {!scenario.isActive && <span className="font-medium text-amber-700">シナリオ停止中</span>}
                    </div>
                  </div>
                  <Link href={`/scenarios/detail?id=${encodeURIComponent(scenario.id)}#participants`} className="shrink-0 text-xs font-medium text-green-700 hover:underline">詳細を見る →</Link>
                </div>
                <div className="mt-3 flex gap-1 overflow-x-auto pb-1" aria-label={`${scenario.name}の段階別人数`}>
                  {stages.map((count, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => selectScenario(scenario.id, index)}
                      aria-pressed={scenarioId === scenario.id && stage === index && filter === 'current'}
                      className={`relative min-h-[58px] min-w-[72px] flex-1 overflow-hidden rounded-md border px-2 py-2 text-left transition-colors hover:border-green-500 ${scenarioId === scenario.id && stage === index && filter === 'current' ? 'border-green-600 ring-1 ring-green-600' : 'border-gray-200'}`}
                    >
                      <span className="absolute inset-x-0 bottom-0 bg-green-100" style={{ height: `${count / maxStage * 100}%` }} aria-hidden="true" />
                      <span className="relative block whitespace-nowrap text-xs text-gray-600">{index === 0 ? '開始前' : `${index}通目まで`}</span>
                      <span className="relative mt-1 block text-base font-semibold tabular-nums text-gray-900">{count}<span className="ml-0.5 text-xs font-normal">人</span></span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="border-y border-gray-200 bg-white sm:rounded-lg sm:border">
        <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-900">友だちごとの進行状況</h2>
              <p className="mt-1 text-sm text-gray-500">{selectedScenario ? `「${selectedScenario.name}」${stage === null ? '' : `の${stage === 0 ? '開始前' : `${stage}通目まで`}`}` : 'すべてのシナリオ'}を表示中。未完了には一時停止も含みます。</p>
            </div>
            {scenarioId && <button type="button" onClick={() => selectScenario('')} className="min-h-10 text-sm font-medium text-green-700 hover:underline">絞り込みを解除</button>}
          </div>
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-1 overflow-x-auto pb-1" aria-label="配信状態で絞り込み">
              {([
                ['current', '未完了', currentCount],
                ['paused', '一時停止', visibleCounts.paused],
                ['completed', '完了', visibleCounts.completed],
                ['all', 'すべて', currentCount + visibleCounts.completed],
              ] as const).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeFilter(value)}
                  aria-pressed={filter === value}
                  className={`min-h-10 shrink-0 rounded-md px-3 text-sm font-medium ${filter === value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {label} {count}
                </button>
              ))}
            </div>
            <form onSubmit={submitSearch} className="flex w-full gap-2 lg:w-auto">
              <label htmlFor="scenario-progress-search" className="sr-only">友だち名・シナリオ名を検索</label>
              <input
                id="scenario-progress-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="友だち名・シナリオ名を検索"
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 lg:w-60"
              />
              <button type="submit" className="min-h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800">検索</button>
            </form>
          </div>
        </div>

        <div className="hidden grid-cols-[minmax(160px,1.1fr)_minmax(140px,1fr)_minmax(180px,1.5fr)_105px_125px] gap-4 border-b border-gray-200 bg-gray-50 px-6 py-2 text-xs font-medium text-gray-500 lg:grid">
          <span>友だち</span><span>シナリオ</span><span>現在地</span><span>状態</span><span>次の予定</span>
        </div>
        {loading && items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">読み込み中...</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">該当する友だちはいません。シナリオや状態を変えて確認してください。</p>
        ) : (
          <div className={`divide-y divide-gray-200 ${loading ? 'opacity-60' : ''}`}>
            {items.map((item) => (
              <div key={item.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(160px,1.1fr)_minmax(140px,1fr)_minmax(180px,1.5fr)_105px_125px] lg:items-center lg:gap-4 lg:px-6">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar item={item} />
                  <div className="min-w-0">
                    <Link href={`/chats?friend=${encodeURIComponent(item.friendId)}`} className="block truncate text-sm font-semibold text-gray-900 hover:text-green-700 hover:underline">{item.displayName}</Link>
                    {!item.isFollowing && <span className="text-xs font-medium text-red-600">ブロック中</span>}
                  </div>
                </div>
                <Link href={`/scenarios/detail?id=${encodeURIComponent(item.scenarioId)}#participants`} className="min-w-0 truncate text-sm text-gray-700 hover:text-green-700 hover:underline">{item.scenarioName}</Link>
                <ProgressRail item={item} />
                <div>
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusStyles[item.status]}`}>{statusLabels[item.status]}</span>
                  {!item.scenarioActive && item.status !== 'completed' && <span className="mt-1 block text-xs text-amber-700">全体停止中</span>}
                </div>
                <div className="text-sm text-gray-700">
                  <span className="mr-2 text-xs text-gray-400 lg:hidden">{item.status === 'paused' ? '停止前の予定' : '次の予定'}</span>
                  {item.status === 'completed' ? '—' : formatDate(item.nextDeliveryAt)}
                  {item.status === 'paused' && item.nextDeliveryAt && <span className="block text-xs text-gray-500">停止前の予定</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm sm:px-6">
            <span className="text-gray-500">{start}〜{end}件 / 全{total}件</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || loading} className="min-h-10 rounded-md border border-gray-300 px-3 disabled:opacity-40">前へ</button>
              <button type="button" onClick={() => setPage((value) => value + 1)} disabled={end >= total || loading} className="min-h-10 rounded-md border border-gray-300 px-3 disabled:opacity-40">次へ</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
