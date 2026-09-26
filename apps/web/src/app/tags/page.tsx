'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import Header from '@/components/layout/header'
import TagBadge from '@/components/friends/tag-badge'
import { api } from '@/lib/api'

const presetColors = [
  { value: '#3B82F6', label: '青' },
  { value: '#10B981', label: '緑' },
  { value: '#F59E0B', label: '黄' },
  { value: '#EF4444', label: '赤' },
  { value: '#8B5CF6', label: '紫' },
  { value: '#EC4899', label: '桃' },
  { value: '#06B6D4', label: '水色' },
  { value: '#6B7280', label: '灰' },
]

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof Error && error.message.includes(String(status))
}

export default function TagsPage() {
  const [items, setItems] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(presetColors[0].value)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.tags.list({ withCounts: true })
      if (response.success) setItems(response.data)
      else setError(response.error)
    } catch {
      setError('タグの読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleCreate = async () => {
    if (saving) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('タグ名を入力してください。')
      return
    }
    if (items.some((tag) => tag.name === trimmedName)) {
      setError(`「${trimmedName}」はすでに登録されています。`)
      return
    }

    setSaving(true)
    setError('')
    try {
      await api.tags.create({ name: trimmedName, color })
      setName('')
      setCreating(false)
      await load()
    } catch (err) {
      setError(hasStatus(err, 409)
        ? `「${trimmedName}」はすでに登録されています。`
        : 'タグの作成に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tag: Tag) => {
    const friendCount = tag.friendCount ?? 0
    const message = friendCount > 0
      ? `「${tag.name}」は${friendCount}人に付いています。削除すると全員から外れます。削除しますか？`
      : `「${tag.name}」を削除しますか？`
    if (!confirm(message)) return

    setError('')
    try {
      await api.tags.delete(tag.id)
      await load()
    } catch (err) {
      setError(hasStatus(err, 409)
        ? `「${tag.name}」は他の設定で使用中のため削除できません。`
        : 'タグの削除に失敗しました。')
    }
  }

  return (
    <div>
      <Header
        title="タグ管理"
        description="友だちの分類に使うタグを作成・削除します。"
        action={(
          <button
            type="button"
            onClick={() => {
              setCreating((current) => !current)
              setError('')
            }}
            className="px-4 py-2 min-h-11 text-sm font-medium text-white rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規タグ
          </button>
        )}
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {creating && (
        <div className="mb-4 p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">タグ名</label>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void handleCreate() }}
                placeholder="例: 個別指導に興味あり"
                autoFocus
                className="w-full px-3 py-2 min-h-11 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">表示色</label>
              <div className="flex flex-wrap items-center gap-2">
                {presetColors.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setColor(item.value)}
                    className={`w-8 h-8 rounded-full border-2 ${color === item.value ? 'border-gray-900 ring-2 ring-gray-300' : 'border-white'}`}
                    style={{ backgroundColor: item.value }}
                    aria-label={`${item.label}を選択`}
                    title={item.label}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="w-8 h-8 p-0 border border-gray-300 rounded cursor-pointer"
                  aria-label="その他の色を選択"
                  title="その他の色"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={saving}
                className="px-4 py-2 min-h-11 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : '作成'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  setName('')
                }}
                className="px-4 py-2 min-h-11 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">タグ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">対象の友だち</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">作成日</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">読み込み中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">タグはまだありません。</td></tr>
              ) : items.map((tag) => (
                <tr key={tag.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><TagBadge tag={tag} /></td>
                  <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">{tag.friendCount ?? 0}人</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {tag.createdAt ? new Date(tag.createdAt).toLocaleDateString('ja-JP') : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void handleDelete(tag)}
                      className="px-3 py-2 min-h-11 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
