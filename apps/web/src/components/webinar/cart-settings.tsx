'use client'

// Phase 6b: events.cart_relative_close_minutes / cart_expired_redirect_url の
// 設定 UI。ウェビナー設定タブの「カート期間」サブタブから呼ばれる。

import { useState } from 'react'
import { eventsApi, type EventDetail } from '@/lib/api'

interface Props {
  accountId: string
  eventId: string
  event: EventDetail
  setEvent: (next: EventDetail) => void
}

const PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '30分', minutes: 30 },
  { label: '60分', minutes: 60 },
  { label: '24時間', minutes: 60 * 24 },
  { label: '48時間', minutes: 60 * 48 },
  { label: '72時間', minutes: 60 * 72 },
]

export default function CartSettings({ accountId, eventId, event, setEvent }: Props) {
  const [minutes, setMinutes] = useState<number | ''>(
    event.cart_relative_close_minutes ?? '',
  )
  const [redirectUrl, setRedirectUrl] = useState<string>(
    event.cart_expired_redirect_url ?? '',
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
        cart_relative_close_minutes: minutes === '' ? null : minutes,
        cart_expired_redirect_url: redirectUrl.trim().length === 0 ? null : redirectUrl.trim(),
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
        視聴完了時にカートを開き、設定した時間が経過すると CTA URL を案内ページへ自動で切り替えます。
        「あと2時間で閉鎖」「あと30分」といった希少性の演出に使えます。空欄ならカート期間管理は無効です。
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

      <label className="block mb-3">
        <div className="text-sm text-gray-600 mb-1">視聴完了から N 分後にカート閉鎖</div>
        <input
          type="number"
          min={0}
          value={minutes}
          onChange={(e) => {
            const v = e.target.value
            setMinutes(v === '' ? '' : parseInt(v, 10) || 0)
          }}
          placeholder="例: 60"
          className="w-40 border border-gray-300 rounded px-2 py-1 text-sm"
        />
        <span className="ml-2 text-xs text-gray-500">分 (空欄=無効)</span>
      </label>

      <div className="flex gap-2 mb-4 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.minutes}
            type="button"
            onClick={() => setMinutes(p.minutes)}
            className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMinutes('')}
          className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 text-gray-500"
        >
          無効化
        </button>
      </div>

      <label className="block mb-4">
        <div className="text-sm text-gray-600 mb-1">カート閉鎖後の遷移先 URL (任意)</div>
        <input
          type="url"
          value={redirectUrl}
          onChange={(e) => setRedirectUrl(e.target.value)}
          placeholder="https://example.com/next-webinar"
          className="w-full max-w-xl border border-gray-300 rounded px-2 py-1 text-sm"
        />
        <div className="text-xs text-gray-500 mt-1">
          指定すると閉鎖後の CTA クリックはこの URL に飛ばします。未指定なら CTA の元 URL がそのまま使われます。
        </div>
      </label>

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
