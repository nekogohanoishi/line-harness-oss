'use client'

import { useEffect, useState } from 'react'
import type { DeliveryMode, ScenarioTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    triggerType: ScenarioTriggerType
    triggerTagId: string | null
    deliveryMode: DeliveryMode
  }) => Promise<void>
}

const triggerOptions: Array<{
  value: ScenarioTriggerType
  label: string
  description: string
}> = [
  {
    value: 'friend_add',
    label: '友だち追加時',
    description: '新規友だち追加のタイミングで自動開始',
  },
  {
    value: 'tag_added',
    label: 'タグ付与時',
    description: '指定タグが付いたタイミングで自動開始（カスケード運用向け）',
  },
  {
    value: 'manual',
    label: '手動',
    description: '管理画面 / API から明示的に開始するときだけ流れる',
  },
]

export default function ScenarioModePicker({ open, onClose, onCreate }: Props) {
  const [stage, setStage] = useState<'pick' | 'name' | 'confirm'>('pick')
  const [mode, setMode] = useState<DeliveryMode>('elapsed')
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<ScenarioTriggerType>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState<string>('')
  const [tags, setTags] = useState<Tag[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // tags 一覧を取得 (tag_added 選択時のドロップダウン用)
  useEffect(() => {
    if (!open) return
    api.tags
      .list()
      .then((res) => {
        if (res.success) setTags(res.data)
      })
      .catch(() => {})
  }, [open])

  if (!open) return null

  const reset = () => {
    setStage('pick')
    setName('')
    setMode('elapsed')
    setTriggerType('friend_add')
    setTriggerTagId('')
    setError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('シナリオ名を入力してください')
      return
    }
    if (triggerType === 'tag_added' && !triggerTagId) {
      setError('トリガータグを選択してください')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onCreate({
        name,
        triggerType,
        triggerTagId: triggerType === 'tag_added' ? triggerTagId : null,
        deliveryMode: mode,
      })
      reset()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const moveToConfirmation = () => {
    if (!name.trim()) {
      setError('シナリオ名を入力してください')
      return
    }
    if (triggerType === 'tag_added' && !triggerTagId) {
      setError('開始に使うタグを選択してください')
      return
    }
    setError('')
    setStage('confirm')
  }

  const modeLabel = mode === 'absolute_time'
    ? '指定した時刻に配信'
    : mode === 'elapsed'
      ? '開始からの経過時間で配信'
      : '前のステップからの待ち時間で配信'
  const triggerLabel = triggerOptions.find((option) => option.value === triggerType)?.label ?? '未設定'
  const triggerTagName = tags.find((tag) => tag.id === triggerTagId)?.name

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-4 sm:p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'pick' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">配信方式を選択</h2>
            <div className="divide-y divide-gray-200 border-y border-gray-200">
              <button
                onClick={() => {
                  setMode('absolute_time')
                  setStage('name')
                }}
                className="flex min-h-[88px] w-full items-center justify-between gap-4 px-2 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <span>
                  <span className="block font-semibold text-gray-900">指定した時刻に配信</span>
                  <span className="mt-1 block text-sm text-gray-600">例：開始の翌日、朝9時</span>
                  <span className="mt-1 block text-xs text-green-700">深夜を避けて決まった時刻に送れます</span>
                </span>
                <span className="text-gray-400" aria-hidden="true">›</span>
              </button>
              <button
                onClick={() => {
                  setMode('elapsed')
                  setStage('name')
                }}
                className="flex min-h-[88px] w-full items-center justify-between gap-4 px-2 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <span>
                  <span className="block font-semibold text-gray-900">開始からの経過時間で配信</span>
                  <span className="mt-1 block text-sm text-gray-600">例：開始から5時間後</span>
                  <span className="mt-1 block text-xs text-amber-700">開始時刻によっては深夜に届くことがあります</span>
                </span>
                <span className="text-gray-400" aria-hidden="true">›</span>
              </button>
            </div>
            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  setMode('relative')
                  setStage('name')
                }}
                className="min-h-[44px] px-2 text-xs text-gray-400 hover:text-gray-600 underline"
              >
                前のステップからの待ち時間で作成
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 min-h-[44px] text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </>
        )}
        {stage === 'name' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">シナリオを作成</h2>
            <p className="text-xs text-gray-500 mb-4">
              配信方式:{' '}
              <span className="font-medium">
                {mode === 'absolute_time'
                  ? '時刻で指定'
                  : mode === 'elapsed'
                    ? '経過時間で指定'
                    : '前のステップからの待ち時間'}
              </span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  シナリオ名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="例: 友だち追加ウェルカム"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && triggerType !== 'tag_added' && !submitting) moveToConfirmation()
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">いつ開始する？</label>
                <div className="space-y-2">
                  {triggerOptions.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                        triggerType === opt.value
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="triggerType"
                        value={opt.value}
                        checked={triggerType === opt.value}
                        onChange={() => setTriggerType(opt.value)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                        <div className="text-xs text-gray-500">{opt.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {triggerType === 'tag_added' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    トリガータグ <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={triggerTagId}
                    onChange={(e) => setTriggerTagId(e.target.value)}
                  >
                    <option value="">-- 選択してください --</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-0.5">
                    このタグが友だちに付与されたら、自動でこのシナリオを開始します
                  </p>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

            <div className="mt-5 flex justify-between gap-2">
              <button
                onClick={() => setStage('pick')}
                disabled={submitting}
                className="px-4 py-2 min-h-[44px] text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                ← 戻る
              </button>
              <button
                onClick={moveToConfirmation}
                disabled={submitting}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                内容を確認
              </button>
            </div>
          </>
        )}
        {stage === 'confirm' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900">作成内容を確認</h2>
            <p className="mt-1 text-sm text-gray-500">シナリオは停止中で作成されます。ステップを追加してから有効にしてください。</p>

            <dl className="mt-5 divide-y divide-gray-100 border-y border-gray-200 text-sm">
              <div className="grid grid-cols-[110px_1fr] gap-4 py-3">
                <dt className="text-gray-500">名前</dt>
                <dd className="font-medium text-gray-900 break-words">{name.trim()}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-4 py-3">
                <dt className="text-gray-500">開始条件</dt>
                <dd className="text-gray-900">{triggerLabel}{triggerTagName ? `（${triggerTagName}）` : ''}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-4 py-3">
                <dt className="text-gray-500">配信時間</dt>
                <dd className="text-gray-900">{modeLabel}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-4 py-3">
                <dt className="text-gray-500">初期状態</dt>
                <dd>
                  <span className="inline-flex rounded-full border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600">停止中・ステップ0件</span>
                </dd>
              </div>
            </dl>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

            <div className="mt-5 flex justify-between gap-2">
              <button
                onClick={() => setStage('name')}
                disabled={submitting}
                className="px-4 py-2 min-h-[44px] text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                ← 修正する
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {submitting ? '作成中...' : '停止中で作成する'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
