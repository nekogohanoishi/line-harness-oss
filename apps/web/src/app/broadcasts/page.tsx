'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type BroadcastInsight } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import BroadcastDetail, {
  broadcastMessageTypeLabels,
  broadcastStatusConfig,
  broadcastTargetText,
  formatBroadcastTime,
} from '@/components/broadcasts/broadcast-detail'
import CcPromptButton from '@/components/cc-prompt-button'
import { EmptyState } from '@/components/ui'

const ccPrompts = [
  {
    title: '配信メッセージを作成',
    prompt: `一斉配信用のメッセージを作成してください。
1. 配信目的: [目的を指定]
2. ターゲット: 全員 / タグ指定
3. メッセージタイプ: テキスト / 画像 / Flex
効果的なメッセージ文面を提案してください。`,
  },
  {
    title: '配信スケジュール最適化',
    prompt: `配信スケジュールを最適化してください。
1. 過去の配信実績から最適な時間帯を分析
2. 曜日別の開封率を確認
3. 推奨スケジュールを提案
データに基づいた根拠も示してください。`,
  },
]

export default function BroadcastsPage() {
  const searchParams = useSearchParams()
  const detailId = searchParams.get('id')

  // If ?id=xxx is present, show detail view
  if (detailId) {
    return <BroadcastDetail broadcastId={detailId} />
  }

  return <BroadcastList />
}

type BroadcastTab = 'single' | 'dedup' | 'all'

