'use client'

// Webinar Launch (migration 041): 視聴統計ダッシュボード。
// データは GET /api/events/admin/events/:id/webinar/stats から取得。
// 仕様 (設計書 §5.1):
//   - 予約者総数 / 開封 / 視聴開始 / 完視聴 / 完視聴率
//   - CTA 別 CTR テーブル (unique 視聴者 / 開封者ベース)

import { useEffect, useState } from 'react'
import { webinarApi, type WebinarStats } from '@/lib/api'

interface Props {
  accountId: string
  eventId: string
}

function pct(n: number, d: number): string {
  if (d <= 0) return '-'
  return `${((n / d) * 100).toFixed(1)}%`
}

function secondsToMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export default function WebinarStats({ accountId, eventId }: Props) {
  const [stats, setStats] = useState<WebinarStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const s = await webinarApi.getWebinarStats(eventId, accountId)
        if (!cancelled) setStats(s)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [accountId, eventId])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const s = await webinarApi.getWebinarStats(eventId, accountId)
      setStats(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  if (loading && !stats) {
    return <div className="text-sm text-gray-500">統計を読み込み中...</div>
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
        統計の取得に失敗しました: {error}
      </div>
    )
  }
  if (!stats) return null

  const b = stats.bookings
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-600">予約者と視聴者の集計</div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? '更新中...' : '再読込'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard label="予約者" value={String(b.total)} />
        <StatCard label="開封" value={String(b.opened)} sub={pct(b.opened, b.total)} />
        <StatCard label="視聴開始" value={String(b.started)} sub={pct(b.started, b.opened)} />
        <StatCard label="完視聴" value={String(b.completed)} sub={pct(b.completed, b.started)} />
        <StatCard label="完視聴率 (vs 開封)" value={pct(b.completed, b.opened)} />
      </div>

      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">CTA 別 CTR</div>
        {stats.ctas.length === 0 ? (
          <div className="text-sm text-gray-500 italic">CTA が登録されていません</div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">位置</th>
                  <th className="text-left px-3 py-2 font-medium">ラベル</th>
                  <th className="text-right px-3 py-2 font-medium">unique クリック</th>
                  <th className="text-right px-3 py-2 font-medium">総クリック</th>
                  <th className="text-right px-3 py-2 font-medium">CTR (unique/開封)</th>
                </tr>
              </thead>
              <tbody>
                {stats.ctas.map((c) => (
                  <tr key={c.cta_id} className="border-t border-gray-200">
                    <td className="px-3 py-2 text-gray-800 font-mono">{secondsToMmSs(c.at_seconds)}</td>
                    <td className="px-3 py-2 text-gray-800">{c.label}</td>
                    <td className="px-3 py-2 text-right text-gray-800">{c.click_unique_count}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{c.click_total_count}</td>
                    <td className="px-3 py-2 text-right text-gray-800">
                      {(c.ctr_unique * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}
