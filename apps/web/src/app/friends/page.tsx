'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendListItem } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
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

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
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
    setLoading(true)
    setError('')
    try {
      const res = await api.friends.list({
        offset: String((page - 1) * PAGE_SIZE),
        limit: PAGE_SIZE,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
        followStatus: followStatusFilter === 'all' ? undefined : followStatusFilter,
      })
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter, followStatusFilter])

  useEffect(() => {
    loadTags()
  }, [loadTags])

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

  return (
    <div>
      <Header
        title="友だちリスト"
        description="友だちの検索や、詳細情報の確認ができます。"
      />

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
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-900 px-1.5 text-[11px] font-medium text-white">
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

        {/* Secondary filters — 並び順 + タグ + 対応マーク + LINE状態
            モバイルでは縦積み（トグルで開閉）、sm 以上では従来どおり横並び。 */}
        <div
          className={`mt-3 gap-3 border-t border-gray-100 pt-3 sm:flex sm:flex-wrap sm:items-center ${
            filtersOpen ? 'grid grid-cols-1' : 'hidden'
          }`}
        >
          <FilterField label="並び順">
            <select
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 sm:h-auto sm:w-auto sm:py-1.5 sm:text-xs"
              value={sortMode}
              onChange={(e) => handleSortChange(e.target.value as SortMode)}
            >
              <option value="recent">友だち追加の新しい順</option>
              <option value="oldest">友だち追加の古い順</option>
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
          <FilterField label="LINE状態">
            <select
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 sm:h-auto sm:w-auto sm:py-1.5 sm:text-xs"
              value={followStatusFilter}
              onChange={(e) => handleFollowStatusChange(e.target.value as FollowStatusFilter)}
            >
              <option value="all">すべて</option>
              <option value="following">フォロー中</option>
              <option value="blocked">ブロック中</option>
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
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex flex-col gap-3 animate-pulse lg:grid lg:grid-cols-[80px_220px_120px_1fr_280px]">
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

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
