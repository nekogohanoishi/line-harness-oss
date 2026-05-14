'use client'

// Webinar Launch (migration 041): CTA タイムライン一覧 + 編集/削除エントリ。
// at_seconds 昇順で並べ、各行に編集・削除ボタンを表示する。
// 編集モーダルは cta-edit-modal.tsx、コンテナは webinar-settings-tab.tsx。

import { useState } from 'react'
import { webinarApi, type WebinarCtaItem, type WebinarCtaInput } from '@/lib/api'
import CtaEditModal from './cta-edit-modal'

interface Props {
  accountId: string
  eventId: string
  ctas: WebinarCtaItem[]
  videoDurationSeconds: number | null
  onRefresh: () => Promise<void>
}

function secondsToMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const MODE_LABELS: Record<WebinarCtaItem['display_mode'], string> = {
  banner: 'バナー',
  modal: 'モーダル',
  sticky: 'スティッキー',
}

const ACTION_LABELS: Record<WebinarCtaItem['action_type'], string> = {
  url: 'URL',
  tag: 'タグ',
  tracked_link: 'tracked link',
  close: '閉じる',
}

export default function CtaList({ accountId, eventId, ctas, videoDurationSeconds, onRefresh }: Props) {
  const [editing, setEditing] = useState<WebinarCtaItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function createCta(payload: WebinarCtaInput) {
    setBusy(true)
    try {
      await webinarApi.createCta(eventId, accountId, payload)
      await onRefresh()
      setShowAdd(false)
    } finally {
      setBusy(false)
    }
  }

  async function updateCta(payload: WebinarCtaInput) {
    if (!editing) return
    setBusy(true)
    try {
      await webinarApi.updateCta(eventId, editing.id, accountId, payload)
      await onRefresh()
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  async function deleteCta(id: string) {
    setBusy(true)
    setErr(null)
    try {
      await webinarApi.deleteCta(eventId, id, accountId)
      await onRefresh()
      setConfirmDeleteId(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-600">{ctas.length} 件の CTA</div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          disabled={videoDurationSeconds == null}
          title={videoDurationSeconds == null ? '動画を先にアップロードしてください' : '新規 CTA を追加'}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          ＋ CTA を追加
        </button>
      </div>
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3 text-sm">{err}</div>
      )}

      {ctas.length === 0 ? (
        <div className="text-center py-10 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
          まだ CTA がありません。
          {videoDurationSeconds == null
            ? ' 動画をアップロードすると追加できるようになります。'
            : ' 「＋ CTA を追加」から作成してください。'}
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium">位置</th>
                <th className="text-left px-3 py-2 font-medium">表示モード</th>
                <th className="text-left px-3 py-2 font-medium">ラベル</th>
                <th className="text-left px-3 py-2 font-medium">アクション</th>
                <th className="text-left px-3 py-2 font-medium">状態</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {ctas.map((c) => (
                <tr key={c.id} className="border-t border-gray-200">
                  <td className="px-3 py-2 text-gray-800 font-mono">{secondsToMmSs(c.at_seconds)}</td>
                  <td className="px-3 py-2 text-gray-700">{MODE_LABELS[c.display_mode]}</td>
                  <td className="px-3 py-2 text-gray-800">{c.label}</td>
                  <td className="px-3 py-2 text-gray-700">
                    <div className="text-xs">{ACTION_LABELS[c.action_type]}</div>
                    {c.action_value && (
                      <div className="text-[11px] text-gray-500 font-mono truncate max-w-[240px]" title={c.action_value}>
                        {c.action_value}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.is_active === 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {c.is_active === 1 ? '有効' : '停止'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      className="text-xs text-blue-600 hover:underline mr-2"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(c.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <CtaEditModal
          existing={null}
          videoDurationSeconds={videoDurationSeconds}
          onClose={() => setShowAdd(false)}
          onSubmit={createCta}
        />
      )}
      {editing && (
        <CtaEditModal
          existing={editing}
          videoDurationSeconds={videoDurationSeconds}
          onClose={() => setEditing(null)}
          onSubmit={updateCta}
        />
      )}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold mb-2 text-gray-900">CTA を削除しますか？</h3>
            <p className="text-sm text-gray-600 mb-4">
              削除後、視聴者にはこの CTA が表示されなくなります。視聴ログ
              (cta-click) は保持されます。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => deleteCta(confirmDeleteId)}
                disabled={busy}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
