'use client'

// Webinar Launch (migration 041): edit ページの「ウェビナー設定」タブ全体。
// 中身は (1) 動画アップロード (2) CTA タイムライン (3) 視聴統計。
// event-form.tsx の WebinarSettingsTab 名で呼ばれる。

import { useCallback, useEffect, useState } from 'react'
import { webinarApi, type EventDetail, type EventListItem, type WebinarCtaItem } from '@/lib/api'
import VideoUpload from './video-upload'
import CtaList from './cta-list'
import WebinarStats from './webinar-stats'
import RecurrenceList from './recurrence-list'
import CartSettings from './cart-settings'
import LiveFeelSettings from './live-feel-settings'

interface Props {
  accountId: string
  eventId: string
  event: EventDetail
  setEvent: (next: EventDetail) => void
}

type Subtab = 'video' | 'cta' | 'recurrence' | 'cart' | 'live-feel' | 'stats'

const SUBTABS: Array<{ key: Subtab; label: string; sub: string }> = [
  { key: 'video', label: '動画', sub: 'R2 へのアップロード・差し替え' },
  { key: 'cta', label: 'CTA タイムライン', sub: '時間連動で表示するボタン' },
  { key: 'recurrence', label: 'スロット自動生成', sub: '毎日◯時に開催を再現' },
  { key: 'cart', label: 'カート期間', sub: 'CTA URL の切替・閉鎖演出' },
  { key: 'live-feel', label: 'ライブ感', sub: '同接表示の ON/OFF・床値' },
  { key: 'stats', label: '視聴統計', sub: '予約者・完視聴率・CTA別CTR' },
]

export default function WebinarSettingsTab({ accountId, eventId, event, setEvent }: Props) {
  const [subtab, setSubtab] = useState<Subtab>('video')
  const [ctas, setCtas] = useState<WebinarCtaItem[]>([])
  const [ctaLoaded, setCtaLoaded] = useState(false)
  const [ctaError, setCtaError] = useState<string | null>(null)

  const refreshCtas = useCallback(async () => {
    setCtaError(null)
    try {
      const r = await webinarApi.getCtaList(eventId, accountId)
      setCtas(r.items)
    } catch (e) {
      setCtaError(e instanceof Error ? e.message : String(e))
    } finally {
      setCtaLoaded(true)
    }
  }, [accountId, eventId])

  useEffect(() => {
    void refreshCtas()
  }, [refreshCtas])

  // VideoUpload は EventListItem 型を返す (worker は SELECT * を返すので
  // 列は同じだが TypeScript の型上は別)。EventDetail へ部分マージする。
  function applyEventUpdate(next: EventListItem) {
    setEvent({
      ...event,
      kind: next.kind ?? event.kind,
      video_r2_key: next.video_r2_key ?? null,
      video_duration_seconds: next.video_duration_seconds ?? null,
      video_mime_type: next.video_mime_type ?? null,
      video_size_bytes: next.video_size_bytes ?? null,
    })
  }

  return (
    <div>
      {/* subtab nav */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 -mt-2">
        {SUBTABS.map((t) => {
          const active = subtab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubtab(t.key)}
              className={`px-4 py-2 text-sm border-b-2 ${
                active
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div>{t.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{t.sub}</div>
            </button>
          )
        })}
      </div>

      {subtab === 'video' && (
        <VideoUpload
          accountId={accountId}
          eventId={eventId}
          event={event}
          onEventUpdated={applyEventUpdate}
        />
      )}

      {subtab === 'cta' && (
        <div>
          {ctaError && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3 text-sm">
              {ctaError}
            </div>
          )}
          {!ctaLoaded ? (
            <div className="text-sm text-gray-500">CTA を読み込み中...</div>
          ) : (
            <CtaList
              accountId={accountId}
              eventId={eventId}
              ctas={ctas}
              videoDurationSeconds={event.video_duration_seconds ?? null}
              onRefresh={refreshCtas}
            />
          )}
        </div>
      )}

      {subtab === 'recurrence' && (
        <RecurrenceList accountId={accountId} eventId={eventId} />
      )}

      {subtab === 'cart' && (
        <CartSettings accountId={accountId} eventId={eventId} event={event} setEvent={setEvent} />
      )}

      {subtab === 'live-feel' && (
        <LiveFeelSettings accountId={accountId} eventId={eventId} event={event} setEvent={setEvent} />
      )}

      {subtab === 'stats' && (
        <WebinarStats accountId={accountId} eventId={eventId} />
      )}
    </div>
  )
}
