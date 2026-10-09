'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendListItem, FriendSavedFilter } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import BlockedFriendList from '@/components/friends/blocked-friend-list'
import ManualRefreshButton from '@/components/ui/manual-refresh-button'
import CcPromptButton from '@/components/cc-prompt-button'
import { Sheet, SheetButton } from '@/components/ui'
import { useAccount } from '@/contexts/account-context'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const PAGE_SIZE = 20

// 絞り込み項目1つ分のラッパー。モバイルはラベルを上に置いた縦積み、
// sm 以上は従来どおりラベルとコントロールを横並びにする。
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="text-xs font-medium text-gray-600 whitespace-nowrap">{label}:</span>
      {children}
    </label>
  )
}

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type FollowStatusFilter = 'all' | 'following' | 'blocked'
type SavedFilterValues = FriendSavedFilter['filters']

// 保存した絞り込みどうしを比べるため、未指定のキーを落とした形にそろえる。
function filterKey(filters: SavedFilterValues): string {
  return JSON.stringify([filters.search ?? '', filters.tagId ?? '', filters.handled ?? '', filters.followStatus ?? '', filters.sort ?? ''])
}

// 保存した絞り込みの中身を「タグ「受講生」、未対応のみ」のような1文にする。
function describeFilters(filters: SavedFilterValues, tags: Tag[]): string {
  const parts: string[] = []
  if (filters.search) parts.push(`名前に「${filters.search}」を含む`)
  if (filters.tagId) parts.push(`タグ「${tags.find((tag) => tag.id === filters.tagId)?.name ?? '削除されたタグ'}」`)
  if (filters.handled === 'unhandled') parts.push('未対応のみ')
  if (filters.followStatus === 'following') parts.push('フォロー中のみ')
  if (filters.followStatus === 'blocked') parts.push('ブロック中のみ')
  if (filters.sort === 'oldest') parts.push('古い順')
  return parts.length > 0 ? parts.join('、') : '条件なし'
}

