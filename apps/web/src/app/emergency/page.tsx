'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { adminPath } from '@/lib/base-path'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

type ActionStatus = 'idle' | 'confirming' | 'executing' | 'done' | 'partial' | 'error'

interface EmergencyAction {
  id: string
  label: string
  description: string
  status: ActionStatus
  errorMessage?: string
  resultMessage?: string
}

const emergencyPrompts = [
  {
    title: '緊急: 予約一斉配信・シナリオ・自動化を止めるプロンプト',
    prompt: `LINE CRM の予約済み一斉配信・シナリオ・自動化を停止してください。自動返信や送信中の配信はこの操作の対象外です。
1. broadcasts の status が scheduled のものを全て draft に変更
2. scenarios の isActive を全て false に変更
3. automations の isActive を全て false に変更
完了後、停止した件数を報告してください。`,
  },
  {
    title: '緊急: アカウント移行プロンプト',
    prompt: `LINE CRM のアカウント移行を実行してください。
1. /health ページで現在のアカウント状態を確認
2. BAN リスクが高いアカウントを特定
3. 移行先アカウントを選択して移行を実行
各ステップの結果を報告してください。`,
  },
]

export default function EmergencyPage() {
  const [actions, setActions] = useState<EmergencyAction[]>([
    {
      id: 'stop-broadcasts',
      label: '予約済み一斉配信を停止',
      description: '予約済みの一斉配信だけを下書きに戻します。シナリオ・自動返信・送信中の配信は対象外です。',
      status: 'idle',
    },
    {
      id: 'stop-scenarios',
      label: 'シナリオ一括停止',
      description: '有効なシナリオを無効化します。自動返信や予約済み一斉配信は対象外です。',
      status: 'idle',
    },
    {
      id: 'switch-account',
      label: 'アカウント切替',
      description: 'BAN検知時のアカウント移行ページへ移動します',
      status: 'idle',
    },
  ])

  const updateAction = (id: string, updates: Partial<EmergencyAction>) => {
    setActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    )
  }

  const handleAction = async (id: string) => {
    const action = actions.find((a) => a.id === id)
    if (!action) return

    if (action.status === 'idle' || action.status === 'done' || action.status === 'partial' || action.status === 'error') {
      updateAction(id, { status: 'confirming', errorMessage: undefined, resultMessage: undefined })
      return
    }

    if (action.status === 'confirming') {
      updateAction(id, { status: 'executing' })

      try {
        if (id === 'stop-broadcasts') {
          const res = await api.broadcasts.list()
          if (!res.success) throw new Error('予約済み一斉配信の取得に失敗しました')
          const scheduled = res.data.filter((b) => b.status === 'scheduled')
          const results = await Promise.allSettled(
            scheduled.map((b) => api.broadcasts.update(b.id, { scheduledAt: null }))
          )
          const stopped = results.filter((result) => result.status === 'fulfilled' && result.value.success).length
          const failed = scheduled.length - stopped
          updateAction(id, {
            status: failed === 0 ? 'done' : stopped > 0 ? 'partial' : 'error',
            resultMessage: `対象 ${scheduled.length}件・停止 ${stopped}件・失敗 ${failed}件`,
            errorMessage: failed > 0 ? '停止できなかった配信があります。配信一覧で状態を確認してください。' : undefined,
          })
        } else if (id === 'stop-scenarios') {
          const res = await api.scenarios.list()
          if (!res.success) throw new Error('有効なシナリオの取得に失敗しました')
          const active = res.data.filter((s) => s.isActive)
          const results = await Promise.allSettled(
            active.map((s) => api.scenarios.update(s.id, { isActive: false }))
          )
          const stopped = results.filter((result) => result.status === 'fulfilled' && result.value.success).length
          const failed = active.length - stopped
          updateAction(id, {
            status: failed === 0 ? 'done' : stopped > 0 ? 'partial' : 'error',
            resultMessage: `対象 ${active.length}件・停止 ${stopped}件・失敗 ${failed}件`,
            errorMessage: failed > 0 ? '停止できなかったシナリオがあります。シナリオ一覧で状態を確認してください。' : undefined,
          })
        } else if (id === 'switch-account') {
          // 生の location 遷移は basePath が自動で付かないので adminPath() を通す。
          window.location.href = adminPath('/health')
          return
        }
      } catch (error) {
        updateAction(id, { status: 'error', errorMessage: error instanceof Error ? error.message : '実行に失敗しました。再度お試しください。' })
      }
    }
  }

  const handleCancel = (id: string) => {
    updateAction(id, { status: 'idle', errorMessage: undefined })
  }

  const getStatusBadge = (status: ActionStatus) => {
    switch (status) {
      case 'done':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            完了
          </span>
        )
      case 'executing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            実行中...
          </span>
        )
      case 'partial':
        return <span className="text-xs font-medium text-amber-700">一部失敗</span>
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            エラー
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div>
      <Header title="緊急コントロール" />

      {/* Warning banner */}
      <div className="mb-6 p-4 bg-red-50 border-2 border-red-300 rounded-lg">
        <div className="flex items-start gap-3">
          <svg className="w-6 h-6 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <p className="text-sm font-bold text-red-800">注意: この操作は即時実行されます</p>
            <p className="text-xs text-red-600 mt-1">
              各ボタンをクリックすると確認ダイアログが表示されます。「実行」で操作が開始されます。
            </p>
          </div>
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {actions.map((action) => (
          <div
            key={action.id}
            className="bg-white rounded-lg shadow-sm border-2 border-red-200 p-5 flex flex-col"
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-900">{action.label}</h3>
              {getStatusBadge(action.status)}
            </div>
            <p className="text-xs text-gray-500 mb-4 flex-1">{action.description}</p>

            {action.errorMessage && (
              <p className="text-xs text-red-600 mb-3">{action.errorMessage}</p>
            )}
            {action.resultMessage && (
              <p className="text-xs text-gray-700 mb-3" role="status">{action.resultMessage}</p>
            )}

            {action.status === 'confirming' ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-red-700">本当に実行しますか？</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(action.id)}
                    className="flex-1 px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                  >
                    実行
                  </button>
                  <button
                    onClick={() => handleCancel(action.id)}
                    className="flex-1 px-3 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => handleAction(action.id)}
                disabled={action.status === 'executing'}
                className="w-full px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                {action.status === 'executing' ? '実行中...' : action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* This page's action results, not a live delivery status. */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">この画面での実行結果</h2>
        <div className="space-y-2">
          {actions.map((action) => (
            <div key={action.id} className="flex items-center justify-between py-2 border-b border-gray-200 last:border-0">
              <span className="text-sm text-gray-600">{action.label}</span>
              <span className={`text-xs font-medium ${
                action.status === 'done'
                  ? 'text-green-600'
                  : action.status === 'error'
                  ? 'text-red-600'
                  : action.status === 'executing'
                  ? 'text-yellow-600'
                  : 'text-gray-400'
              }`}>
                {action.status === 'idle' && '未実行'}
                {action.status === 'confirming' && '確認待ち'}
                {action.status === 'executing' && '実行中'}
                {action.status === 'done' && '実行済み'}
                {action.status === 'partial' && '一部失敗'}
                {action.status === 'error' && 'エラー'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <CcPromptButton prompts={emergencyPrompts} />
    </div>
  )
}
