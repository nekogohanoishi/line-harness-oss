'use client'

import { useState, useEffect } from 'react'
import { api, type FriendDeliveryControl, type FriendScenarioDelivery } from '@/lib/api'
import { ConfirmSheet } from '@/components/ui'
import { TalkArea, TalkStep, TalkTimeline } from '@/components/messages/talk-preview'

/** 日本時間の「10/05 20:00」。今年以外のときだけ年も付ける（「2027/01/05 20:00」）。 */
function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '日時を確認できません'
  const jstYear = (value: Date) => value.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric' })
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  if (jstYear(date) !== jstYear(new Date())) options.year = 'numeric'
  return date.toLocaleString('ja-JP', options)
}

const deliveryOrder: Record<FriendScenarioDelivery['status'], number> = { delivering: 0, active: 1, paused: 2 }

/** 届く順に並べる。送信中、送信待ち（日時の早い順）、一時停止中の順。 */
function sortByUpcoming(items: FriendScenarioDelivery[]): FriendScenarioDelivery[] {
  const time = (item: FriendScenarioDelivery) => {
    const ms = item.nextDeliveryAt ? Date.parse(item.nextDeliveryAt) : NaN
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms
  }
  return [...items].sort((a, b) => deliveryOrder[a.status] - deliveryOrder[b.status] || time(a) - time(b))
}

/** TalkStep の見出し。状態ごとに、いつ何が起きるかを日本語で言い切る。 */
function deliveryTiming(delivery: FriendScenarioDelivery): string {
  if (delivery.status === 'delivering') return 'いま送信しています'
  if (delivery.status === 'paused') return '一時停止中'
  return delivery.nextDeliveryAt ? `${formatDateTime(delivery.nextDeliveryAt)} に送信予定` : '次の送信日時を確認できません'
}

/** 見出しだけでは足りない状態の補足。送信待ちは見出しで足りるので無し。 */
function deliveryStateNote(delivery: FriendScenarioDelivery): string | null {
  if (delivery.status === 'delivering') return '送信が終わったら、この画面を開き直すと操作できます。'
  if (delivery.status !== 'paused') return null
  const before = delivery.nextDeliveryAt ? `停止前は ${formatDateTime(delivery.nextDeliveryAt)} に送る予定でした。` : ''
  return `${before}再開すると、停止した時点で残っていた待ち時間から続けて送ります。`
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

        <section className="border-y border-gray-200 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h5 className="text-sm font-semibold text-gray-900">予約メッセージ</h5>
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
                {deliveryControl.scheduledMessagesPaused ? '停止中' : '通常どおり'}
              </span>
            )}
          </div>
          {deliveryControlLoading ? (
            <p role="status" className="mt-2 text-sm text-gray-500">読み込み中...</p>
          ) : deliveryControlError ? (
            <p role="alert" className="mt-2 text-sm text-red-700">{deliveryControlError}</p>
          ) : deliveryControl ? (
            <>
              {deliveryControl.scheduledMessagesPaused ? (
                <>
                  <p className="mt-2 text-sm leading-6 text-gray-800">
                    {deliveryControl.scheduledMessagesPausedAt
                      ? `${formatDateTime(deliveryControl.scheduledMessagesPausedAt)} から停止しています。`
                      : '停止しています。'}
                    この友だちには予約メッセージを送りません。
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-600">
                    停止中に時刻を過ぎたメッセージは、再開しても後から届きません。
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm leading-6 text-gray-800">
                  決めた時刻になると、この友だちにも自動で届きます。
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
        </section>

        <section className="mt-5">
          <h5 className="text-sm font-semibold text-gray-900">シナリオのステップ配信</h5>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">
            決めた順番で自動で届くメッセージです。この友だちに次に届くものから順に並べています。
          </p>
          <div className="mt-3">
            {scenarioLoading ? (
              <p role="status" className="text-sm text-gray-500">読み込み中...</p>
            ) : scenarioError ? (
              <p role="alert" className="text-sm text-red-700">{scenarioError}</p>
            ) : scenarioDeliveries.length === 0 ? (
              <p className="text-sm text-gray-500">進行中・一時停止中のシナリオはありません</p>
            ) : (
              // 次に届く1通を、送信予定日時を見出しに番号付きの縦線でつなぐ。
              // この友だちのデータにはメッセージ本文が無いので、本文の吹き出しは出さない。
              <TalkArea>
                <TalkTimeline>
                  {sortByUpcoming(scenarioDeliveries).map((delivery, index, list) => {
                    const isPaused = delivery.status === 'paused'
                    const isDelivering = delivery.status === 'delivering'
                    const stateNote = deliveryStateNote(delivery)
                    const buttonLabel = isPaused
                      ? '配信を再開'
                      : isDelivering
                        ? '送信中のため操作できません'
                        : 'この人への配信を一時停止'
                    return (
                      <TalkStep
                        key={delivery.id}
                        number={index + 1}
                        // シナリオごとの「次の送信」を並べているので、「N通目」ではなく、いつ何が起きるかを見出しにする
                        title={deliveryTiming(delivery)}
                        isLast={index === list.length - 1}
                      >
                        <p className="text-sm font-semibold leading-6 text-gray-900 break-words">
                          {delivery.scenarioName}
                        </p>
                        {delivery.totalSteps > 0 && (
                          <p className="text-xs leading-5 text-gray-600">
                            全{delivery.totalSteps}通のうち{delivery.sentSteps}通を送信済み
                          </p>
                        )}
                        {stateNote && (
                          <p className="mt-1 text-xs leading-5 text-gray-600">{stateNote}</p>
                        )}
                        <button
                          type="button"
                          disabled={isDelivering}
                          aria-label={`${buttonLabel}（${delivery.scenarioName}）`}
                          onClick={() => {
                            setScenarioActionError(null)
                            setScenarioAction({ delivery, action: isPaused ? 'resume' : 'pause' })
                          }}
                          className={`mt-3 min-h-11 w-full rounded-md border bg-white px-3 text-sm font-medium disabled:cursor-not-allowed ${
                            isDelivering
                              ? 'border-gray-300 text-gray-600'
                              : isPaused
                                ? 'border-green-300 text-green-700 hover:bg-green-50'
                                : 'border-red-300 text-red-700 hover:bg-red-50'
                          }`}
                        >
                          {buttonLabel}
                        </button>
                      </TalkStep>
                    )
                  })}
                </TalkTimeline>
              </TalkArea>
            )}
          </div>
        </section>
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