export default function FriendsPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [followStatusFilter, setFollowStatusFilter] = useState<FollowStatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // モバイルの絞り込みパネル開閉。sm 以上では常時表示のため参照されない。
  const [filtersOpen, setFiltersOpen] = useState(false)
  // 保存した絞り込み。アカウントごとにサーバーへ保存し、スマホと PC で共有する。
  const [savedFilters, setSavedFilters] = useState<FriendSavedFilter[]>([])
  const [savedSheetOpen, setSavedSheetOpen] = useState(false)
  const [newFilterName, setNewFilterName] = useState('')
  const [savingFilters, setSavingFilters] = useState(false)
  const [savedFiltersError, setSavedFiltersError] = useState('')
  const requestId = useRef(0)

  const currentFilters: SavedFilterValues = {
    ...(searchSubmitted ? { search: searchSubmitted } : {}),
    ...(selectedTagId ? { tagId: selectedTagId } : {}),
    ...(responseFilter === 'unhandled' ? { handled: 'unhandled' as const } : {}),
    ...(followStatusFilter !== 'all' ? { followStatus: followStatusFilter } : {}),
    ...(sortMode === 'oldest' ? { sort: 'oldest' as const } : {}),
  }
  const hasCurrentFilters = Object.keys(currentFilters).length > 0
  const currentFilterKey = filterKey(currentFilters)
  // 今の条件がすでに保存済みなら、同じものを二重に保存させない。
  const matchingSaved = savedFilters.find((saved) => filterKey(saved.filters) === currentFilterKey)
  const canSaveCurrent = hasCurrentFilters && !matchingSaved

  // 既定値から変更されている絞り込み条件の数。トグルのバッジと
  // 「絞り込みを解除」の表示可否に使う。
  const activeFilterCount =
    (selectedTagId ? 1 : 0) +
    (responseFilter !== 'all' ? 1 : 0) +
    (followStatusFilter !== 'all' ? 1 : 0) +
    (sortMode !== 'recent' ? 1 : 0)

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  const loadFriends = useCallback(async () => {
    if (accountLoading) return
    const currentRequest = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const res = await api.friends.list({
        offset: String((page - 1) * PAGE_SIZE),
        limit: PAGE_SIZE,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: followStatusFilter !== 'blocked',
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
        followStatus: followStatusFilter === 'all' ? undefined : followStatusFilter,
      })
      if (currentRequest !== requestId.current) return
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error)
      }
    } catch {
      if (currentRequest === requestId.current) {
        setError('友だちの読み込みに失敗しました。もう一度お試しください。')
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [accountLoading, page, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter, followStatusFilter])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  useEffect(() => {
    if (!selectedAccountId) {
      setSavedFilters([])
      return
    }
    let cancelled = false
    api.accountSettings.getFriendSavedFilters(selectedAccountId)
      .then((res) => { if (!cancelled && res.success) setSavedFilters(res.data) })
      .catch(() => { /* 保存した絞り込みが読めなくても一覧は使える */ })
    return () => { cancelled = true }
  }, [selectedAccountId])

  // Reset the URL-style account context to page 1 in a separate effect.
  // For user-driven filter changes (search/sort/handled/tag) we reset
  // page synchronously inside the handlers below — that avoids the
  // double-fetch race where the old `page` request resolves after the
  // new `page=1` request and overwrites the correct page-1 rows.
  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    loadFriends()
    return () => { requestId.current += 1 }
  }, [loadFriends])

  // Fan-out helpers: changing a filter also resets pagination synchronously,
  // so React batches both state updates into one re-render and `loadFriends`
  // fires exactly once with the new filter + page=1.
  const updateAndResetPage = (cb: () => void) => {
    cb()
    setPage(1)
  }
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateAndResetPage(() => setSearchSubmitted(searchInput.trim()))
  }
  // Clearing the input clears the active search even if the user doesn't
  // press 検索 again. Without this, "search Alice → clear input → change
  // tag" would keep filtering by Alice while the input box looks empty —
  // see codex feedback. Keeping a non-empty input that doesn't match
  // searchSubmitted is fine: the user is mid-edit, hasn't applied yet.
  const handleSearchInputChange = (v: string) => {
    setSearchInput(v)
    if (v.trim() === '' && searchSubmitted !== '') {
      updateAndResetPage(() => setSearchSubmitted(''))
    }
  }
  const handleSortChange = (v: SortMode) => updateAndResetPage(() => setSortMode(v))
  const handleResponseFilterChange = (v: ResponseFilter) => updateAndResetPage(() => setResponseFilter(v))
  const handleTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedTagId(v))
  const handleFollowStatusChange = (v: FollowStatusFilter) => updateAndResetPage(() => setFollowStatusFilter(v))
  const clearFilters = () => updateAndResetPage(() => {
    setSelectedTagId('')
    setResponseFilter('all')
    setFollowStatusFilter('all')
    setSortMode('recent')
  })

  const applySavedFilter = (saved: FriendSavedFilter) => updateAndResetPage(() => {
    setSearchInput(saved.filters.search ?? '')
    setSearchSubmitted(saved.filters.search ?? '')
    setSelectedTagId(saved.filters.tagId ?? '')
    setResponseFilter(saved.filters.handled ? 'unhandled' : 'all')
    setFollowStatusFilter(saved.filters.followStatus ?? 'all')
    setSortMode(saved.filters.sort ?? 'recent')
  })

  // 名前の候補は、いま選んでいる条件から作る (例: タグを選んでいればタグ名)。
  const suggestFilterName = () => {
    if (selectedTagId) return allTags.find((tag) => tag.id === selectedTagId)?.name ?? ''
    if (responseFilter === 'unhandled') return '未対応の人'
    if (followStatusFilter === 'blocked') return 'ブロック中の人'
    if (searchSubmitted) return `「${searchSubmitted}」で検索`
    return ''
  }

  const openSavedSheet = () => {
    setNewFilterName(suggestFilterName())
    setSavedFiltersError('')
    setSavedSheetOpen(true)
  }

  const persistSavedFilters = async (next: FriendSavedFilter[]) => {
    if (!selectedAccountId) return false
    setSavingFilters(true)
    setSavedFiltersError('')
    try {
      const res = await api.accountSettings.updateFriendSavedFilters(selectedAccountId, next)
      if (!res.success) {
        setSavedFiltersError(res.error || '保存できませんでした。もう一度お試しください。')
        return false
      }
      setSavedFilters(res.data)
      return true
    } catch {
      setSavedFiltersError('保存できませんでした。通信状況を確認して、もう一度お試しください。')
      return false
    } finally {
      setSavingFilters(false)
    }
  }

  const saveCurrentFilters = async () => {
    const name = newFilterName.trim()
    if (!name) {
      setSavedFiltersError('名前を入力してください。')
      return
    }
    const ok = await persistSavedFilters([...savedFilters, { id: crypto.randomUUID(), name, filters: currentFilters }])
    if (ok) setNewFilterName('')
  }

  const deleteSavedFilter = (id: string) => {
    void persistSavedFilters(savedFilters.filter((saved) => saved.id !== id))
  }

  return (
    <div>
      <Header
        title="友だちリスト"
        action={<ManualRefreshButton onClick={loadFriends} loading={loading} />}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200">
        <div className="flex" role="tablist" aria-label="友だちのLINE状態">
          {([
            { value: 'all', label: 'すべて' },
            { value: 'following', label: 'フォロー中' },
            { value: 'blocked', label: 'ブロック中' },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={followStatusFilter === value}
              onClick={() => handleFollowStatusChange(value)}
              className={`min-h-11 border-b-2 px-3 text-sm font-medium sm:px-4 ${followStatusFilter === value
                ? value === 'blocked' ? 'border-red-600 text-red-700' : 'border-green-600 text-green-800'
                : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Link href="/friend-events" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline">
          追加・ブロック履歴
        </Link>
      </div>

      {/* Search + sort bar — L-step style */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 sm:gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="友だち名を検索"
            className="h-11 min-w-0 flex-1 border border-gray-300 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 sm:h-10"
          />
          <button
            type="submit"
            className="h-11 flex-shrink-0 rounded-lg px-4 text-white text-sm font-medium sm:h-10"
            style={{ backgroundColor: '#06C755' }}
          >
            検索
          </button>
        </form>

        {/* よく使う絞り込み — スマホでも絞り込み欄を開かずに1回で呼び出せるよう、検索欄のすぐ下に置く */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-600">よく使う絞り込み</span>
          {savedFilters.map((saved) => {
            const active = filterKey(saved.filters) === currentFilterKey
            return (
              <button
                key={saved.id}
                type="button"
                onClick={() => applySavedFilter(saved)}
                aria-pressed={active}
                title={describeFilters(saved.filters, allTags)}
                className={`min-h-[36px] rounded-full border px-3 text-sm ${
                  active ? 'border-green-600 bg-green-50 font-semibold text-green-800' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                {saved.name}
              </button>
            )
          })}
          <button
            type="button"
            onClick={openSavedSheet}
            className="min-h-[36px] rounded-full px-2 text-sm font-medium text-blue-700 hover:underline"
          >
            {canSaveCurrent ? '＋ 今の条件を保存' : savedFilters.length > 0 ? '保存した絞り込みを管理' : '使い方'}
          </button>
        </div>

        {/* 絞り込みトグル — モバイルのみ。既定は畳んでおき、一覧を先に見せる。 */}
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className="mt-3 flex h-11 w-full items-center justify-between rounded-lg border border-gray-200 px-3 text-sm text-gray-700 sm:hidden"
        >
          <span className="flex items-center gap-2">
            絞り込み・並び順
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-900 px-1.5 text-xs font-medium text-white">
                {activeFilterCount}
              </span>
            )}
          </span>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Secondary filters — 並び順 + タグ + 対応マーク
            モバイルでは縦積み（トグルで開閉）、sm 以上では従来どおり横並び。 */}
        <div
          className={`mt-3 gap-3 border-t border-gray-200 pt-3 sm:flex sm:flex-wrap sm:items-center ${
            filtersOpen ? 'grid grid-cols-1' : 'hidden'
          }`}
        >
          <FilterField label="並び順">
            <select
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 sm:h-auto sm:w-auto sm:py-1.5 sm:text-xs"
              value={sortMode}
              onChange={(e) => handleSortChange(e.target.value as SortMode)}
            >
              <option value="recent">{followStatusFilter === 'blocked' ? 'ブロック日時の新しい順' : '友だち追加の新しい順'}</option>
              <option value="oldest">{followStatusFilter === 'blocked' ? 'ブロック日時の古い順' : '友だち追加の古い順'}</option>
            </select>
          </FilterField>
          <FilterField label="タグ">
            <select
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 sm:h-auto sm:w-auto sm:py-1.5 sm:text-xs"
              value={selectedTagId}
              onChange={(e) => handleTagFilterChange(e.target.value)}
            >
              <option value="">すべて</option>
              {allTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="対応マーク">
            <select
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 sm:h-auto sm:w-auto sm:py-1.5 sm:text-xs"
              value={responseFilter}
              onChange={(e) => handleResponseFilterChange(e.target.value as ResponseFilter)}
            >
              <option value="all">すべて</option>
              <option value="unhandled">未対応のみ</option>
            </select>
          </FilterField>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50 sm:h-auto sm:border-0 sm:px-0 sm:text-xs sm:underline"
            >
              絞り込みを解除
            </button>
          )}
          <span className="hidden text-xs text-gray-500 sm:ml-auto sm:inline">
            {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
          </span>
        </div>

        <p className="mt-3 text-xs text-gray-500 sm:hidden">
          {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            // スケルトンも本体と同じブレークポイントで切り替える。5カラムの
            // グリッドを常時適用すると、読み込み中だけモバイルで横にはみ出す。
            <div key={i} className="px-4 py-4 border-b border-gray-200 flex flex-col gap-3 animate-pulse lg:grid lg:grid-cols-[80px_220px_120px_1fr_280px]">
              <div className="h-5 bg-gray-100 rounded w-16" />
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="h-3 bg-gray-200 rounded w-24" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-20" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : error ? null : followStatusFilter === 'blocked' ? (
        <BlockedFriendList friends={friends} filtered={Boolean(searchSubmitted || selectedTagId || responseFilter !== 'all')} />
      ) : (
        <FriendListTable friends={friends} allTags={allTags} onRefresh={loadFriends} />
      )}

      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          <p className="text-sm text-gray-500">
            {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
          </p>
          {/* モバイルでは前へ/次へを均等に伸ばして親指で押せる幅を確保する。 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex-1 sm:flex-none px-4 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 px-1 whitespace-nowrap">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="flex-1 sm:flex-none px-4 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <Sheet
        open={savedSheetOpen}
        onClose={() => { if (!savingFilters) setSavedSheetOpen(false) }}
        title="よく使う絞り込み"
        description="タグや対応マークなどの組み合わせに名前を付けて保存すると、次から1回押すだけで同じ条件の一覧を出せます。スマホとパソコンで共通です。"
        busy={savingFilters}
        footer={
          <>
            <SheetButton onClick={() => setSavedSheetOpen(false)}>閉じる</SheetButton>
            {canSaveCurrent && (
              <SheetButton variant="primary" onClick={() => void saveCurrentFilters()} busy={savingFilters} busyLabel="保存中...">
                今の条件を保存
              </SheetButton>
            )}
          </>
        }
      >
        <section>
          <h3 className="text-sm font-semibold text-gray-900">今の条件</h3>
          {matchingSaved ? (
            <p className="mt-1 text-sm leading-6 text-gray-700">
              {describeFilters(currentFilters, allTags)}。この条件は「{matchingSaved.name}」として保存済みです。
            </p>
          ) : hasCurrentFilters ? (
            <>
              <p className="mt-1 text-sm text-gray-700">{describeFilters(currentFilters, allTags)}</p>
              <label className="mt-3 block">
                <span className="text-sm font-medium text-gray-700">保存する名前</span>
                <input
                  type="text"
                  value={newFilterName}
                  onChange={(e) => setNewFilterName(e.target.value)}
                  maxLength={30}
                  placeholder="例: 受講生"
                  className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </label>
            </>
          ) : (
            <p className="mt-1 text-sm leading-6 text-gray-600">
              いまは条件を選んでいません。「絞り込み・並び順」でタグや対応マークを選んでから、もう一度ここを開いてください。
            </p>
          )}
          {savedFiltersError && <p role="alert" className="mt-2 text-sm text-red-700">{savedFiltersError}</p>}
        </section>

        <section className="mt-6 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-900">保存した絞り込み</h3>
          {savedFilters.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">まだありません。</p>
          ) : (
            <ul className="mt-1">
              {savedFilters.map((saved) => (
                <li key={saved.id} className="flex items-center justify-between gap-3 border-b border-gray-200 py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 break-words">{saved.name}</p>
                    <p className="text-xs text-gray-600 break-words">{describeFilters(saved.filters, allTags)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteSavedFilter(saved.id)}
                    disabled={savingFilters}
                    aria-label={`「${saved.name}」を削除`}
                    className="min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Sheet>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
