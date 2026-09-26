'use client'

import { useState, useEffect } from 'react'
import { api, type FriendDeliveryControl, type FriendScenarioDelivery } from '@/lib/api'
import { ConfirmSheet } from '@/components/ui'

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FriendDeliveryControls({ friendId, onConfirmationChange }: {
  friendId: string
  onConfirmationChange?: (open: boolean) => void
}) {
  const [scenarioDeliveries, setScenarioDeliveries] = useState<FriendScenarioDelivery[]>([])
  const [scenarioLoading, setScenarioLoading] = useState(true)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const [scenarioAction, setScenarioAction] = useState<{
    delivery: FriendScenarioDelivery
    action: 'pause' | 'resume'
  } | null>(null)
  const [scenarioActionBusy, setScenarioActionBusy] = useState(false)
  const [scenarioActionError, setScenarioActionError] = useState<string | null>(null)
  const [deliveryControl, setDeliveryControl] = useState<FriendDeliveryControl | null>(null)
  const [deliveryControlLoading, setDeliveryControlLoading] = useState(true)
  const [deliveryControlError, setDeliveryControlError] = useState<string | null>(null)
  const [deliveryControlAction, setDeliveryControlAction] = useState<'pause' | 'resume' | null>(null)
  const [deliveryControlActionBusy, setDeliveryControlActionBusy] = useState(false)
  const [deliveryControlActionError, setDeliveryControlActionError] = useState<string | null>(null)

  useEffect(() => {
    onConfirmationChange?.(scenarioAction !== null || deliveryControlAction !== null)
    return () => onConfirmationChange?.(false)
  }, [scenarioAction, deliveryControlAction, onConfirmationChange])

  useEffect(() => {
    if (!friendId) {
      setDeliveryControl(null)
      return
    }
    let cancelled = false
    setDeliveryControlLoading(true)
    setDeliveryControlError(null)
    setDeliveryControlAction(null)
    api.friends.deliveryControl(friendId).then((res) => {
      if (cancelled) return
      if (res.success) {
        setDeliveryControl(res.data)
      } else {
        setDeliveryControlError('予約メッセージの状態を取得できませんでした')
      }
    }).catch(() => {
      if (!cancelled) setDeliveryControlError('予約メッセージの状態を取得できませんでした')
    }).finally(() => {
      if (!cancelled) setDeliveryControlLoading(false)
    })
    return () => { cancelled = true }
  }, [friendId])

  useEffect(() => {
    if (!friendId) {
      setScenarioDeliveries([])
      return
    }
    let cancelled = false
    setScenarioLoading(true)
    setScenarioError(null)
    setScenarioAction(null)
    api.friends.scenarios(friendId).then((res) => {
      if (cancelled) return
      if (res.success) {
        setScenarioDeliveries(res.data)
      } else {
        setScenarioError('ステップ配信の状態を取得できませんでした')
      }
    }).catch(() => {
      if (!cancelled) setScenarioError('ステップ配信の状態を取得できませんでした')
    }).finally(() => {
      if (!cancelled) setScenarioLoading(false)
    })
    return () => { cancelled = true }
  }, [friendId])

  async function confirmScenarioAction() {
    if (!friendId || !scenarioAction) return
    setScenarioActionBusy(true)
    setScenarioActionError(null)
    try {
      const res = await api.friends.updateScenarioStatus(
        friendId,
        scenarioAction.delivery.id,
        scenarioAction.action,
      )
      if (!res.success) {
        setScenarioActionError('状態を変更できませんでした。画面を読み直してお試しください。')
        return
      }
      setScenarioDeliveries((items) =>
        items.map((item) => item.id === res.data.id ? res.data : item),
      )
      setScenarioAction(null)
    } catch {
      setScenarioActionError(
        scenarioAction.action === 'pause'
          ? '配信を一時停止できませんでした。送信処理中の場合は、少し待ってからお試しください。'
          : '配信を再開できませんでした。画面を読み直してお試しください。',
      )
    } finally {
      setScenarioActionBusy(false)
    }
  }

  async function confirmDeliveryControlAction() {
    if (!friendId || !deliveryControlAction) return
    setDeliveryControlActionBusy(true)
    setDeliveryControlActionError(null)
    try {
      const res = await api.friends.updateDeliveryControl(friendId, deliveryControlAction)
      if (!res.success) {
        setDeliveryControlActionError('状態を変更できませんでした。画面を読み直してお試しください。')
        return
      }
      setDeliveryControl(res.data)
      setDeliveryControlAction(null)
    } catch {
      setDeliveryControlActionError('予約メッセージの状態を変更できませんでした。もう一度お試しください。')
    } finally {
      setDeliveryControlActionBusy(false)
    }
  }


  return (
    <>
            {/* Friend-specific automated delivery controls */}
            <div className="p-4">
              <h4 className="text-sm font-medium text-gray-500 mb-2">この友だちへの自動配信</h4>

              <div className="border-y border-gray-100 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">予約メッセージ</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      20時配信など、あとから送る自動メッセージ
                    </p>
                  </div>
                  {!deliveryControlLoading && !deliveryControlError && deliveryControl && (
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                      deliveryControl.scheduledMessagesPaused
                        ? 'bg-red-100 text-red-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {deliveryControl.scheduledMessagesPaused ? '停止中' : '送信を許可'}
                    </span>
                  )}
                </div>
                {deliveryControlLoading ? (
                  <p className="mt-2 text-sm text-gray-400">読み込み中...</p>
                ) : deliveryControlError ? (
                  <p className="mt-2 text-sm text-red-500">{deliveryControlError}</p>
                ) : deliveryControl ? (
                  <>
                    {deliveryControl.scheduledMessagesPausedAt && (
                      <p className="mt-1 text-xs text-gray-500">
                        停止日時: {formatDate(deliveryControl.scheduledMessagesPausedAt)}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryControlActionError(null)
                        setDeliveryControlAction(
                          deliveryControl.scheduledMessagesPaused ? 'resume' : 'pause',
                        )
                      }}
                      className={`mt-3 min-h-11 w-full rounded-md px-3 text-sm font-semibold ${
                        deliveryControl.scheduledMessagesPaused
                          ? 'bg-green-700 text-white hover:bg-green-800'
                          : 'bg-red-700 text-white hover:bg-red-800'
                      }`}
                    >
                      {deliveryControl.scheduledMessagesPaused
                        ? '予約メッセージを再開'
                        : '予約メッセージを停止'}
                    </button>
                  </>
                ) : null}
              </div>

              <p className="mt-5 text-sm font-semibold text-gray-900">シナリオのステップ配信</p>
              <div className="mt-1">
                {scenarioLoading ? (
                  <p className="text-sm text-gray-400">読み込み中...</p>
                ) : scenarioError ? (
                  <p className="text-sm text-red-500">{scenarioError}</p>
                ) : scenarioDeliveries.length === 0 ? (
                  <p className="text-sm text-gray-400">進行中・一時停止中のシナリオはありません</p>
                ) : (
                  <div className="divide-y divide-gray-100 border-b border-gray-100">
                    {scenarioDeliveries.map((delivery) => {
                      const isPaused = delivery.status === 'paused'
                      const isDelivering = delivery.status === 'delivering'
                      return (
                        <div key={delivery.id} className="py-3 first:pt-2 last:pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 text-sm font-medium text-gray-800 break-words">
                              {delivery.scenarioName}
                            </p>
                            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                              isPaused
                                ? 'bg-gray-100 text-gray-600'
                                : isDelivering
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-green-100 text-green-700'
                            }`}>
                              {isPaused ? '一時停止中' : isDelivering ? '送信処理中' : '配信中'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {delivery.sentSteps}/{delivery.totalSteps}ステップ送信済み
                          </p>
                          {delivery.nextDeliveryAt && (
                            <p className="mt-0.5 text-xs text-gray-500">
                              {isPaused ? '停止前の次回予定' : '次回予定'}: {formatDate(delivery.nextDeliveryAt)}
                            </p>
                          )}
                          <button
                            type="button"
                            disabled={isDelivering}
                            onClick={() => {
                              setScenarioActionError(null)
                              setScenarioAction({ delivery, action: isPaused ? 'resume' : 'pause' })
                            }}
                            className={`mt-2 min-h-11 rounded px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                              isPaused
                                ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                : 'bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {isPaused ? '配信を再開' : isDelivering ? '送信処理中' : 'この人への配信を一時停止'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

      <ConfirmSheet
        open={deliveryControlAction !== null}
        title={deliveryControlAction === 'pause' ? '予約メッセージを停止' : '予約メッセージを再開'}
        message={deliveryControlAction === 'pause'
          ? 'この友だちに、20時配信などの予約メッセージを送らないようにします。停止中に予定時刻を迎えたメッセージは送信されません。通常の即時自動返信には影響しません。'
          : 'この友だちへの予約メッセージを再開します。停止中に送信時刻を過ぎたメッセージは、再開しても後から送信されません。'}
        confirmLabel={deliveryControlAction === 'pause' ? '停止する' : '再開する'}
        tone={deliveryControlAction === 'pause' ? 'danger' : 'default'}
        busy={deliveryControlActionBusy}
        error={deliveryControlActionError}
        onConfirm={confirmDeliveryControlAction}
        onClose={() => {
          if (deliveryControlActionBusy) return
          setDeliveryControlAction(null)
          setDeliveryControlActionError(null)
        }}
      />

      <ConfirmSheet
        open={scenarioAction !== null}
        title={scenarioAction?.action === 'pause' ? 'ステップ配信を一時停止' : 'ステップ配信を再開'}
        message={scenarioAction
          ? scenarioAction.action === 'pause'
            ? `この友だちへの「${scenarioAction.delivery.scenarioName}」の残り配信を一時停止します。他の友だちや他のシナリオには影響しません。`
            : `この友だちへの「${scenarioAction.delivery.scenarioName}」を再開します。停止時点で残っていた待ち時間から続行します。`
          : undefined}
        confirmLabel={scenarioAction?.action === 'pause' ? '一時停止する' : '再開する'}
        tone={scenarioAction?.action === 'pause' ? 'danger' : 'default'}
        busy={scenarioActionBusy}
        error={scenarioActionError}
        onConfirm={confirmScenarioAction}
        onClose={() => {
          if (scenarioActionBusy) return
          setScenarioAction(null)
          setScenarioActionError(null)
        }}
      />
    </>
  )
}
