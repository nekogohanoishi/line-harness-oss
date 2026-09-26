'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Scenario, DeliveryMode } from '@line-crm/shared'
import ActionMenu from '@/components/scenarios/action-menu'
import ScenarioStatusSheet from '@/components/scenarios/scenario-status-sheet'
import { ConfirmSheet } from '@/components/ui'

type ScenarioWithCount = Scenario & { stepCount?: number }

const triggerLabels: Record<string, string> = {
  friend_add: '友だち追加時',
  tag_added: 'タグ付与時',
  manual: '手動',
}

const deliveryModeLabels: Record<DeliveryMode, string> = {
  relative: '前のステップから待機',
  elapsed: '開始からの経過時間',
  absolute_time: '指定時刻',
}

interface ScenarioListProps {
  scenarios: ScenarioWithCount[]
  onToggleActive: (id: string, current: boolean, options?: { alsoDeactivateId?: string }) => Promise<void>
  onDelete: (id: string) => Promise<void>
  loading?: boolean
}

export default function ScenarioList({ scenarios, onToggleActive, onDelete, loading }: ScenarioListProps) {
  const router = useRouter()
  const [statusTarget, setStatusTarget] = useState<ScenarioWithCount | null>(null)
  const [statusConflict, setStatusConflict] = useState<ScenarioWithCount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScenarioWithCount | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const requestToggleActive = (scenario: ScenarioWithCount) => {
    const conflict = !scenario.isActive && scenario.triggerType === 'friend_add'
      ? scenarios.find((candidate) => (
          candidate.id !== scenario.id
          && candidate.triggerType === 'friend_add'
          && candidate.isActive
        )) ?? null
      : null
    setActionError('')
    setStatusTarget(scenario)
    setStatusConflict(conflict)
  }

  const runToggleActive = async (options?: { alsoDeactivateId?: string }) => {
    if (!statusTarget) return
    setActionBusy(true)
    setActionError('')
    try {
      await onToggleActive(statusTarget.id, statusTarget.isActive, options)
      setStatusTarget(null)
      setStatusConflict(null)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '状態を変更できませんでした')
    } finally {
      setActionBusy(false)
    }
  }

  const runDelete = async () => {
    if (!deleteTarget) return
    setActionBusy(true)
    setActionError('')
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '削除できませんでした')
    } finally {
      setActionBusy(false)
    }
  }

  if (scenarios.length === 0) {
    return (
      <div className="border-y border-gray-200 bg-white px-5 py-12 text-center sm:rounded-lg sm:border">
        <p className="text-sm font-medium text-gray-700">シナリオはまだありません</p>
        <p className="mt-1 text-sm text-gray-500">右上の「新規シナリオ」から作成できます。</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-visible border-y border-gray-200 bg-white sm:rounded-lg sm:border">
        <div className="hidden grid-cols-[110px_minmax(220px,1fr)_170px_120px_52px] items-center gap-4 border-b border-gray-200 bg-gray-50 px-5 py-3 text-xs font-medium text-gray-500 lg:grid">
          <span>状態</span>
          <span>シナリオ</span>
          <span>開始条件</span>
          <span>ステップ</span>
          <span className="sr-only">操作</span>
        </div>

        <div className="divide-y divide-gray-100">
          {scenarios.map((scenario) => {
            const stepCount = scenario.stepCount ?? 0
            const triggerLabel = triggerLabels[scenario.triggerType] ?? '未設定'
            const modeLabel = deliveryModeLabels[scenario.deliveryMode ?? 'relative']
            return (
              <div
                key={scenario.id}
                className="group grid grid-cols-[minmax(0,1fr)_44px] gap-2 px-4 py-4 transition-colors hover:bg-gray-50 lg:grid-cols-[110px_minmax(220px,1fr)_170px_120px_52px] lg:items-center lg:gap-4 lg:px-5"
              >
                <div className="lg:col-start-1">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${scenario.isActive ? 'bg-green-100 text-green-800' : 'border border-gray-300 bg-white text-gray-600'}`}>
                    {scenario.isActive ? '配信中' : '停止中'}
                  </span>
                </div>

                <Link href={`/scenarios/detail?id=${scenario.id}`} className="min-w-0 lg:col-start-2 lg:row-start-1">
                  <span className="block truncate text-sm font-semibold text-gray-900 group-hover:text-green-700">{scenario.name}</span>
                  {scenario.description && <span className="mt-1 block truncate text-xs text-gray-500">{scenario.description}</span>}
                  <span className="mt-2 flex flex-wrap gap-1.5 lg:hidden">
                    {scenario.lineAccountId === null && (
                      <span title="すべてのLINEアカウントに適用されます" className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">全アカウント共通</span>
                    )}
                    <span title="配信時間の数え方" className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{modeLabel}</span>
                  </span>
                </Link>

                <Link href={`/scenarios/detail?id=${scenario.id}`} className="mt-3 min-w-0 text-sm text-gray-600 lg:col-start-3 lg:row-start-1 lg:mt-0">
                  <span className="text-xs text-gray-400 lg:hidden">開始条件</span>
                  <span className="block truncate">{triggerLabel}</span>
                </Link>

                <Link href={`/scenarios/detail?id=${scenario.id}`} className="mt-3 lg:col-start-4 lg:row-start-1 lg:mt-0">
                  <span className="text-xs text-gray-400 lg:hidden">ステップ</span>
                  {stepCount === 0 ? (
                    <span className="block text-sm font-medium text-amber-700">0件・配信なし</span>
                  ) : (
                    <span className="block text-sm text-gray-600">{stepCount}件</span>
                  )}
                </Link>

                <div className="col-start-2 row-span-3 row-start-1 self-start justify-self-end lg:col-start-5 lg:row-span-1 lg:row-start-1 lg:self-center">
                  <ActionMenu
                    label={`「${scenario.name}」の操作`}
                    items={[
                      { label: '詳細を開く', tone: 'primary', onSelect: () => router.push(`/scenarios/detail?id=${scenario.id}`) },
                      { label: '進行中の友だちを確認', onSelect: () => router.push(`/scenarios/detail?id=${scenario.id}#participants`) },
                      { label: scenario.isActive ? '配信を停止する' : '配信を有効にする', onSelect: () => requestToggleActive(scenario), disabled: loading || actionBusy },
                      { label: '削除', tone: 'danger', onSelect: () => { setActionError(''); setDeleteTarget(scenario) }, disabled: loading || actionBusy },
                    ]}
                  />
                </div>

                <div className="hidden min-w-0 flex-wrap gap-1.5 lg:col-start-2 lg:row-start-2 lg:flex">
                  {scenario.lineAccountId === null && (
                    <span title="すべてのLINEアカウントに適用されます" className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">全アカウント共通</span>
                  )}
                  <span title="配信時間の数え方" className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{modeLabel}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <ScenarioStatusSheet
        open={Boolean(statusTarget)}
        scenario={statusTarget}
        conflict={statusConflict}
        busy={actionBusy}
        error={actionError}
        onClose={() => { if (!actionBusy) { setStatusTarget(null); setStatusConflict(null); setActionError('') } }}
        onConfirm={(options) => void runToggleActive(options)}
      />

      <ConfirmSheet
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : 'シナリオを削除しますか？'}
        message={deleteTarget?.lineAccountId === null ? '全アカウント共通のシナリオです。削除するとすべてのLINEアカウントから消え、元に戻せません。' : 'シナリオとすべてのステップが削除され、元に戻せません。'}
        confirmLabel="削除する"
        tone="danger"
        busy={actionBusy}
        error={actionError}
        onClose={() => { if (!actionBusy) { setDeleteTarget(null); setActionError('') } }}
        onConfirm={() => void runDelete()}
      />
    </>
  )
}
