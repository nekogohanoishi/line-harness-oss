'use client'

import { useState, useEffect } from 'react'
import { api, type FriendDetail } from '@/lib/api'

interface ChatStatusInfo {
  status: 'unread' | 'in_progress' | 'resolved' | null
  notes: string | null
}

interface Props {
  friendId: string | null
  /** 親 (ChatDetail) が持っている chat 側の情報 — status / notes */
  chatStatus?: ChatStatusInfo
  /** 担当者名 (ChatDetail で operatorId → name 変換済を渡す想定) */
  operatorName?: string | null
  /**
   * シート等に埋め込んで使う場合は true。カードの枠線・角丸・見出しを外し、
   * 親（シート）側のヘッダーと二重にならないようにする。
   */
  embedded?: boolean
}

/** 折りたたみ前に見せる件数。これを超えた分は「すべて表示」で開く。 */
const EVENT_PREVIEW_COUNT = 3
const METADATA_PREVIEW_COUNT = 4

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const statusLabels: Record<NonNullable<ChatStatusInfo['status']>, { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-red-100 text-red-700' },
  in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' },
  resolved: { label: '解決済', className: 'bg-green-100 text-green-700' },
}

/** Render a metadata value safely as text. Objects/arrays → JSON, primitives → as-is. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value || '-'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unparseable]'
  }
}

export default function FriendInfoSidebar({ friendId, chatStatus, operatorName, embedded = false }: Props) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [showAllMetadata, setShowAllMetadata] = useState(false)

  useEffect(() => {
    if (!friendId) {
      setFriend(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    // 友だちを切り替えたら折りたたみ状態も初期化する。
    setShowAllEvents(false)
    setShowAllMetadata(false)
    api.friends.get(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setFriend(res.data)
      } else {
        setError((res as { error?: string }).error ?? '友だち情報を取得できませんでした')
      }
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [friendId])

  // リッチメニュー — loading / error / data を区別して、null=未設定 を取得失敗と
  // 混同しないようにする。Codex review (P3) の指摘で導入。
  type RichMenuState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; id: string | null; name: string | null; isDefault: boolean }
  const [richMenu, setRichMenu] = useState<RichMenuState>({ kind: 'loading' })

  useEffect(() => {
    if (!friendId) {
      setRichMenu({ kind: 'loading' })
      return
    }
    let cancelled = false
    setRichMenu({ kind: 'loading' })
    api.friends.richMenu(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setRichMenu({ kind: 'data', ...res.data })
      } else {
        setRichMenu({ kind: 'error' })
      }
    }).catch(() => {
      if (cancelled) return
      setRichMenu({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId])

  if (!friendId) return null

  return (
    <div
      className={
        embedded
          ? 'flex min-h-0 w-full flex-1 flex-col'
          : 'w-full lg:w-80 lg:flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden'
      }
    >
      {!embedded && (
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">友だち詳細</h3>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-red-600">{error}</div>
        ) : friend ? (
          <div className="divide-y divide-gray-100">
            {/* Profile Header */}
            <div className="p-4 flex items-start gap-3">
              {friend.pictureUrl ? (
                <img src={friend.pictureUrl} alt="" className="w-12 h-12 rounded-full flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-gray-500 text-base">{(friend.displayName || '?').charAt(0)}</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{friend.displayName || '名前なし'}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  登録日: {formatDate(friend.createdAt)}
                </p>
                {!friend.isFollowing && (
                  <span className="inline-block mt-1 px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                    ブロック中
                  </span>
                )}
              </div>
            </div>

            {/* LINE follow status and transition history */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-2">LINE状態</h4>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-gray-500">現在</span>
                <span className={`text-xs font-medium ${friend.isFollowing ? 'text-green-700' : 'text-red-600'}`}>
                  {friend.isFollowing ? 'フォロー中' : 'ブロック中'}
                </span>
              </div>
              {!friend.isFollowing && (
                <div className="flex items-start justify-between gap-3 mt-1.5">
                  <span className="text-[11px] text-gray-500">ブロック日時</span>
                  <span className="text-[11px] text-gray-700 text-right">
                    {friend.blockedAt ? formatDate(friend.blockedAt) : '日時不明（記録開始前）'}
                  </span>
                </div>
              )}
              {friend.isFollowing && friend.lastUnblockedAt && (
                <div className="flex items-start justify-between gap-3 mt-1.5">
                  <span className="text-[11px] text-gray-500">最終解除日時</span>
                  <span className="text-[11px] text-gray-700">{formatDate(friend.lastUnblockedAt)}</span>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 mb-1.5">直近の履歴</p>
                {friend.followEvents.length === 0 ? (
                  <p className="text-[11px] text-gray-400">記録開始後の履歴はありません</p>
                ) : (
                  <ul className="space-y-1.5">
                    {(showAllEvents ? friend.followEvents : friend.followEvents.slice(0, EVENT_PREVIEW_COUNT)).map((event) => (
                      <li key={event.id} className="flex items-center justify-between gap-3 text-[11px]">
                        <span className={
                          event.eventType === 'blocked'
                            ? 'text-red-600'
                            : event.eventType === 'added'
                              ? 'text-blue-700'
                              : 'text-green-700'
                        }>
                          {event.eventType === 'blocked' ? 'ブロック' : event.eventType === 'added' ? '友だち追加' : 'ブロック解除'}
                        </span>
                        <time className="text-gray-500">{formatDate(event.eventAt)}</time>
                      </li>
                    ))}
                  </ul>
                )}
                {friend.followEvents.length > EVENT_PREVIEW_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowAllEvents((open) => !open)}
                    className="mt-2 min-h-9 text-[11px] font-medium text-blue-600 hover:text-blue-800"
                  >
                    {showAllEvents
                      ? '履歴を折りたたむ'
                      : `残り${friend.followEvents.length - EVENT_PREVIEW_COUNT}件を表示`}
                  </button>
                )}
              </div>
            </div>

            {/* Status / Operator */}
            {(chatStatus?.status || operatorName) && (
              <div className="p-4 space-y-2">
                {chatStatus?.status && statusLabels[chatStatus.status] && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">対応状況</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusLabels[chatStatus.status].className}`}>
                      {statusLabels[chatStatus.status].label}
                    </span>
                  </div>
                )}
                {operatorName && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">担当者</span>
                    <span className="text-xs text-gray-700">{operatorName}</span>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            {chatStatus?.notes && (
              <div className="p-4">
                <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">個別メモ</h4>
                {/* 長文メモで詳細全体が押し流されないよう、既定は8行までに抑える。 */}
                <p className="max-h-40 overflow-y-auto text-xs text-gray-700 whitespace-pre-wrap break-words">
                  {chatStatus.notes}
                </p>
              </div>
            )}

            {/* Tags */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">タグ</h4>
              {friend.tags.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">タグなし</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Rich Menu */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">リッチメニュー</h4>
              {richMenu.kind === 'loading' ? (
                <p className="text-[11px] text-gray-400 italic">読み込み中...</p>
              ) : richMenu.kind === 'error' ? (
                <p className="text-[11px] text-red-500 italic">取得に失敗しました</p>
              ) : richMenu.id === null ? (
                <p className="text-[11px] text-gray-400 italic">未設定</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-700">{richMenu.name ?? '(名前なし)'}</span>
                  {richMenu.isDefault && (
                    <span className="px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                      デフォルト
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Metadata custom fields — 項目が多いと下に伸び続けるので折りたたむ */}
            {friend.metadata && Object.keys(friend.metadata).length > 0 && (() => {
              const entries = Object.entries(friend.metadata)
              const visible = showAllMetadata ? entries : entries.slice(0, METADATA_PREVIEW_COUNT)
              const hidden = entries.length - visible.length
              return (
                <div className="p-4">
                  <h4 className="text-[11px] font-medium text-gray-500 mb-2">友だち情報</h4>
                  <dl className="space-y-2 text-xs">
                    {visible.map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-[10px] text-gray-400 uppercase tracking-wide">{key}</dt>
                        <dd className="max-h-32 overflow-y-auto text-gray-700 mt-0.5 whitespace-pre-wrap break-words">
                          {renderValue(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {(hidden > 0 || showAllMetadata) && (
                    <button
                      type="button"
                      onClick={() => setShowAllMetadata((open) => !open)}
                      className="mt-2 min-h-9 text-[11px] font-medium text-blue-600 hover:text-blue-800"
                    >
                      {showAllMetadata ? '折りたたむ' : `残り${hidden}項目を表示`}
                    </button>
                  )}
                </div>
              )
            })()}

            {/*
              編集導線は将来追加予定 (現在の /friends は ?id= をハンドルしないため、
              リンク先が機能しない → Codex review で指摘済 → 代わりに削除。
              編集 UI が出来たら復活させる)。
            */}
          </div>
        ) : (
          <div className="p-4 text-xs text-gray-400">友だち情報がありません</div>
        )}
      </div>
    </div>
  )
}
