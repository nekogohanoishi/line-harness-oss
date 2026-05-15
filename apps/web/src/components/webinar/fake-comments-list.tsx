'use client'

// Phase 7b (migration 043): webinar_fake_comments の管理 UI.
// 既存 CTA エディタと似たテーブル形式で個別 CRUD + CSV 風一括追加 (bulk POST).

import { useCallback, useEffect, useState } from 'react'
import {
  webinarApi,
  type WebinarFakeComment,
  type WebinarFakeCommentInput,
} from '@/lib/api'

interface Props {
  accountId: string
  eventId: string
  videoDurationSeconds: number | null
}

interface FormState {
  at_seconds: number
  author_name: string
  body: string
  author_color: string
  sort_order: number
}

function emptyForm(): FormState {
  return { at_seconds: 0, author_name: '', body: '', author_color: '', sort_order: 0 }
}

function formatMmSs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// "MM:SS" → seconds. fallback: bare seconds.
function parseMmSs(value: string): number | null {
  const trimmed = value.trim()
  const m = /^(\d+):(\d{1,2})$/.exec(trimmed)
  if (m) {
    const min = parseInt(m[1], 10)
    const sec = parseInt(m[2], 10)
    if (!Number.isFinite(min) || !Number.isFinite(sec)) return null
    if (sec >= 60) return null
    return min * 60 + sec
  }
  const n = parseInt(trimmed, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export default function FakeCommentsList({ accountId, eventId, videoDurationSeconds }: Props) {
  const [items, setItems] = useState<WebinarFakeComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bulkText, setBulkText] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const r = await webinarApi.listFakeComments(eventId, accountId)
      setItems(r.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [accountId, eventId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function startEdit(c: WebinarFakeComment) {
    setEditingId(c.id)
    setForm({
      at_seconds: c.at_seconds,
      author_name: c.author_name,
      body: c.body,
      author_color: c.author_color ?? '',
      sort_order: c.sort_order,
    })
  }
  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm())
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const payload: WebinarFakeCommentInput = {
        at_seconds: form.at_seconds,
        author_name: form.author_name,
        body: form.body,
        author_color: form.author_color.trim() || null,
        sort_order: form.sort_order,
      }
      if (editingId) {
        await webinarApi.updateFakeComment(eventId, editingId, accountId, payload)
      } else {
        await webinarApi.createFakeComment(eventId, accountId, payload)
      }
      setForm(emptyForm())
      setEditingId(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('このコメントを削除しますか？')) return
    setError(null)
    try {
      await webinarApi.deleteFakeComment(eventId, id, accountId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleBulk() {
    setBulkBusy(true)
    setBulkMsg(null)
    setError(null)
    try {
      const lines = bulkText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
      const rows: WebinarFakeCommentInput[] = []
      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(',')
        if (parts.length < 3) {
          throw new Error(`${i + 1} 行目: フォーマット不正 (MM:SS,名前,本文)`)
        }
        const sec = parseMmSs(parts[0])
        const name = parts[1].trim()
        const body = parts.slice(2).join(',').trim()
        if (sec == null) throw new Error(`${i + 1} 行目: 時刻が読めません`)
        if (!name || !body) throw new Error(`${i + 1} 行目: 名前または本文が空`)
        rows.push({ at_seconds: sec, author_name: name, body, sort_order: i })
      }
      if (rows.length === 0) {
        setBulkMsg('追加する行がありません')
        return
      }
      const r = await webinarApi.bulkCreateFakeComments(eventId, accountId, rows)
      setBulkMsg(`${r.inserted_count} 件を一括追加しました`)
      setBulkText('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-3 text-sm text-gray-700 leading-relaxed">
        動画の経過秒数に連動して、視聴ページ下部に流すコメントを管理します。
        本物のチャットではなく、ライブ感を演出するための固定コメントです。
        ON/OFF は「ライブ感」サブタブの「コメント演出」スイッチで切り替えます。
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3 text-sm">
          {error}
        </div>
      )}

      {/* Form */}
      <div className="border rounded-lg p-3 mb-4 bg-gray-50">
        <h3 className="text-sm font-semibold mb-2">
          {editingId ? 'コメントを編集' : 'コメントを追加'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
          <label className="block md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">時刻 (秒)</div>
            <input
              type="number"
              min={0}
              max={videoDurationSeconds ?? undefined}
              value={form.at_seconds}
              onChange={(e) =>
                setForm({ ...form, at_seconds: Math.max(0, parseInt(e.target.value, 10) || 0) })
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <div className="text-[10px] text-gray-500 mt-0.5">{formatMmSs(form.at_seconds)}</div>
          </label>
          <label className="block md:col-span-3">
            <div className="text-xs text-gray-600 mb-1">表示名 (最大30字)</div>
            <input
              type="text"
              maxLength={30}
              value={form.author_name}
              onChange={(e) => setForm({ ...form, author_name: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="block md:col-span-5">
            <div className="text-xs text-gray-600 mb-1">本文 (最大200字)</div>
            <input
              type="text"
              maxLength={200}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">色 (任意)</div>
            <input
              type="text"
              placeholder="#06C755"
              value={form.author_color}
              onChange={(e) => setForm({ ...form, author_color: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || form.author_name.length === 0 || form.body.length === 0}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50"
          >
            {submitting ? '保存中…' : editingId ? '更新' : '＋ 追加'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="px-3 py-1.5 border border-gray-300 text-sm rounded hover:bg-gray-50"
            >
              キャンセル
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-gray-500">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500 mb-4">まだコメントがありません。</div>
      ) : (
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="py-2 w-20">時刻</th>
              <th>名前</th>
              <th>本文</th>
              <th className="w-16">色</th>
              <th className="w-12">順</th>
              <th className="w-32" />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b last:border-b-0">
                <td className="py-2 font-mono text-xs">{formatMmSs(c.at_seconds)}</td>
                <td>{c.author_name}</td>
                <td className="text-gray-700">{c.body}</td>
                <td>
                  {c.author_color ? (
                    <span
                      className="inline-block w-4 h-4 rounded-full align-middle"
                      style={{ background: c.author_color }}
                      title={c.author_color}
                    />
                  ) : (
                    <span className="text-xs text-gray-400">auto</span>
                  )}
                </td>
                <td className="text-xs text-gray-500">{c.sort_order}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    className="text-blue-600 hover:underline text-xs mr-2"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="text-red-600 hover:underline text-xs"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Bulk add */}
      <div className="border rounded-lg p-3 bg-gray-50">
        <h3 className="text-sm font-semibold mb-1">CSV 風一括追加</h3>
        <div className="text-xs text-gray-500 mb-2">
          各行に <code className="bg-gray-200 px-1 rounded">MM:SS,名前,本文</code>
          {' '}を書いてください。「#」から始まる行はコメントとして無視されます。
        </div>
        <textarea
          rows={6}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={'# 例\n00:30,たろう,勉強になります！\n01:00,はなこ,これ知らなかった〜'}
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono"
        />
        <div className="flex gap-2 mt-2 items-center">
          <button
            type="button"
            onClick={handleBulk}
            disabled={bulkBusy || bulkText.trim().length === 0}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50"
          >
            {bulkBusy ? '追加中…' : '一括追加'}
          </button>
          {bulkMsg && <span className="text-sm text-green-700">{bulkMsg}</span>}
        </div>
      </div>
    </div>
  )
}
