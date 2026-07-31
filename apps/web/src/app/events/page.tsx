'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { eventsApi, type EventListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { formatJstDateTime } from '@line-crm/shared'
import { EmptyState, PageHeader } from '@/components/ui'

// next_slot_starts_at は「現在時刻以降の有効な枠の最小 starts_at」。
// null は「枠が未作成」だけでなく「全枠が開催済み」でも返るため、
// 「日時未設定」と表示するとイベント設定漏れと誤認させる。
function formatNextSlot(iso: string | null): string {
  if (!iso) return '今後の開催枠なし'
  return `次回 ${formatJstDateTime(iso, { withYear: true })} (JST)`
}

export default function EventsListPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<EventListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    try {
      const res = await eventsApi.listEvents(selectedAccountId)
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const pendingTotal = items.reduce((sum, e) => sum + (e.pending_count ?? 0), 0)

  return (
    <>
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="イベント一覧"
          description="日時を指定したイベントを作成し、LIFF 経由で友だちに予約してもらえます"
          actions={
            <Link
              href="/events/new"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              ＋ 新しいイベント
            </Link>
          }
        />

        {/* 承認待ちが 1 件でもあれば、一覧を読む前に予約管理へ飛べるようにする。 */}
        {pendingTotal > 0 && (
          <Link
            href="/events/bookings"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 min-h-14 hover:bg-amber-100 active:bg-amber-100 transition-colors"
          >
            <span className="text-sm font-bold text-amber-900">
              承認待ちの予約 {pendingTotal} 件
            </span>
            <span className="text-sm font-medium text-amber-800 whitespace-nowrap">確認する →</span>
          </Link>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            読み込み中...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <EmptyState
              iconPath="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2m5-7v3m4-3v3"
              title="イベントが作成されていません"
              description="友だちに告知する勉強会・説明会・オフ会などをここから作成します。"
              action={
                <Link
                  href="/events/new"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  最初のイベントを作成
                </Link>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {items.map((e) => {
              const crossAccountIds: string[] = Array.isArray(e.account_ids)
                ? e.account_ids
                : typeof e.account_ids === 'string'
                  ? (() => { try { return JSON.parse(e.account_ids) as string[] } catch { return [] } })()
                  : []
              return (
                // カード全体を 1 つのリンクにせず、「編集」と「予約を確認」を
                // 別々の大きなタップ領域に分ける。スマホでは予約確認の方が
                // 使用頻度が高く、編集画面を経由させたくない。
                <div
                  key={e.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col"
                >
                  <Link href={`/events/edit?id=${e.id}`} className="block hover:bg-gray-50 active:bg-gray-50">
                    {e.image_url ? (
                      <img
                        src={e.image_url}
                        alt={e.name}
                        className="w-full h-24 sm:h-32 object-cover bg-gray-100"
                      />
                    ) : (
                      <div className="w-full h-14 sm:h-32 bg-gradient-to-br from-blue-100 to-blue-200" />
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-semibold text-gray-900 line-clamp-2 flex-1">{e.name}</div>
                        <div className="flex flex-col gap-1 shrink-0 items-end">
                          {e.is_published === 1 ? (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              公開中
                            </span>
                          ) : (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              下書き
                            </span>
                          )}
                          {e.target_type === 'multi-account-dedup' && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                              横断 {crossAccountIds.length} アカ
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatNextSlot(e.next_slot_starts_at)}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-sm">
                        <span className="text-gray-700">
                          予約 <span className="font-semibold">{e.total_active}</span>
                          {e.total_capacity != null && <span className="text-gray-400"> / {e.total_capacity}</span>}
                        </span>
                        {e.pending_count > 0 && (
                          <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-0.5 rounded-full">
                            承認待ち {e.pending_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                  <Link
                    href={`/events/bookings?id=${e.id}`}
                    className="mt-auto flex items-center justify-between gap-2 border-t border-gray-100 px-4 min-h-12 text-sm font-medium text-blue-600 hover:bg-blue-50 active:bg-blue-50"
                  >
                    予約を確認
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
