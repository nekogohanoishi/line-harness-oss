'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type BroadcastInsight } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import BroadcastDetail from '@/components/broadcasts/broadcast-detail'
import CcPromptButton from '@/components/cc-prompt-button'
import { ResponsiveTable, EmptyState } from '@/components/ui'

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

const statusConfig: Record<
  ApiBroadcast['status'],
  { label: string; className: string }
> = {
  draft: { label: '下書き', className: 'bg-gray-100 text-gray-600' },
  scheduled: { label: '予約済み', className: 'bg-blue-100 text-blue-700' },
  sending: { label: '送信中', className: 'bg-yellow-100 text-yellow-700' },
  sent: { label: '送信完了', className: 'bg-green-100 text-green-700' },
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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

  /** 配信対象 (全員 / タグ / 複アカ重複除外) の表示 */
  const renderTarget = (broadcast: ApiBroadcast) => {
    const tagName = getTagName(broadcast.targetTagId)
    if (broadcast.targetType === 'multi-account-dedup') {
      return <span className="text-purple-700">重複除外{tagName ? `: ${tagName}` : ''}</span>
    }
    if (broadcast.targetType === 'all') return '全員'
    return tagName ? <span>タグ: {tagName}</span> : 'タグ指定'
  }

  /** 送信実績 + LINE インサイト */
  const renderInsight = (broadcast: ApiBroadcast) => {
    if (broadcast.status !== 'sent') return '-'
    const insight = insights[broadcast.id]
    return (
      <div>
        {broadcast.totalCount > 0 && (
          <p>{broadcast.successCount.toLocaleString('ja-JP')} / {broadcast.totalCount.toLocaleString('ja-JP')} 件</p>
        )}
        {insight ? (
          <div className="mt-1 space-y-0.5">
            {insight.delivered != null && (
              <p className="text-xs">配信: <span className="font-medium text-gray-700">{insight.delivered.toLocaleString('ja-JP')}</span></p>
            )}
            {insight.uniqueImpression != null && (
              <p className="text-xs">開封: <span className="font-medium text-blue-600">{insight.uniqueImpression.toLocaleString('ja-JP')}</span>
                {insight.openRate != null && (
                  <span className="text-gray-400"> ({(insight.openRate * 100).toFixed(1)}%)</span>
                )}
              </p>
            )}
            {insight.uniqueClick != null && (
              <p className="text-xs">クリック: <span className="font-medium text-green-600">{insight.uniqueClick.toLocaleString('ja-JP')}</span>
                {insight.clickRate != null && (
                  <span className="text-gray-400"> ({(insight.clickRate * 100).toFixed(1)}%)</span>
                )}
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={() => handleFetchInsight(broadcast.id)}
            disabled={fetchingInsight === broadcast.id}
            className="mt-1 min-h-[44px] sm:min-h-0 text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
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
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
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
            { id: 'single', label: '単アカ配信', count: singleCount },
            { id: 'dedup', label: '複アカ重複除外', count: dedupCount },
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

      {/* Loading */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : broadcasts.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <EmptyState
            title="配信がありません"
            description="「新規配信」から作成してください。"
          />
        </div>
      ) : (
        <ResponsiveTable
          rows={visibleBroadcasts}
          rowKey={(broadcast) => broadcast.id}
          className="shadow-sm"
          empty={
            <EmptyState
              size="sm"
              title={activeTab === 'dedup' ? '複数アカ重複除外配信はまだありません' : 'このタブに該当する配信はありません'}
            />
          }
          columns={[
            {
              key: 'title',
              label: '配信タイトル',
              priority: 'primary',
              render: (broadcast) => (
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={`/broadcasts?id=${broadcast.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline break-words">
                      {broadcast.title}
                    </a>
                    {broadcast.targetType === 'multi-account-dedup' && (
                      <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                        複アカ
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-normal text-gray-400 mt-0.5">
                    {broadcast.messageType === 'text' ? 'テキスト' : broadcast.messageType === 'image' ? '画像' : 'Flex'}
                  </p>
                </div>
              ),
            },
            {
              key: 'status',
              label: 'ステータス',
              priority: 'meta',
              render: (broadcast) => (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig[broadcast.status].className}`}>
                  {statusConfig[broadcast.status].label}
                </span>
              ),
            },
            { key: 'target', label: '配信対象', render: renderTarget },
            { key: 'scheduledAt', label: '予約日時', render: (broadcast) => formatDatetime(broadcast.scheduledAt) },
            { key: 'sentAt', label: '送信完了日時', render: (broadcast) => formatDatetime(broadcast.sentAt) },
            { key: 'insight', label: '実績', render: renderInsight },
          ]}
          actions={(broadcast) =>
            broadcast.status === 'draft' || broadcast.status === 'scheduled' ? (
              <button
                onClick={() => handleDelete(broadcast.id)}
                className="px-3 py-1 min-h-[44px] text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
              >
                削除
              </button>
            ) : null
          }
        />
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
