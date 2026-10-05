'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Scenario, ScenarioTriggerType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ScenarioList from '@/components/scenarios/scenario-list'
import ScenarioProgress from '@/components/scenarios/scenario-progress'
import ScenarioModePicker from '@/components/scenarios/scenario-mode-picker'
import CcPromptButton from '@/components/cc-prompt-button'

const ccPrompts = [
  {
    title: '新しいシナリオを作成',
    prompt: `新しいシナリオ配信を作成してください。
1. ターゲット: [対象を指定]
2. トリガー: 友だち追加 / タグ変更 / 手動
3. ステップ数: [希望数]
4. メッセージ内容の提案もお願いします
各ステップの配信間隔も含めて構成してください。`,
  },
  {
    title: 'シナリオの効果分析',
    prompt: `現在のシナリオ配信の効果を分析してください。
1. 各シナリオの配信実績を確認
2. ステップごとの離脱率を分析
3. 改善が必要なシナリオを特定
具体的な改善案を提示してください。`,
  },
]

type ScenarioWithCount = Scenario & { stepCount?: number }

export default function ScenariosPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const router = useRouter()
  const [scenarios, setScenarios] = useState<ScenarioWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [view, setView] = useState<'list' | 'progress'>('list')
  const [progressScenarioId, setProgressScenarioId] = useState('')

  const loadScenarios = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setScenarios(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
        if (cancelled) return
        if (res.success) {
          setScenarios(res.data)
        } else {
          setError(res.error)
        }
      } catch {
        if (cancelled) return
        setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, accountLoading])

  const handleCreate = async (input: {
    name: string
    triggerType: ScenarioTriggerType
    triggerTagId: string | null
    deliveryMode: DeliveryMode
  }) => {
    const res = await api.scenarios.create({
      name: input.name,
      description: null,
      triggerType: input.triggerType,
      triggerTagId: input.triggerTagId,
      lineAccountId: selectedAccountId,
      isActive: false,
      deliveryMode: input.deliveryMode,
    })
    if (res.success) {
      router.push(`/scenarios/detail?id=${res.data.id}`)
    } else {
      throw new Error(res.error)
    }
  }

  const handleToggleActive = async (id: string, current: boolean, options?: { alsoDeactivateId?: string }) => {
    let deactivatedExisting = false
    if (options?.alsoDeactivateId) {
      const deactivateRes = await api.scenarios.update(options.alsoDeactivateId, { isActive: false })
      if (!deactivateRes.success) throw new Error(deactivateRes.error || '既存シナリオを停止できませんでした')
      deactivatedExisting = true
    }

    const updateRes = await api.scenarios.update(id, { isActive: !current })
    if (!updateRes.success) {
      if (deactivatedExisting && options?.alsoDeactivateId) {
        await api.scenarios.update(options.alsoDeactivateId, { isActive: true }).catch(() => undefined)
      }
      throw new Error(updateRes.error || '状態を変更できませんでした')
    }
    await loadScenarios()
  }

  const handleDelete = async (id: string) => {
    const res = await api.scenarios.delete(id)
    if (!res.success) throw new Error(res.error || '削除できませんでした')
    await loadScenarios()
  }

  return (
    <div>
      <Header
        title="シナリオ配信"
        action={
          <button
            onClick={() => setPickerOpen(true)}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規シナリオ
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <ScenarioModePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onCreate={handleCreate}
      />

      <div className="mb-5 flex w-fit gap-1 rounded-lg bg-gray-100 p-1" aria-label="シナリオ画面の表示切り替え">
        <button
          type="button"
          onClick={() => setView('list')}
          aria-pressed={view === 'list'}
          className={`min-h-10 rounded-md px-4 text-sm font-medium ${view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
        >
          シナリオ一覧
        </button>
        <button
          type="button"
          onClick={() => { setProgressScenarioId(''); setView('progress') }}
          aria-pressed={view === 'progress'}
          className={`min-h-10 rounded-md px-4 text-sm font-medium ${view === 'progress' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
        >
          進行状況
        </button>
      </div>

      {loading ? (
        <div className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-full" />
              <div className="flex gap-4">
                <div className="h-3 bg-gray-100 rounded w-24" />
                <div className="h-3 bg-gray-100 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : view === 'list' ? (
        <ScenarioList
          scenarios={scenarios}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
          onShowProgress={(id) => { setProgressScenarioId(id); setView('progress') }}
          loading={loading}
        />
      ) : (
        <ScenarioProgress
          scenarios={scenarios}
          accountId={selectedAccountId}
          initialScenarioId={progressScenarioId}
        />
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
