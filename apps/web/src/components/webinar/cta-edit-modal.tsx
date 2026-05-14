'use client'

// Webinar Launch (migration 041): CTA 編集モーダル。
// 設計書 §4.2 webinar_cta_items の列を雑作なく編集できるシンプルなフォーム。
// action_type に応じて action_value の入力 UI を切り替え:
//   - url           : URL 入力
//   - tag           : タグ ID 文字列入力 (タグ一覧 API は別 Phase で連携)
//   - tracked_link  : 既存 tracked-links id を文字列入力 (UI 側で list 取得は
//                     Phase 3 範囲外。CTR の二重計測は worker 側で接続済み)
//   - close         : 入力不要
// 既存 auto-replies/edit-dialog.tsx と同じ overlay pattern を踏襲。

import { useState } from 'react'
import type { WebinarCtaItem, WebinarCtaInput, WebinarCtaDisplayMode, WebinarCtaActionType } from '@/lib/api'

interface Props {
  // 既存 CTA を編集するときは値を渡す。新規作成時は null。
  existing: WebinarCtaItem | null
  // 動画 duration。at_seconds の上限チェックに使う。null なら未アップロード。
  videoDurationSeconds: number | null
  onClose: () => void
  onSubmit: (payload: WebinarCtaInput) => Promise<void>
}

const DISPLAY_MODES: Array<{ value: WebinarCtaDisplayMode; label: string; desc: string }> = [
  { value: 'banner', label: 'バナー', desc: '画面上部に控えめに表示' },
  { value: 'modal', label: 'モーダル', desc: '中央にポップアップして注意喚起' },
  { value: 'sticky', label: 'スティッキー', desc: '画面下部に常時固定表示' },
]

const ACTION_TYPES: Array<{ value: WebinarCtaActionType; label: string }> = [
  { value: 'url', label: 'URL を開く' },
  { value: 'tag', label: 'タグを付与' },
  { value: 'tracked_link', label: 'tracked link を開く' },
  { value: 'close', label: '閉じる (操作なし)' },
]

function secondsToMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function mmSsToSeconds(value: string): number | null {
  // accept "M:SS" / "MM:SS" / 整数の秒
  if (/^\d+$/.test(value)) return Number(value)
  const m = /^(\d+):(\d{1,2})$/.exec(value.trim())
  if (!m) return null
  const mm = Number(m[1])
  const ss = Number(m[2])
  if (ss > 59) return null
  return mm * 60 + ss
}

export default function CtaEditModal({ existing, videoDurationSeconds, onClose, onSubmit }: Props) {
  const [atSeconds, setAtSeconds] = useState<string>(
    existing ? secondsToMmSs(existing.at_seconds) : '00:30',
  )
  const [displayMode, setDisplayMode] = useState<WebinarCtaDisplayMode>(
    existing?.display_mode ?? 'modal',
  )
  const [label, setLabel] = useState<string>(existing?.label ?? '詳細を見る')
  const [actionType, setActionType] = useState<WebinarCtaActionType>(
    existing?.action_type ?? 'url',
  )
  const [actionValue, setActionValue] = useState<string>(existing?.action_value ?? '')
  const [dismissAfter, setDismissAfter] = useState<string>(
    existing?.dismiss_after_seconds != null ? String(existing.dismiss_after_seconds) : '',
  )
  const [isActive, setIsActive] = useState<boolean>((existing?.is_active ?? 1) === 1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const sec = mmSsToSeconds(atSeconds)
    if (sec == null || sec < 0) {
      setError('表示位置は MM:SS または整数秒で入力してください')
      return
    }
    if (videoDurationSeconds != null && sec > videoDurationSeconds) {
      setError(`表示位置 (${sec}s) は動画の長さ (${videoDurationSeconds}s) を超えています`)
      return
    }
    if (!label.trim()) {
      setError('ボタン文言は必須です')
      return
    }
    if (label.length > 200) {
      setError('ボタン文言は 200 文字以内で入力してください')
      return
    }
    if (actionType !== 'close' && !actionValue.trim()) {
      setError('アクション値を入力してください (URL / タグ ID / tracked-link ID のいずれか)')
      return
    }
    let dismissAfterNum: number | null = null
    if (dismissAfter !== '') {
      const v = Number(dismissAfter)
      if (!Number.isInteger(v) || v <= 0) {
        setError('自動消滅秒数は 1 以上の整数で入力してください (空欄なら手動消滅のみ)')
        return
      }
      dismissAfterNum = v
    }
    const payload: WebinarCtaInput = {
      at_seconds: sec,
      display_mode: displayMode,
      label: label.trim(),
      action_type: actionType,
      action_value: actionType === 'close' ? null : actionValue.trim(),
      dismiss_after_seconds: dismissAfterNum,
      is_active: isActive ? 1 : 0,
    }
    setSaving(true)
    try {
      await onSubmit(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4 text-gray-900">
          {existing ? 'CTA を編集' : 'CTA を追加'}
        </h3>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">表示位置 (MM:SS)</span>
            <input
              type="text"
              value={atSeconds}
              onChange={(e) => setAtSeconds(e.target.value)}
              placeholder="02:30"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
            {videoDurationSeconds != null && (
              <p className="text-xs text-gray-500 mt-1">
                動画の長さ: {secondsToMmSs(videoDurationSeconds)} ({videoDurationSeconds} 秒)
              </p>
            )}
          </label>

          <div>
            <span className="text-sm font-medium text-gray-700 block mb-1.5">表示モード</span>
            <div className="grid grid-cols-3 gap-2">
              {DISPLAY_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setDisplayMode(m.value)}
                  className={`p-2 border-2 rounded-lg text-left ${
                    displayMode === m.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-bold">{m.label}</div>
                  <div className="text-[10px] text-gray-500">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">ボタン文言</span>
            <input
              type="text"
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: いますぐ申し込む"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">アクション</span>
            <select
              value={actionType}
              onChange={(e) => {
                setActionType(e.target.value as WebinarCtaActionType)
                setActionValue('')
              }}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {ACTION_TYPES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>

          {actionType !== 'close' && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                {actionType === 'url' && 'URL'}
                {actionType === 'tag' && 'タグ ID'}
                {actionType === 'tracked_link' && 'tracked link ID'}
              </span>
              <input
                type={actionType === 'url' ? 'url' : 'text'}
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                placeholder={
                  actionType === 'url'
                    ? 'https://example.com/lp'
                    : actionType === 'tag'
                    ? 'tag id (UUID 等)'
                    : 'tracked link id'
                }
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700">自動消滅秒数 (任意)</span>
            <input
              type="number"
              min={1}
              value={dismissAfter}
              onChange={(e) => setDismissAfter(e.target.value)}
              placeholder="空欄 → 手動で閉じる"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">N 秒後に自動で消す (banner/sticky 向け)</p>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span>有効化（OFF にすると視聴者には非表示）</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : existing ? '更新' : '追加'}
          </button>
        </div>
      </div>
    </div>
  )
}
