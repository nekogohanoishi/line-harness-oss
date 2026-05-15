'use client'

// Phase 6a: 予約枠の自動生成ルール一覧 + シンプル CRUD UI。
// 設計指示通り、最低 textarea で JSON 直入力できれば良いレベル + 視認性向上分。

import { useCallback, useEffect, useState } from 'react'
import { webinarApi, type WebinarRecurrenceItem, type WebinarRecurrenceInput } from '@/lib/api'

interface Props {
  accountId: string
  eventId: string
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

function formatWeekdays(json: string | null): string {
  if (!json) return '毎日'
  try {
    const arr = JSON.parse(json) as number[]
    return arr.map((w) => WEEKDAY_LABELS[w] ?? '?').join('・')
  } catch {
    return json
  }
}

function formatTimes(json: string): string {
  try {
    const arr = JSON.parse(json) as string[]
    return arr.join(' / ')
  } catch {
    return json
  }
}

export default function RecurrenceList({ accountId, eventId }: Props) {
  const [items, setItems] = useState<WebinarRecurrenceItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const r = await webinarApi.listRecurrence(eventId, accountId)
      setItems(r.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [accountId, eventId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // ---- form state for create ----
  const [patternType, setPatternType] = useState<'daily' | 'weekly'>('daily')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [timesText, setTimesText] = useState('10:00, 20:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [capacity, setCapacity] = useState<number | ''>(50)
  const [daysAhead, setDaysAhead] = useState(14)
  const [submitting, setSubmitting] = useState(false)

  async function handleCreate() {
    setSubmitting(true)
    setError(null)
    try {
      const times = timesText
        .split(/[\s,、]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const payload: WebinarRecurrenceInput = {
        pattern_type: patternType,
        times,
        duration_minutes: durationMinutes,
        capacity: capacity === '' ? null : capacity,
        generate_days_ahead: daysAhead,
      }
      if (patternType === 'weekly') {
        payload.weekdays = weekdays
      }
      await webinarApi.createRecurrence(eventId, accountId, payload)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(recId: string) {
    if (!confirm('このルールを削除しますか？既存の予約枠は残ります。')) return
    try {
      await webinarApi.deleteRecurrence(eventId, recId, accountId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleRunNow(recId: string) {
    try {
      const r = await webinarApi.runRecurrenceNow(eventId, recId, accountId)
      alert(
        `生成完了: 追加${r.inserted}件 / 重複スキップ${r.skippedDuplicate}件 / エラー${r.errors}件`,
      )
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3 text-sm">
          {error}
        </div>
      )}

      {/* 既存ルール一覧 */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-800 mb-2">既存のルール</h3>
        {!loaded ? (
          <div className="text-sm text-gray-500">読み込み中…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-gray-500">まだルールはありません。</div>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div
                key={it.id}
                className="border border-gray-200 rounded-lg p-3 flex items-center justify-between"
              >
                <div className="text-sm">
                  <div className="font-medium text-gray-900">
                    {it.pattern_type === 'daily' ? '毎日' : formatWeekdays(it.weekdays_json)}
                    {' '}
                    {formatTimes(it.times_json)}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    所要 {it.duration_minutes} 分 / 定員{' '}
                    {it.capacity ?? '∞'} / 先 {it.generate_days_ahead} 日まで生成
                    {it.last_generated_through ? ` / 直近生成 ${it.last_generated_through}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleRunNow(it.id)}
                    className="text-xs px-2 py-1 border border-blue-500 text-blue-600 rounded hover:bg-blue-50"
                  >
                    今すぐ生成
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(it.id)}
                    className="text-xs px-2 py-1 border border-red-500 text-red-600 rounded hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新規作成フォーム */}
      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-medium text-gray-800 mb-3">新しいルールを追加</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <label className="text-sm">
            <div className="text-gray-600 mb-1">パターン</div>
            <select
              value={patternType}
              onChange={(e) => setPatternType(e.target.value as 'daily' | 'weekly')}
              className="w-full border border-gray-300 rounded px-2 py-1"
            >
              <option value="daily">毎日</option>
              <option value="weekly">曜日指定</option>
            </select>
          </label>

          {patternType === 'weekly' && (
            <label className="text-sm">
              <div className="text-gray-600 mb-1">曜日 (複数選択可)</div>
              <div className="flex gap-1 flex-wrap">
                {WEEKDAY_LABELS.map((lbl, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => {
                      setWeekdays((prev) =>
                        prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort(),
                      )
                    }}
                    className={`px-2 py-1 text-xs rounded border ${
                      weekdays.includes(i)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </label>
          )}
        </div>

        <label className="text-sm block mb-3">
          <div className="text-gray-600 mb-1">時刻 (カンマ区切り, HH:MM, JST)</div>
          <input
            type="text"
            value={timesText}
            onChange={(e) => setTimesText(e.target.value)}
            placeholder="10:00, 20:00, 22:00"
            className="w-full border border-gray-300 rounded px-2 py-1"
          />
          <div className="text-xs text-gray-500 mt-1">例: 10:00, 20:00 (それぞれ 1 件の予約枠が生成されます)</div>
        </label>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <label className="text-sm">
            <div className="text-gray-600 mb-1">所要時間 (分)</div>
            <input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 0)}
              className="w-full border border-gray-300 rounded px-2 py-1"
            />
          </label>
          <label className="text-sm">
            <div className="text-gray-600 mb-1">定員 (空欄=制限なし)</div>
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => {
                const v = e.target.value
                setCapacity(v === '' ? '' : parseInt(v, 10) || 0)
              }}
              className="w-full border border-gray-300 rounded px-2 py-1"
            />
          </label>
          <label className="text-sm">
            <div className="text-gray-600 mb-1">先N日まで生成</div>
            <input
              type="number"
              min={1}
              max={365}
              value={daysAhead}
              onChange={(e) => setDaysAhead(parseInt(e.target.value, 10) || 14)}
              className="w-full border border-gray-300 rounded px-2 py-1"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50"
        >
          {submitting ? '作成中…' : 'ルールを追加'}
        </button>
      </div>
    </div>
  )
}
