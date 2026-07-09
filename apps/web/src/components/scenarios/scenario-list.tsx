'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Scenario, DeliveryMode } from '@line-crm/shared'

type ScenarioWithCount = Scenario & { stepCount?: number }

const triggerLabels: Record<string, string> = {
  friend_add: '友だち追加時',
  tag_added: 'タグ付与時',
  manual: '手動',
}

const deliveryModeStyles: Record<DeliveryMode, { bg: string; text: string; label: string }> = {
  relative: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Legacy' },
  elapsed: { bg: 'bg-blue-50', text: 'text-blue-700', label: '経過時間' },
  absolute_time: { bg: 'bg-amber-50', text: 'text-amber-700', label: '時刻指定' },
}

function ModeBadge({ mode }: { mode?: DeliveryMode }) {
  const s = deliveryModeStyles[mode ?? 'relative']
  return (
    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

interface ScenarioListProps {
  scenarios: ScenarioWithCount[]
  onToggleActive: (id: string, current: boolean, options?: { alsoDeactivateId?: string }) => void
  onDelete: (id: string) => void
  loading?: boolean
}

export default function ScenarioList({ scenarios, onToggleActive, onDelete, loading }: ScenarioListProps) {
  // friend_add トリガーのシナリオを ON にしようとした時、既に別の friend_add シナリオが
  // ON なら確認ダイアログを出す (新規友だちに二重で送信されてしまうのを防ぐため)。
  const [conflict, setConflict] = useState<{ target: ScenarioWithCount; existing: ScenarioWithCount } | null>(null)

  const requestToggleActive = (scenario: ScenarioWithCount) => {
    if (
      scenario.lineAccountId === null &&
      !confirm(
        `「${scenario.name}」は全アカウント共通のシナリオです。${scenario.isActive ? '無効化' : '有効化'}するとすべてのアカウントに影響します。続行しますか？`,
      )
    ) {
      return
    }

    if (!scenario.isActive && scenario.triggerType === 'friend_add') {
      const existing = scenarios.find(
        (s) => s.id !== scenario.id && s.triggerType === 'friend_add' && s.isActive,
      )
      if (existing) {
        setConflict({ target: scenario, existing })
        return
      }
    }

    onToggleActive(scenario.id, scenario.isActive)
  }

  if (scenarios.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <p className="text-gray-500">シナリオがありません。新しいシナリオを作成してください。</p>
      </div>
    )
  }

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {scenarios.map((scenario) => (
        <div key={scenario.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/scenarios/detail?id=${scenario.id}`}
              className="text-sm font-semibold text-gray-900 hover:text-green-600 transition-colors leading-tight"
            >
              {scenario.name}
            </Link>
            <div className="flex items-center gap-1.5">
              {scenario.lineAccountId === null && (
                <span
                  className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                  title="全アカウントに適用されるシナリオです"
                >
                  全アカ共通
                </span>
              )}
              <ModeBadge mode={scenario.deliveryMode} />
              <span
                className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  scenario.isActive
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {scenario.isActive ? '有効' : '無効'}
              </span>
            </div>
          </div>

          {/* Description */}
          {scenario.description && (
            <p className="text-xs text-gray-500 line-clamp-2">{scenario.description}</p>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>トリガー: {triggerLabels[scenario.triggerType] ?? scenario.triggerType}</span>
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span>ステップ数: {scenario.stepCount ?? '-'}</span>
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <Link
              href={`/scenarios/detail?id=${scenario.id}`}
              className="flex-1 text-center text-xs font-medium text-green-600 hover:text-green-700 py-1 min-h-[44px] flex items-center justify-center rounded-md hover:bg-green-50 transition-colors"
            >
              詳細・編集
            </Link>
            <button
              onClick={() => requestToggleActive(scenario)}
              disabled={loading}
              className="flex-1 text-xs font-medium text-gray-600 hover:text-gray-900 py-1 min-h-[44px] flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              {scenario.isActive ? '無効にする' : '有効にする'}
            </button>
            <button
              onClick={() => {
                const message = scenario.lineAccountId === null
                  ? `「${scenario.name}」は全アカウント共通のシナリオです。削除するとすべてのアカウントから消えます。本当に削除しますか？`
                  : `「${scenario.name}」を削除してもよいですか？`
                if (confirm(message)) {
                  onDelete(scenario.id)
                }
              }}
              disabled={loading}
              className="flex-1 text-xs font-medium text-red-500 hover:text-red-700 py-1 min-h-[44px] flex items-center justify-center rounded-md hover:bg-red-50 transition-colors disabled:opacity-40"
            >
              削除
            </button>
          </div>
        </div>
      ))}
    </div>

    {/* friend_add シナリオの二重ON警告 */}
    {conflict && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">友だち追加時シナリオが重複します</h3>
          <p className="text-sm text-gray-600">
            「{conflict.existing.name}」も友だち追加時に発火します。両方ONだと新規友だちに両方送信されます。
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                onToggleActive(conflict.target.id, conflict.target.isActive, { alsoDeactivateId: conflict.existing.id })
                setConflict(null)
              }}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              「{conflict.existing.name}」をOFFにして切り替える
            </button>
            <button
              onClick={() => {
                onToggleActive(conflict.target.id, conflict.target.isActive)
                setConflict(null)
              }}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              両方ONにする
            </button>
            <button
              onClick={() => setConflict(null)}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
