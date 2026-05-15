'use client'

// Phase 7a (migration 043): events.concurrent_floor / concurrent_jitter_max /
// show_concurrent_viewers / show_fake_comments の設定 UI.
// 同時視聴者数表示の on/off + floor/jitter, コメント演出の on/off を扱う.
// fake_comments の行データ管理は別タブ (FakeCommentsTab) で行う.

import { useState } from 'react'
import { eventsApi, type EventDetail } from '@/lib/api'

interface Props {
  accountId: string
  eventId: string
  event: EventDetail
  setEvent: (next: EventDetail) => void
}

export default function LiveFeelSettings({ accountId, eventId, event, setEvent }: Props) {
  const [showConcurrent, setShowConcurrent] = useState<boolean>(
    (event.show_concurrent_viewers ?? 0) === 1,
  )
  const [floor, setFloor] = useState<number | ''>(
    event.concurrent_floor != null ? event.concurrent_floor : 0,
  )
  const [jitter, setJitter] = useState<number | ''>(
    event.concurrent_jitter_max != null ? event.concurrent_jitter_max : 0,
  )
  const [showFakeComments, setShowFakeComments] = useState<boolean>(
    (event.show_fake_comments ?? 0) === 1,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const next = await eventsApi.updateEvent(accountId, eventId, {
        show_concurrent_viewers: showConcurrent ? 1 : 0,
        concurrent_floor: floor === '' ? 0 : floor,
        concurrent_jitter_max: jitter === '' ? 0 : jitter,
        show_fake_comments: showFakeComments ? 1 : 0,
      })
      setEvent({ ...event, ...next })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-4 text-sm text-gray-700 leading-relaxed">
        オートウェビナーに「本物の生配信」感を出すための演出を設定します。
        実際の視聴データに加えて、表示用の最低値・ランダム加算で安定した賑わいを演出できます。
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3 text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded-lg mb-3 text-sm">
          保存しました。
        </div>
      )}

      <div className="border rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">同時視聴者数</h3>
        <label className="flex items-center gap-2 mb-3 text-sm">
          <input
            type="checkbox"
            checked={showConcurrent}
            onChange={(e) => setShowConcurrent(e.target.checked)}
          />
          <span>視聴ページに「N 人が視聴中」を表示する</span>
        </label>

        <div className="grid grid-cols-2 gap-3 max-w-md">
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">最低表示人数 (fake floor)</div>
            <input
              type="number"
              min={0}
              value={floor}
              onChange={(e) => {
                const v = e.target.value
                setFloor(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0))
              }}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <div className="text-[11px] text-gray-500 mt-1">
              実視聴者がこれ未満ならこの数を表示
            </div>
          </label>

          <label className="block">
            <div className="text-xs text-gray-600 mb-1">ランダム加算 (jitter max)</div>
            <input
              type="number"
              min={0}
              value={jitter}
              onChange={(e) => {
                const v = e.target.value
                setJitter(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0))
              }}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <div className="text-[11px] text-gray-500 mt-1">
              +0〜N 人のランダム値を加算
            </div>
          </label>
        </div>
      </div>

      <div className="border rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">コメント演出</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showFakeComments}
            onChange={(e) => setShowFakeComments(e.target.checked)}
          />
          <span>動画下部にスクリプト化されたコメントを流す</span>
        </label>
        <div className="text-[11px] text-gray-500 mt-1">
          コメント本文・タイムスタンプは「コメント演出」サブタブで管理します。
          この設定を OFF にすると、行データはそのまま残しつつ視聴ページには表示されません。
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存'}
      </button>
    </div>
  )
}