function BroadcastList() {
  const { selectedAccountId } = useAccount()
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [insights, setInsights] = useState<Record<string, BroadcastInsight>>({})
  const [fetchingInsight, setFetchingInsight] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<BroadcastTab>('all')

  const loadInsight = async (id: string) => {
    try {
      const res = await api.broadcasts.getInsight(id)
      if (res.success && res.data) {
        setInsights(prev => ({ ...prev, [id]: res.data! }))
      }
    } catch { /* ignore */ }
  }

  const handleFetchInsight = async (id: string) => {
    setFetchingInsight(id)
    try {
      const res = await api.broadcasts.fetchInsight(id)
      if (res.success && res.data) {
        setInsights(prev => ({ ...prev, [id]: res.data }))
      }
    } catch {
      setError('インサイトの取得に失敗しました')
    } finally {
      setFetchingInsight(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [broadcastsRes, tagsRes] = await Promise.all([
        api.broadcasts.list({ accountId: selectedAccountId || undefined }),
        api.tags.list(),
      ])
      if (broadcastsRes.success) setBroadcasts(broadcastsRes.data)
      else setError(broadcastsRes.error)
      if (tagsRes.success) setTags(tagsRes.data)
    } catch {
      setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  // 送信済みbroadcastのinsightを読み込み
  useEffect(() => {
    broadcasts.filter(b => b.status === 'sent').forEach(b => loadInsight(b.id))
  }, [broadcasts])

  const handleDelete = async (id: string) => {
    if (!confirm('この配信を削除してもよいですか？')) return
    try {
      await api.broadcasts.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const getTagName = (tagId: string | null) => {
    if (!tagId) return null
    return tags.find((t) => t.id === tagId)?.name ?? null
  }

  /** 状態・送信日時・送り先を、日本語の1文にまとめる (状態の色つきラベルは呼び出し側で先頭に付ける) */
  const renderSummary = (broadcast: ApiBroadcast) => {
    const when = broadcast.status === 'sent'
      ? (broadcast.sentAt ? `${formatBroadcastTime(broadcast.sentAt)} に送信しました` : '送信しました')
      : broadcast.status === 'sending'
        ? 'いま送信しています'
        : broadcast.status === 'scheduled'
          ? (broadcast.scheduledAt ? `${formatBroadcastTime(broadcast.scheduledAt)} に送信予定` : '送信日時は未設定です')
          : 'まだ送っていません'
    const target = broadcastTargetText(broadcast, getTagName(broadcast.targetTagId))
    return (
      <>
        {`${when}。送り先は`}
        {broadcast.targetType === 'multi-account-dedup' ? <span className="text-purple-700">{target}</span> : target}
        。
      </>
    )
  }

  /** 送信実績 + LINE インサイト (送信済みの行の下に1行で出す) */
  const renderInsight = (broadcast: ApiBroadcast) => {
    const insight = insights[broadcast.id]
    return (
      <div className="flex flex-wrap items-center gap-x-3">
        <span className="font-medium text-gray-700">実績</span>
        {broadcast.totalCount > 0 && (
          <span>{broadcast.successCount.toLocaleString('ja-JP')} / {broadcast.totalCount.toLocaleString('ja-JP')} 件</span>
        )}
        {insight ? (
          <>
            {insight.delivered != null && (
              <span>配信 <span className="font-medium text-gray-700">{insight.delivered.toLocaleString('ja-JP')}</span></span>
            )}
            {insight.uniqueImpression != null && (
              <span>開封 <span className="font-medium text-blue-600">{insight.uniqueImpression.toLocaleString('ja-JP')}</span>
                {insight.openRate != null && (
                  <span className="text-gray-500"> ({(insight.openRate * 100).toFixed(1)}%)</span>
                )}
              </span>
            )}
            {insight.uniqueClick != null && (
              <span>クリック <span className="font-medium text-green-600">{insight.uniqueClick.toLocaleString('ja-JP')}</span>
                {insight.clickRate != null && (
                  <span className="text-gray-500"> ({(insight.clickRate * 100).toFixed(1)}%)</span>
                )}
              </span>
            )}
          </>
        ) : (
          <button
            onClick={() => handleFetchInsight(broadcast.id)}
            disabled={fetchingInsight === broadcast.id}
            className="min-h-[44px] sm:min-h-0 text-sm font-medium text-blue-700 hover:underline disabled:opacity-50"
          >
            {fetchingInsight === broadcast.id ? '取得中...' : 'インサイトを取得'}
          </button>
        )}
      </div>
    )
  }

  // タブで分類: 単アカ配信 (multi-account-dedup 以外) と 複アカ重複除外配信 を分ける。
  // 全件タブは未フィルタ。サイドバー account context のフィルタは API 側で済んでる。
  const dedupCount = broadcasts.filter((b) => b.targetType === 'multi-account-dedup').length
  const singleCount = broadcasts.length - dedupCount
  const visibleBroadcasts = broadcasts.filter((b) => {
    if (activeTab === 'all') return true
    if (activeTab === 'dedup') return b.targetType === 'multi-account-dedup'
    return b.targetType !== 'multi-account-dedup'
  })

  return (
    <div>
      <Header
        title="一斉配信"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規配信
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <BroadcastForm
          tags={tags}
          onSuccess={() => { setShowCreate(false); load() }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Tabs */}
      {!loading && broadcasts.length > 0 && (
        <div className="mb-4 flex gap-1 border-b border-gray-200 overflow-x-auto">
          {([
            { id: 'all', label: '全部', count: broadcasts.length },
            { id: 'single', label: '通常の配信', count: singleCount },
            { id: 'dedup', label: '複数アカウント', count: dedupCount },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 min-h-[44px] text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-green-500 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              style={activeTab === tab.id ? { borderColor: '#06C755' } : undefined}
            >
              {tab.label}
              <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0 rounded-full bg-gray-100 text-xs text-gray-600 min-w-[20px]">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 1件ずつ濃い区切り線で分け、状態・送信日時・送り先は日本語の1文で出す */}
      {loading ? (
        <ul aria-hidden className="animate-pulse">
          {[...Array(4)].map((_, i) => (
            <li key={i} className="space-y-2 border-b border-gray-300 px-1 py-4">
              <div className="h-3 w-48 max-w-full rounded bg-gray-200" />
              <div className="h-2 w-72 max-w-full rounded bg-gray-100" />
            </li>
          ))}
        </ul>
      ) : broadcasts.length === 0 ? (
        // 最初の1件を作成中は、作成フォームだけを見せる
        showCreate ? null : (
          <EmptyState
            title="配信がありません"
            description="「新規配信」から作成してください。"
          />
        )
      ) : visibleBroadcasts.length === 0 ? (
        <EmptyState
          size="sm"
          title={activeTab === 'dedup' ? '複数アカ重複除外配信はまだありません' : 'このタブに該当する配信はありません'}
        />
      ) : (
        <ul>
          {visibleBroadcasts.map((broadcast) => {
            const status = broadcastStatusConfig[broadcast.status]
            const canDelete = broadcast.status === 'draft' || broadcast.status === 'scheduled'
            return (
              <li key={broadcast.id} className="border-b border-gray-300 sm:flex sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/broadcasts?id=${broadcast.id}`}
                    className="group block rounded-md px-1 py-3.5 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    <span className="block text-[15px] font-semibold leading-6 text-blue-700 break-words group-hover:underline">
                      {broadcast.title}
                      <span className="ml-2 text-xs font-normal text-gray-500">{broadcastMessageTypeLabels[broadcast.messageType]}</span>
                    </span>
                    <span className="mt-0.5 block text-sm leading-6 text-gray-600 break-words">
                      <span className={`mr-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                      {renderSummary(broadcast)}
                    </span>
                  </Link>
                  {broadcast.status === 'sent' && (
                    <div className="-mt-1 px-1 pb-3 text-[13px] leading-6 text-gray-600">{renderInsight(broadcast)}</div>
                  )}
                </div>
                {canDelete && (
                  <div className="flex justify-end px-1 pb-3 sm:shrink-0 sm:pb-0 sm:pt-2">
                    <button
                      onClick={() => handleDelete(broadcast.id)}
                      className="px-3 py-1 min-h-[44px] text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                    >
                      削除
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
