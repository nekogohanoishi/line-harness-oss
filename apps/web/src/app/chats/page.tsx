'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { extractQuickReply, parseStickerMessageContent, stickerFallback } from '@line-crm/shared'
import { api, fetchApi, type ChatCounts, type ChatOperatorMetric } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CcPromptButton from '@/components/cc-prompt-button'
import FlexPreviewComponent from '@/components/flex-preview'
import FriendInfoSheet from '@/components/chats/friend-info-sheet'
import FriendDeliveryControls from '@/components/chats/friend-delivery-controls'
import Sheet from '@/components/ui/sheet'
import MessageVariableButton from '@/components/message-variable-button'
import ManualRefreshButton from '@/components/ui/manual-refresh-button'

interface Chat {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  operatorId: string | null
  status: 'unread' | 'in_progress' | 'resolved'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  notes: string | null
  lastMessageAt: string | null
  dueAt: string | null
  openedAt: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  lastMessageContent: string | null
  lastMessageDirection: 'incoming' | 'outgoing' | null
  lastMessageType: string | null
  hasUnreadMessage: boolean
  createdAt: string
  updatedAt: string
}

interface ChatMessage {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

interface ChatDetail extends Chat {
  friendName: string
  friendPictureUrl: string | null
  messages?: ChatMessage[]
}

interface OperatorItem {
  id: string
  name: string
  isActive: boolean
}

interface TagItem {
  id: string
  name: string
  color: string
}

type InboxFilter = 'all' | 'unread_messages' | 'unread' | 'in_progress' | 'overdue' | 'resolved'

const emptyChatCounts: ChatCounts = {
  all: 0,
  unreadMessages: 0,
  unhandled: 0,
  inProgress: 0,
  overdue: 0,
  resolved: 0,
}

const statusConfig: Record<Chat['status'], { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-red-100 text-red-700' },
  in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' },
  resolved: { label: '解決済', className: 'bg-green-100 text-green-700' },
}

const priorityConfig: Record<Chat['priority'], { label: string; className: string }> = {
  low: { label: '低', className: 'text-gray-500' },
  normal: { label: '通常', className: 'text-gray-600' },
  high: { label: '高', className: 'text-amber-700' },
  urgent: { label: '緊急', className: 'font-semibold text-red-700' },
}

const inboxFilters: { key: InboxFilter; label: string; countKey: keyof ChatCounts }[] = [
  { key: 'all', label: '全て', countKey: 'all' },
  { key: 'unread_messages', label: '未確認', countKey: 'unreadMessages' },
  { key: 'unread', label: '未対応', countKey: 'unhandled' },
  { key: 'in_progress', label: '対応中', countKey: 'inProgress' },
  { key: 'overdue', label: '期限超過', countKey: 'overdue' },
  { key: 'resolved', label: '解決済', countKey: 'resolved' },
]

const SHOW_LOADING_PREF_KEY = 'lh_chat_show_loading_indicator'
const LOADING_SECONDS_PREF_KEY = 'lh_chat_loading_seconds'
const LOADING_REFRESH_INTERVAL_MS = 4000

function StickerMessageImage({ content }: { content: string }) {
  const [failed, setFailed] = useState(false)
  const sticker = parseStickerMessageContent(content)
  const fallback = stickerFallback(content)

  if (!sticker || failed) return <span>{fallback}</span>

  return (
    <img
      src={sticker.stickerUrl}
      alt={fallback}
      className="max-h-[140px] max-w-[140px] object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatListDatetime(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  const now = new Date()
  if (sameYmd(iso, now.toISOString())) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })
  }
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function isOverdue(chat: Pick<Chat, 'status' | 'dueAt'>): boolean {
  return chat.status !== 'resolved'
    && Boolean(chat.dueAt)
    && new Date(chat.dueAt!).getTime() < Date.now()
}

function formatResponseDuration(seconds: number | null): string {
  if (seconds === null) return '未計測'
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)}分`
  const hours = seconds / 3600
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}時間`
  return `${(hours / 24).toFixed(1)}日`
}

function sameYmd(aIso: string, bIso: string): boolean {
  const a = new Date(aIso)
  const b = new Date(bIso)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatYmdSlash(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

const ccPrompts = [
  {
    title: 'チャット対応テンプレート',
    prompt: `チャット対応で使えるテンプレートメッセージを作成してください。
1. よくある質問への回答テンプレート（挨拶、FAQ、サポート）
2. クレーム対応用の丁寧な返信テンプレート
3. フォローアップメッセージのテンプレート
手順を示してください。`,
  },
  {
    title: '未対応チャット確認',
    prompt: `未対応のチャットを確認し、対応優先度を整理してください。
1. 未読・対応中のチャット数を集計
2. 最終メッセージからの経過時間で優先度を判定
3. 長時間未対応のチャットへの対応アクションを提案
結果をレポートしてください。`,
  },
]

interface FriendItem {
  id: string
  displayName: string
  pictureUrl: string | null
  isFollowing: boolean
}

interface MessageLog {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

function DirectMessagePanel({ friendId, friend, onBack, onSent }: {
  friendId: string
  friend: FriendItem | null
  onBack: () => void
  onSent: () => void
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)
  const isComposingRef = useRef(false)
  const sendLockRef = useRef(false)
  const messageInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const loadMessages = async () => {
      setLoadingMessages(true)
      try {
        const res = await fetchApi<{ success: boolean; data: MessageLog[] }>(
          `/api/friends/${friendId}/messages`
        )
        if (res.success) setMessages(res.data)
      } catch { /* silent */ }
      setLoadingMessages(false)
    }
    loadMessages()
  }, [friendId])

  const handleSend = async () => {
    if (!message.trim() || sending || sendLockRef.current) return
    const content = message.trim().replace(/\{\{name\}\}/g, friend?.displayName ?? '')
    sendLockRef.current = true
    setSending(true)
    try {
      await api.chats.send(friendId, { content, messageType: 'text' })
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        direction: 'outgoing',
        messageType: 'text',
        content,
        createdAt: new Date().toISOString(),
      }])
      setMessage('')
      onSent()
    } catch { /* silent */ }
    setSending(false)
    sendLockRef.current = false
  }

  function renderContent(msg: MessageLog) {
    // 選択肢ボタン (クイックリプライ) の保存用の印が本文に残っている記録もあるので、表示前に取り除く
    if (msg.messageType === 'text') return extractQuickReply('text', msg.content).content
    if (msg.messageType === 'flex') {
      try {
        const parsed = JSON.parse(msg.content)
        // Extract ALL text from flex (up to 200 chars)
        const texts: string[] = []
        const collectText = (obj: Record<string, unknown>) => {
          if (texts.join(' ').length > 200) return
          if (obj.type === 'text' && typeof obj.text === 'string') {
            const t = (obj.text as string).trim()
            if (t && !t.startsWith('{{')) texts.push(t)
          }
          for (const key of ['header', 'body', 'footer']) {
            if (obj[key]) collectText(obj[key] as Record<string, unknown>)
          }
          if (Array.isArray(obj.contents)) {
            for (const c of obj.contents) collectText(c as Record<string, unknown>)
          }
        }
        collectText(parsed)
        return texts.slice(0, 4).join('\n') || '[Flex Message]'
      } catch { return '[Flex Message]' }
    }
    if (msg.messageType === 'sticker') {
      return <StickerMessageImage content={msg.content} />
    }
    return `[${msg.messageType}]`
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-gray-200 flex items-center gap-3">
        <button onClick={onBack} aria-label="戻る" className="lg:hidden -ml-2 flex h-11 w-9 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {friend?.pictureUrl ? (
          <img src={friend.pictureUrl} alt="" className="w-8 h-8 rounded-full" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-gray-500 text-xs">{(friend?.displayName || '?').charAt(0)}</span>
          </div>
        )}
        <div>
          <p className="text-sm font-bold text-gray-900">{friend?.displayName || '不明'}</p>
          <p className="text-xs text-gray-400">メッセージ履歴</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingMessages ? (
          <p className="text-center text-gray-400 text-sm">読み込み中...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-gray-400 text-sm">メッセージ履歴がありません</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] min-w-0 rounded-2xl px-4 py-2 sm:max-w-[75%] ${
                msg.direction === 'outgoing'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}>
                <div className="text-sm whitespace-pre-wrap break-words">{renderContent(msg)}</div>
                <p className={`text-xs mt-1 ${msg.direction === 'outgoing' ? 'text-green-200' : 'text-gray-400'}`}>
                  {new Date(msg.createdAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex-shrink-0 border-t border-gray-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex justify-end">
          <MessageVariableButton
            targetRef={messageInputRef}
            value={message}
            onChange={setMessage}
            insertValue={friend?.displayName || '{{name}}'}
            disabled={!friend?.displayName}
          />
        </div>
        <div className="flex gap-2">
          <input
            ref={messageInputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onCompositionStart={() => { isComposingRef.current = true }}
            onCompositionEnd={() => { isComposingRef.current = false }}
            onKeyDown={(e) => {
              // IME変換確定のEnterでは送信しない
              if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="メッセージを入力..."
            className="h-11 min-w-0 flex-1 border border-gray-300 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="h-11 min-w-[4.5rem] flex-shrink-0 rounded-lg px-4 text-white text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {sending ? '...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatsPage() {
  const { selectedAccountId } = useAccount()
  const [chats, setChats] = useState<Chat[]>([])
  const [allFriends, setAllFriends] = useState<FriendItem[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<ChatDetail | null>(null)
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all')
  const inboxFilterRef = useRef<InboxFilter>('all')
  const [operatorFilter, setOperatorFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'' | Chat['priority']>('')
  const [operators, setOperators] = useState<OperatorItem[]>([])
  const [tags, setTags] = useState<TagItem[]>([])
  const [chatCounts, setChatCounts] = useState<ChatCounts>(emptyChatCounts)
  const [operatorMetrics, setOperatorMetrics] = useState<ChatOperatorMetric[]>([])
  const [showOperatorMetrics, setShowOperatorMetrics] = useState(false)
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set())
  const [bulkOperatorId, setBulkOperatorId] = useState('')
  const [bulkAction, setBulkAction] = useState<'read' | 'assign' | null>(null)
  const [showOperatorForm, setShowOperatorForm] = useState(false)
  const [newOperatorName, setNewOperatorName] = useState('')
  const [newOperatorEmail, setNewOperatorEmail] = useState('')
  const [creatingOperator, setCreatingOperator] = useState(false)
  // Send mode: 'enter' = Enter sends, Shift+Enter = newline; 'shift-enter' = reverse
  const [sendMode, setSendMode] = useState<'enter' | 'shift-enter'>('enter')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [sending, setSending] = useState(false)
  const sendLockRef = useRef(false)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [priorityValue, setPriorityValue] = useState<Chat['priority']>('normal')
  const [dueAtValue, setDueAtValue] = useState('')
  const [savingSla, setSavingSla] = useState(false)
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false)
  const [loadingSeconds, setLoadingSeconds] = useState(5)
  const lastLoadingTriggerAtRef = useRef<Record<string, number>>({})
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false)
  // 友だち詳細は全幅で同じシートを使い、会話領域を常時圧迫しない。
  const [showFriendSheet, setShowFriendSheet] = useState(false)
  const [deliveryTarget, setDeliveryTarget] = useState<{ id: string; name: string } | null>(null)
  const [deliveryConfirmationOpen, setDeliveryConfirmationOpen] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)
  const [showSendOptions, setShowSendOptions] = useState(false)
  const [composerMode, setComposerMode] = useState<'reply' | 'note'>('reply')
  // 「ここから未読」の区切りを出す対象のチャットID。
  // チャットを開いた直後に markChatRead が走って hasUnreadMessage が false に
  // なるため、一覧の値を選択時にスナップショットしておく。
  const [unreadAnchorChatId, setUnreadAnchorChatId] = useState<string | null>(null)
  const isComposingRef = useRef(false)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const messageContentRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    try {
      const rawEnabled = localStorage.getItem(SHOW_LOADING_PREF_KEY)
      const rawSeconds = localStorage.getItem(LOADING_SECONDS_PREF_KEY)
      if (rawEnabled !== null) setShowLoadingIndicator(rawEnabled === '1')
      if (rawSeconds) {
        const n = Number.parseInt(rawSeconds, 10)
        if (Number.isFinite(n) && n >= 5 && n <= 60) setLoadingSeconds(n)
      }
    } catch {
      // localStorage unavailable
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_LOADING_PREF_KEY, showLoadingIndicator ? '1' : '0')
      localStorage.setItem(LOADING_SECONDS_PREF_KEY, String(loadingSeconds))
    } catch {
      // localStorage unavailable
    }
  }, [showLoadingIndicator, loadingSeconds])

  const filterParams = useCallback(() => ({
    operatorId: operatorFilter || undefined,
    tagId: tagFilter || undefined,
    accountId: selectedAccountId || undefined,
    priority: priorityFilter || undefined,
  }), [operatorFilter, tagFilter, priorityFilter, selectedAccountId])

  const loadChats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError('')
    try {
      const params: Parameters<typeof api.chats.list>[0] = filterParams()
      if (inboxFilter === 'unread_messages') params.readStatus = 'unread'
      else if (inboxFilter === 'overdue') params.overdue = true
      else if (inboxFilter !== 'all') params.status = inboxFilter
      const chatRes = await api.chats.list(params)
      if (chatRes.success) {
        setChats(chatRes.data as unknown as Chat[])
      }
    } catch {
      setError('チャットの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filterParams, inboxFilter])

  const loadChatCounts = useCallback(async () => {
    try {
      const response = await api.chats.counts(filterParams())
      if (response.success) setChatCounts(response.data)
    } catch {
      // 一覧が利用できる場合は、件数だけの一時的な失敗を画面全体のエラーにしない。
    }
  }, [filterParams])

  const loadOperatorMetrics = useCallback(async () => {
    try {
      const response = await api.chats.operatorMetrics({
        accountId: selectedAccountId || undefined,
      })
      if (response.success) setOperatorMetrics(response.data.items)
    } catch {
      // 集計の取得失敗だけではチャット操作を止めず、次の明示更新で再試行する。
    }
  }, [selectedAccountId])

  useEffect(() => {
    setSelectedChatIds(new Set())
  }, [inboxFilter, operatorFilter, tagFilter, priorityFilter, selectedAccountId])

  // Friends list (for the "new direct message" modal) — loaded lazily in the background
  // Previously fetched 800 friends in parallel with chats, which blocked the initial render.
  const loadAllFriends = useCallback(async () => {
    try {
      const friendRes = await api.friends.list({ accountId: selectedAccountId || undefined, limit: '800' })
      if (friendRes.success) {
        setAllFriends((friendRes.data as unknown as { items: FriendItem[] }).items)
      }
    } catch { /* silent */ }
  }, [selectedAccountId])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.operators.list(), api.tags.list()]).then(([operatorRes, tagRes]) => {
      if (cancelled) return
      if (operatorRes.success) {
        setOperators((operatorRes.data as unknown as OperatorItem[]).filter((operator) => operator.isActive))
      }
      if (tagRes.success) setTags(tagRes.data as unknown as TagItem[])
    }).catch(() => {
      // 絞り込み候補が取れなくてもチャット本体は利用可能にする。
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { void loadAllFriends() }, [loadAllFriends])

  // Keep ref in sync so setChats updater can read the latest filter without stale closure
  useEffect(() => { inboxFilterRef.current = inboxFilter }, [inboxFilter])

  // Load/save sendMode preference (guarded — privacy-restricted browsers throw)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('chat.sendMode')
      if (saved === 'enter' || saved === 'shift-enter') setSendMode(saved)
    } catch { /* localStorage unavailable */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('chat.sendMode', sendMode) } catch { /* ignore */ }
  }, [sendMode])

  const loadChatDetail = useCallback(async (chatId: string, silent = false) => {
    if (!silent) setDetailLoading(true)
    if (!silent) setError('')
    try {
      const res = await api.chats.get(chatId)
      if (res.success) {
        const detail = res.data as unknown as ChatDetail
        setChatDetail(detail)
        setNotes(detail.notes || '')
        if (!silent) {
          setPriorityValue(detail.priority || 'normal')
          setDueAtValue(toDatetimeLocal(detail.dueAt))
        }
      } else {
        // API は 200 で success:false を返す可能性 (例: 404 lookup)。詳細を画面に出す。
        const errMsg = (res as { error?: string }).error ?? '不明なエラー'
        if (!silent) setError(`チャット詳細の読み込みに失敗しました: ${errMsg}`)
      }
    } catch (err) {
      // ネットワーク / parse / auth fail などの例外。empty catch だと原因不明だったので詳細を出す。
      const msg = err instanceof Error ? err.message : String(err)
      if (!silent) setError(`チャット詳細の読み込みに失敗しました: ${msg}`)
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [])

  const refreshChats = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      await Promise.all([
        loadChats(true),
        loadChatCounts(),
        loadOperatorMetrics(),
        selectedChatId ? loadChatDetail(selectedChatId, true) : Promise.resolve(),
      ])
    } finally {
      setRefreshing(false)
    }
  }, [loadChatCounts, loadChatDetail, loadChats, loadOperatorMetrics, selectedChatId])

  useEffect(() => {
    void Promise.all([loadChats(), loadChatCounts(), loadOperatorMetrics()])
  }, [loadChats, loadChatCounts, loadOperatorMetrics])

  const markChatRead = useCallback(async (chatId: string) => {
    try {
      const response = await api.chats.markRead(chatId)
      if (!response.success) return
      setChats((current) => {
        const updated = current.map((chat) => (
          chat.id === chatId ? { ...chat, hasUnreadMessage: false } : chat
        ))
        return inboxFilterRef.current === 'unread_messages'
          ? updated.filter((chat) => chat.id !== chatId)
          : updated
      })
      setChatDetail((current) => (
        current?.id === chatId ? { ...current, hasUnreadMessage: false } : current
      ))
      void loadChatCounts()
      void loadOperatorMetrics()
      window.dispatchEvent(new Event('lh:notification-counts-changed'))
    } catch {
      // 次の明示更新でサーバー上の既読状態を再取得する。
    }

  }, [loadChatCounts, loadOperatorMetrics])
  // Deep-link from other pages (e.g. /form-submissions): ?friend=<friendId>
  // chat list returns id = friend_id, so selectedChatId === friendId is correct.
  // If no chat exists yet, loadChatDetail will fail and the user can fall back to
  // the friend list — acceptable for now.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const friendId = params.get('friend')
    if (friendId) setSelectedChatId(friendId)
  }, [])

  useEffect(() => {
    if (selectedChatId) {
      void loadChatDetail(selectedChatId)
      void markChatRead(selectedChatId)
      return
    }
    setChatDetail(null)
  }, [selectedChatId, loadChatDetail, markChatRead])

  // Surface deep-linked chats in the sidebar even when the current account
  // filter or status filter would exclude them — otherwise the user replies
  // and the conversation stays invisible until they refresh.
  // Re-runs when `chats` changes (e.g. after loadChats refetches on filter
  // change) so the synthetic entry is re-injected if the next API result
  // does not include it. Returning `prev` unchanged when already present
  // avoids any update loop.
  useEffect(() => {
    if (!chatDetail) return
    setChats((prev) => {
      if (prev.some((c) => c.id === chatDetail.id)) return prev
      // /api/chats/:id may not populate the lastMessage* fields; derive
      // from the messages array as a fallback so the sidebar preview is
      // not stuck on "(まだメッセージなし)".
      const lastMsg = chatDetail.messages?.[chatDetail.messages.length - 1]
      const entry: Chat = {
        id: chatDetail.id,
        friendId: chatDetail.friendId,
        friendName: chatDetail.friendName,
        friendPictureUrl: chatDetail.friendPictureUrl,
        operatorId: chatDetail.operatorId ?? null,
        status: chatDetail.status,
        priority: chatDetail.priority ?? 'normal',
        notes: chatDetail.notes ?? null,
        lastMessageAt: chatDetail.lastMessageAt ?? lastMsg?.createdAt ?? null,
        dueAt: chatDetail.dueAt ?? null,
        openedAt: chatDetail.openedAt ?? null,
        firstResponseAt: chatDetail.firstResponseAt ?? null,
        resolvedAt: chatDetail.resolvedAt ?? null,
        lastMessageContent: chatDetail.lastMessageContent ?? lastMsg?.content ?? null,
        lastMessageDirection: chatDetail.lastMessageDirection ?? lastMsg?.direction ?? null,
        lastMessageType: chatDetail.lastMessageType ?? lastMsg?.messageType ?? null,
        hasUnreadMessage: chatDetail.hasUnreadMessage ?? false,
        createdAt: chatDetail.createdAt,
        updatedAt: chatDetail.updatedAt,
      }
      return [entry, ...prev]
    })
  }, [chatDetail, chats])

  // 詳細が新しくロードされたら最下部（＝最新メッセージ）までスクロールする。
  // そこから上にスクロールすれば過去のメッセージを辿れる（LINE受信画面と同じUX）。
  // ユーザーが手動でスクロールしたら delayed auto-scroll は発動させない。
  useEffect(() => {
    if (!chatDetail?.messages || chatDetail.messages.length === 0) return
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    let userScrolled = false
    const onScroll = () => {
      if (!messagesScrollRef.current) return
      const current = messagesScrollRef.current
      // 下端から一定以上離れたらユーザー操作とみなす
      if (current.scrollHeight - current.scrollTop - current.clientHeight > 20) {
        userScrolled = true
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // 画像/Flex の表示後に高さが増える場合に追従するフォロワー（ユーザーがスクロール済みなら発動させない）
    const id = window.setTimeout(() => {
      if (userScrolled || !messagesScrollRef.current) return
      messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight
    }, 150)
    return () => {
      window.clearTimeout(id)
      el.removeEventListener('scroll', onScroll)
    }
  }, [chatDetail?.id, chatDetail?.messages?.length])

  const handleSelectChat = (chatId: string) => {
    // 未読の目印は「開く直前の一覧の状態」で決める。既読化 API はこの直後に
    // 走るので、chatDetail 側の値を見ると常に false になってしまう。
    const target = chats.find((chat) => chat.id === chatId)
    setUnreadAnchorChatId(target?.hasUnreadMessage ? chatId : null)
    setSelectedChatId(chatId)
    setMessageContent('')
    setShowChatSettings(false)
    setShowSendOptions(false)
    setComposerMode('reply')
  }

  /**
   * 「ここから未読」を挿入する位置。未読とは「末尾に連続する受信メッセージが
   * まだ読まれていない」状態なので、末尾から受信が続く区間の先頭を返す。
   * 対象外なら -1（どのインデックスとも一致しない）。
   */
  const unreadStartIndex = (() => {
    if (!chatDetail || chatDetail.id !== unreadAnchorChatId) return -1
    const messages = chatDetail.messages ?? []
    if (messages.length === 0) return -1
    let index = messages.length
    while (index > 0 && messages[index - 1].direction === 'incoming') index -= 1
    // 全件が受信メッセージなら区切り線を出す意味がないので出さない。
    return index === 0 || index === messages.length ? -1 : index
  })()

  const triggerLoadingAnimation = useCallback(async (chatId: string) => {
    if (!showLoadingIndicator) return

    const now = Date.now()
    const last = lastLoadingTriggerAtRef.current[chatId] ?? 0
    if (now - last < LOADING_REFRESH_INTERVAL_MS) return
    lastLoadingTriggerAtRef.current[chatId] = now

    try {
      await fetchApi<{ success: boolean }>(`/api/chats/${chatId}/loading`, {
        method: 'POST',
        body: JSON.stringify({ loadingSeconds }),
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown'
      setError(`ローディング表示の開始に失敗しました: ${detail}`)
    }
  }, [showLoadingIndicator, loadingSeconds])

  const handleSendMessage = async () => {
    if (!selectedChatId || !messageContent.trim() || sending || sendLockRef.current) return
    const content = messageContent.trim().replace(/\{\{name\}\}/g, chatDetail?.friendName ?? '')
    const sendingChatId = selectedChatId  // capture the chat id for this send
    sendLockRef.current = true
    setSending(true)
    try {
      await api.chats.send(sendingChatId, { content })
      setMessageContent('')
      // Optimistic update: append message locally instead of refetching (prevents scroll jump / full reload feel)
      const now = new Date().toISOString()
      // Only mutate chatDetail if it still corresponds to the chat we just sent to
      setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
        ...prev,
        lastMessageAt: now,
        status: 'in_progress',
        messages: [
          ...(prev.messages ?? []),
          {
            id: crypto.randomUUID(),
            direction: 'outgoing',
            messageType: 'text',
            content,
            createdAt: now,
          },
        ],
      } : prev)
      setChats((prev) => {
        // Skip reconciliation if the list no longer contains this chat (e.g. tab changed mid-send)
        const exists = prev.some((c) => c.id === sendingChatId)
        if (!exists) return prev
        const currentFilter = inboxFilterRef.current
        const updated = prev.map((c) => c.id === sendingChatId ? {
          ...c,
          lastMessageAt: now,
          status: 'in_progress' as const,
          // 一覧の preview も即時更新する。incoming 優先ロジックで上書きされ得るが、
          // 楽観 UI では「operator が今送った文面」が一瞬見えるのが期待動作。
          // 次回 loadChats() で server 側の真の最新 (incoming 優先) に reconcile される。
          lastMessageContent: content,
          lastMessageDirection: 'outgoing' as const,
          lastMessageType: 'text' as const,
        } : c)
        // 返信によって現在の絞り込み条件から外れた行は一覧から除く。
        const filtered = currentFilter === 'all'
          ? updated
          : currentFilter === 'unread_messages'
            ? updated.filter((chat) => chat.hasUnreadMessage)
            : currentFilter === 'overdue'
              ? updated.filter(isOverdue)
              : updated.filter((chat) => chat.status === currentFilter)
        return [...filtered].sort((a, b) => {
          const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
          const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
          return bt - at
        })
      })
      void loadChatCounts()
      void loadOperatorMetrics()
    } catch {
      setError('メッセージの送信に失敗しました。')
    } finally {
      setSending(false)
      sendLockRef.current = false
    }
  }

  const handleStatusUpdate = async (newStatus: Chat['status']) => {
    if (!selectedChatId) return
    try {
      await api.chats.update(selectedChatId, { status: newStatus })
      await Promise.all([loadChatDetail(selectedChatId), loadChats(true), loadChatCounts(), loadOperatorMetrics()])
    } catch {
      setError('ステータスの更新に失敗しました。')
    }
  }

  const handleSaveSla = async () => {
    if (!selectedChatId || savingSla) return
    setSavingSla(true)
    setError('')
    try {
      const dueAt = dueAtValue ? new Date(dueAtValue).toISOString() : null
      await api.chats.update(selectedChatId, {
        priority: priorityValue,
        dueAt,
      })
      await Promise.all([loadChatDetail(selectedChatId), loadChats(true), loadChatCounts(), loadOperatorMetrics()])
    } catch {
      setError('優先度と対応期限を保存できませんでした。')
    } finally {
      setSavingSla(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!selectedChatId) return
    setSavingNotes(true)
    try {
      await api.chats.update(selectedChatId, { notes })
      loadChatDetail(selectedChatId)
    } catch {
      setError('メモの保存に失敗しました。')
    } finally {
      setSavingNotes(false)
    }
  }

  const toggleChatSelection = (chatId: string) => {
    setSelectedChatIds((current) => {
      const next = new Set(current)
      if (next.has(chatId)) next.delete(chatId)
      else next.add(chatId)
      return next
    })
  }

  const allVisibleSelected = chats.length > 0 && chats.every((chat) => selectedChatIds.has(chat.id))

  const toggleAllVisible = () => {
    setSelectedChatIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) chats.forEach((chat) => next.delete(chat.id))
      else chats.forEach((chat) => next.add(chat.id))
      return next
    })
  }

  const handleBulkRead = async () => {
    const friendIds = [...selectedChatIds]
    if (friendIds.length === 0 || bulkAction) return
    setBulkAction('read')
    setError('')
    try {
      const response = await api.chats.markReadBulk(friendIds)
      if (!response.success) throw new Error('bulk read failed')
      setSelectedChatIds(new Set())
      await Promise.all([loadChats(true), loadChatCounts()])
      window.dispatchEvent(new Event('lh:notification-counts-changed'))
    } catch {
      setError('選択したチャットを確認済みにできませんでした。')
    } finally {
      setBulkAction(null)
    }
  }

  const handleBulkAssign = async () => {
    const friendIds = [...selectedChatIds]
    if (friendIds.length === 0 || !bulkOperatorId || bulkAction) return
    setBulkAction('assign')
    setError('')
    try {
      const operatorId = bulkOperatorId === 'unassigned' ? null : bulkOperatorId
      const response = await api.chats.bulkAssign(friendIds, operatorId)
      if (!response.success) throw new Error('bulk assign failed')
      setSelectedChatIds(new Set())
      setBulkOperatorId('')
      await Promise.all([loadChats(true), loadChatCounts()])
    } catch {
      setError('選択したチャットの担当者を変更できませんでした。')
    } finally {
      setBulkAction(null)
    }
  }
  const handleCreateOperator = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newOperatorName.trim()
    const email = newOperatorEmail.trim()
    if (!name || !email || creatingOperator) return
    setCreatingOperator(true)
    setError('')
    try {
      const response = await api.operators.create({ name, email })
      if (!response.success) throw new Error('operator create failed')
      const created = { ...(response.data as unknown as OperatorItem), isActive: true }
      setOperators((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'ja')))
      setBulkOperatorId(created.id)
      setNewOperatorName('')
      setNewOperatorEmail('')
      setShowOperatorForm(false)
    } catch {
      setError('担当者を追加できませんでした。')
    } finally {
      setCreatingOperator(false)
    }
  }


  const clearFilters = () => {
    setInboxFilter('all')
    setOperatorFilter('')
    setTagFilter('')
    setPriorityFilter('')
  }

  const operatorNameById = (operatorId: string | null) => {
    if (!operatorId) return '未割当'
    return operators.find((operator) => operator.id === operatorId)?.name ?? '不明な担当者'
  }

  const activeFilters = [
    operatorFilter
      ? {
          key: 'operator',
          label: `担当: ${operatorFilter === 'unassigned' ? '未割当' : operatorNameById(operatorFilter)}`,
          clear: () => setOperatorFilter(''),
        }
      : null,
    tagFilter
      ? {
          key: 'tag',
          label: `タグ: ${tags.find((tag) => tag.id === tagFilter)?.name ?? '指定あり'}`,
          clear: () => setTagFilter(''),
        }
      : null,
    priorityFilter
      ? {
          key: 'priority',
          label: `優先度: ${priorityConfig[priorityFilter].label}`,
          clear: () => setPriorityFilter(''),
        }
      : null,
  ].filter((filter): filter is { key: string; label: string; clear: () => void } => Boolean(filter))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // IME変換確定のEnterでは送信しない
    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
    if (e.key !== 'Enter') return
    // sendMode 'enter': Enter単体で送信、Shift+Enterは改行
    // sendMode 'shift-enter': Shift+Enterで送信、Enter単体は改行
    const shouldSend = sendMode === 'enter' ? !e.shiftKey : e.shiftKey
    if (shouldSend) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-3 hidden h-8 items-center justify-between gap-3 lg:flex">
        <h1 className="text-lg font-semibold text-gray-900">オペレーターチャット</h1>
        <div className="hidden items-center gap-3 text-xs text-gray-500 sm:flex">
          <span>未確認 <strong className="font-semibold tabular-nums text-gray-800">{chatCounts.unreadMessages}</strong></span>
          <span>未対応 <strong className="font-semibold tabular-nums text-gray-800">{chatCounts.unhandled}</strong></span>
          <span>期限超過 <strong className="font-semibold tabular-nums text-red-700">{chatCounts.overdue}</strong></span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* モバイルではアプリヘッダーに現在地があるため、ページ見出しを省いて会話領域を優先する。 */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-md border border-gray-200 bg-white">
        {/* Left Panel: Chat List */}
        <section className={`w-full flex-col overflow-hidden bg-white lg:w-[21rem] lg:flex-shrink-0 lg:border-r lg:border-gray-200 xl:w-[22rem] 2xl:w-[23rem] ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
          <div className="border-b border-gray-200 bg-white">
            <div className="flex h-10 gap-1 overflow-x-auto border-b border-gray-200 px-2">
              {inboxFilters.map((filter) => {
                const active = inboxFilter === filter.key
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setInboxFilter(filter.key)}
                    className={`flex h-10 flex-shrink-0 items-center gap-1 border-b-2 px-2 text-xs font-medium transition-colors ${
                      active
                        ? 'border-green-600 text-gray-900'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <span>{filter.label}</span>
                    <span className={`min-w-4 text-center tabular-nums ${active ? 'font-semibold text-green-700' : 'text-gray-400'}`}>
                      {chatCounts[filter.countKey]}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex h-10 items-center justify-between gap-2 px-2">
              <button
                type="button"
                onClick={() => setShowFilters((open) => !open)}
                aria-expanded={showFilters}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  showFilters || activeFilters.length > 0
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M6 12h12M10 20h4" />
                </svg>
                絞り込み
                {activeFilters.length > 0 && (
                  <span className="min-w-4 rounded bg-white/20 px-1 text-center tabular-nums">{activeFilters.length}</span>
                )}
              </button>
              <div className="flex items-center gap-1">
                <ManualRefreshButton
                  onClick={refreshChats}
                  loading={refreshing}
                  label="チャットを更新"
                  iconOnly
                />
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 px-1 text-xs text-gray-500 hover:text-gray-800">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={chats.length === 0}
                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 disabled:opacity-40"
                  />
                  全選択
                </label>
              </div>
            </div>

            {activeFilters.length > 0 && (
              <div className="flex min-h-8 flex-wrap items-center gap-1 border-t border-gray-200 px-2 py-1">
                {activeFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={filter.clear}
                    className="inline-flex h-6 max-w-full items-center gap-1 rounded bg-gray-100 px-2 text-xs text-gray-700 hover:bg-gray-200"
                    title={`${filter.label}を解除`}
                  >
                    <span className="truncate">{filter.label}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
                <button type="button" onClick={clearFilters} className="ml-auto h-6 px-1 text-xs text-gray-500 hover:text-gray-900">
                  すべて解除
                </button>
              </div>
            )}

            {showFilters && (
              <div className="grid grid-cols-2 gap-2 border-t border-gray-200 bg-gray-50 px-2 py-2">
                <label className="min-w-0">
                  <span className="sr-only">担当者で絞り込む</span>
                  <select
                    value={operatorFilter}
                    onChange={(event) => setOperatorFilter(event.target.value)}
                    className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="">担当者：全て</option>
                    <option value="unassigned">未割当</option>
                    {operators.map((operator) => (
                      <option key={operator.id} value={operator.id}>{operator.name}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="sr-only">タグで絞り込む</span>
                  <select
                    value={tagFilter}
                    onChange={(event) => setTagFilter(event.target.value)}
                    className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="">タグ：全て</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 min-w-0">
                  <span className="sr-only">優先度で絞り込む</span>
                  <select
                    value={priorityFilter}
                    onChange={(event) => setPriorityFilter(event.target.value as '' | Chat['priority'])}
                    className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="">優先度：全て</option>
                    <option value="urgent">緊急</option>
                    <option value="high">高</option>
                    <option value="normal">通常</option>
                    <option value="low">低</option>
                  </select>
                </label>
                <div className="col-span-2 flex h-7 items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowOperatorMetrics((current) => !current)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-800"
                  aria-expanded={showOperatorMetrics}
                >
                  担当者状況
                </button>
                <button
                  type="button"
                  onClick={() => setShowOperatorForm((current) => !current)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-800"
                >
                  担当者追加
                </button>
              </div>
              </div>
            )}

            {showFilters && showOperatorMetrics && (
              <div className="max-h-52 overflow-auto border-t border-gray-200">
                {/* モバイル: 5列の表は 375px では読めないので1人1ブロックに展開する */}
                <ul className="divide-y divide-gray-200 lg:hidden">
                  {operatorMetrics.map((metric) => (
                    <li key={metric.operatorId ?? 'unassigned'} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-gray-800">{metric.operatorName}</span>
                        <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
                          初回応答 {formatResponseDuration(metric.averageFirstResponseSeconds)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                        <span className="tabular-nums">対応中 {metric.active}</span>
                        <span className={`tabular-nums ${metric.overdue > 0 ? 'font-semibold text-red-700' : ''}`}>
                          超過 {metric.overdue}
                        </span>
                        <span className="tabular-nums">30日解決 {metric.resolved}</span>
                      </div>
                    </li>
                  ))}
                  {operatorMetrics.length === 0 && (
                    <li className="px-3 py-4 text-center text-xs text-gray-400">担当者の実績はまだありません</li>
                  )}
                </ul>

                <table className="hidden w-full table-fixed text-left text-xs lg:table">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="w-[32%] px-3 py-2 font-medium">担当者</th>
                      <th className="px-1 py-2 text-right font-medium">対応中</th>
                      <th className="px-1 py-2 text-right font-medium">超過</th>
                      <th className="px-1 py-2 text-right font-medium">30日解決</th>
                      <th className="px-3 py-2 text-right font-medium">初回応答</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {operatorMetrics.map((metric) => (
                      <tr key={metric.operatorId ?? 'unassigned'} className="text-gray-700">
                        <td className="truncate px-3 py-2" title={metric.operatorName}>{metric.operatorName}</td>
                        <td className="px-1 py-2 text-right tabular-nums">{metric.active}</td>
                        <td className={`px-1 py-2 text-right tabular-nums ${metric.overdue > 0 ? 'font-semibold text-red-700' : ''}`}>
                          {metric.overdue}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums">{metric.resolved}</td>
                        <td className="px-3 py-2 text-right tabular-nums" title={`計測件数: ${metric.responseSamples}件`}>
                          {formatResponseDuration(metric.averageFirstResponseSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showFilters && showOperatorForm && (
              <form onSubmit={handleCreateOperator} className="border-t border-gray-200 bg-gray-50 px-3 py-2">
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="mb-1 block text-xs text-gray-500">担当者名</span>
                    <input
                      type="text"
                      value={newOperatorName}
                      onChange={(event) => setNewOperatorName(event.target.value)}
                      required
                      className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-gray-500">メールアドレス</span>
                    <input
                      type="email"
                      value={newOperatorEmail}
                      onChange={(event) => setNewOperatorEmail(event.target.value)}
                      required
                      autoComplete="email"
                      className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                  </label>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOperatorForm(false)}
                    className="h-8 px-2 text-xs font-medium text-gray-500 hover:text-gray-800"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={!newOperatorName.trim() || !newOperatorEmail.trim() || creatingOperator}
                    className="h-8 rounded-md bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
                  >
                    {creatingOperator ? '追加中...' : '追加'}
                  </button>
                </div>
              </form>
            )}

            {selectedChatIds.size > 0 && (
              <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-800">{selectedChatIds.size}件を選択中</span>
                  <button
                    type="button"
                    onClick={() => setSelectedChatIds(new Set())}
                    className="text-xs text-gray-500 hover:text-gray-800"
                  >
                    選択解除
                  </button>
                </div>
                {/* 一括操作 — 狭幅では「確認済みにする」を全幅、担当者選択と
                    変更ボタンを1行にして、どのボタンも押しやすい幅を保つ。 */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBulkRead}
                    disabled={bulkAction !== null}
                    className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 sm:h-9 sm:w-auto"
                  >
                    {bulkAction === 'read' ? '確認中...' : '確認済みにする'}
                  </button>
                  <select
                    value={bulkOperatorId}
                    onChange={(event) => setBulkOperatorId(event.target.value)}
                    className="h-11 min-w-32 flex-1 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 sm:h-9"
                  >
                    <option value="">担当者を選択</option>
                    <option value="unassigned">未割当に戻す</option>
                    {operators.map((operator) => (
                      <option key={operator.id} value={operator.id}>{operator.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleBulkAssign}
                    disabled={!bulkOperatorId || bulkAction !== null}
                    className="h-11 flex-shrink-0 rounded-md bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9"
                  >
                    {bulkAction === 'assign' ? '変更中...' : '担当を変更'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div>
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex h-16 items-center gap-2 border-b border-gray-200 px-2 animate-pulse">
                    <div className="h-4 w-4 rounded bg-gray-100" />
                    <div className="h-9 w-9 rounded-full bg-gray-200" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-28 rounded bg-gray-200" />
                      <div className="h-2 w-40 max-w-full rounded bg-gray-100" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {chats.map((chat) => {
                  const isSelected = selectedChatId === chat.id
                  const overdue = isOverdue(chat)
                  // Message read state is independent from the handling workflow status.
                  const hasUnreadMessage = chat.hasUnreadMessage
                  // 最新メッセージの本文 preview。flex/image は文字列で見せても意味が薄いので type 表記に置換。
                  const previewRaw = extractQuickReply('text', chat.lastMessageContent ?? '').content
                  const preview = (() => {
                    if (chat.lastMessageType === 'image') return '[画像]'
                    if (chat.lastMessageType === 'flex') return '[カード型メッセージ]'
                    if (chat.lastMessageType === 'sticker') return '[スタンプ]'
                    if (chat.lastMessageType === 'video') return '[動画]'
                    if (chat.lastMessageType === 'audio') return '[音声]'
                    if (chat.lastMessageType === 'file') return '[ファイル]'
                    if (chat.lastMessageType === 'location') return '[位置情報]'
                    return previewRaw.replace(/\n+/g, ' ').slice(0, 60)
                  })()
                  const showStatusText = inboxFilter === 'all' || inboxFilter === 'unread_messages'
                  const assigneeName = operatorNameById(chat.operatorId)
                  const stateBarClass = overdue
                    ? 'bg-red-500'
                    : chat.status === 'unread'
                      ? 'bg-orange-400'
                      : chat.status === 'in_progress'
                        ? 'bg-amber-300'
                        : 'bg-green-300'
                  return (
                    <div
                      key={chat.id}
                      className={`group relative flex h-16 border-b border-gray-200 transition-colors ${
                        isSelected && !selectedFriendId
                          ? 'bg-green-50/80'
                          : selectedChatIds.has(chat.id)
                            ? 'bg-gray-50'
                            : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className={`absolute inset-y-0 left-0 w-[3px] ${stateBarClass}`} aria-hidden="true" />
                      <label className="flex w-8 flex-shrink-0 cursor-pointer items-center justify-center pl-1">
                        <span className="sr-only">{chat.friendName}を選択</span>
                        <input
                          type="checkbox"
                          checked={selectedChatIds.has(chat.id)}
                          onChange={() => toggleChatSelection(chat.id)}
                          className="h-4 w-4 rounded border-gray-300 text-green-600 opacity-60 focus:ring-green-500 group-hover:opacity-100"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => { setSelectedFriendId(null); handleSelectChat(chat.id); }}
                        className="min-w-0 flex-1 px-2 text-left"
                      >
                        <div className="flex items-center gap-2">
                          {chat.friendPictureUrl ? (
                            <img src={chat.friendPictureUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-full" />
                          ) : (
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-200">
                              <span className="text-xs text-gray-500">{chat.friendName.charAt(0)}</span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                {hasUnreadMessage && (
                                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" aria-label="新着メッセージ" />
                                )}
                                <p className={`truncate text-sm text-gray-900 ${hasUnreadMessage ? 'font-semibold' : 'font-medium'}`}>{chat.friendName}</p>
                              </div>
                              <span className={`flex-shrink-0 text-xs tabular-nums ${overdue ? 'font-medium text-red-700' : 'text-gray-400'}`}>
                                {overdue ? '期限超過' : formatListDatetime(chat.lastMessageAt)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                              <p
                                className={`min-w-0 flex-1 truncate text-xs ${hasUnreadMessage ? 'font-medium text-gray-800' : 'text-gray-500'}`}
                                title={preview}
                              >
                                {chat.lastMessageDirection === 'outgoing' && <span className="mr-1 text-gray-400">↪</span>}
                                {preview || <span className="italic text-gray-300">(まだメッセージなし)</span>}
                              </p>
                              <div className="flex flex-shrink-0 items-center gap-1.5 text-xs">
                                {showStatusText && (
                                  <span className={statusConfig[chat.status].className.split(' ').slice(1).join(' ')}>
                                  {statusConfig[chat.status].label}
                                  </span>
                                )}
                                {(chat.priority === 'urgent' || chat.priority === 'high') && (
                                  <span className={priorityConfig[chat.priority].className}>{priorityConfig[chat.priority].label}</span>
                                )}
                                {chat.operatorId && (
                                  <span
                                    className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gray-200 text-[9px] font-medium text-gray-600"
                                    title={`担当: ${assigneeName}`}
                                    aria-label={`担当: ${assigneeName}`}
                                  >
                                    {assigneeName.charAt(0)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    </div>
                  )
                })}
                {chats.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-gray-400">
                    条件に一致するチャットはありません
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Right Panel: Chat Detail */}
        <section className={`min-w-0 flex-1 flex-col overflow-hidden bg-white ${selectedChatId || selectedFriendId ? 'flex' : 'hidden lg:flex'}`}>
          {selectedFriendId && !selectedChatId ? (
            /* Direct message to friend without existing chat */
            <DirectMessagePanel
              friendId={selectedFriendId}
              friend={allFriends.find((f) => f.id === selectedFriendId) || null}
              onBack={() => setSelectedFriendId(null)}
              onSent={() => {
                const friendId = selectedFriendId
                setSelectedFriendId(null)
                if (friendId) setSelectedChatId(friendId)
                void Promise.all([loadChats(true), loadChatCounts(), loadOperatorMetrics()])
              }}
            />
          ) : !selectedChatId ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-400 text-sm">チャットを選択してください</p>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-400 text-sm">読み込み中...</p>
            </div>
          ) : chatDetail ? (
            <>
              {/* Chat Header */}
              <div className="flex min-h-14 flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <button
                      onClick={() => setSelectedChatId(null)}
                      className="-ml-2 flex h-11 w-9 flex-shrink-0 items-center justify-center text-gray-500 hover:text-gray-700 lg:hidden"
                      aria-label="戻る"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    {chatDetail.friendPictureUrl && (
                      <img src={chatDetail.friendPictureUrl} alt="" className="hidden h-8 w-8 flex-shrink-0 rounded-full sm:block" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {chatDetail.friendName}
                      </p>
                      <p className="truncate text-xs text-gray-400">{operatorNameById(chatDetail.operatorId)}</p>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <label className="flex-shrink-0">
                      <span className="sr-only">対応ステータス</span>
                      <select
                        value={chatDetail.status}
                        onChange={(event) => handleStatusUpdate(event.target.value as Chat['status'])}
                        className={`h-9 w-[6.5rem] rounded-md border border-gray-200 bg-white px-2 text-xs font-medium focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 ${statusConfig[chatDetail.status].className.split(' ').slice(1).join(' ')}`}
                      >
                        <option value="unread">未対応</option>
                        <option value="in_progress">対応中</option>
                        <option value="resolved">解決済</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowChatSettings((open) => !open)}
                      aria-expanded={showChatSettings}
                      className={`flex h-9 items-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
                        showChatSettings ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="sm:hidden">設定</span>
                      <span className="hidden sm:inline">対応設定</span>
                      <span className={`ml-1 hidden sm:inline ${showChatSettings ? 'text-white/75' : priorityConfig[priorityValue].className}`}>
                        {priorityConfig[priorityValue].label}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFriendSheet(true)}
                      className="flex h-9 items-center rounded-md border border-gray-200 px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    >
                      <span className="sm:hidden">詳細</span>
                      <span className="hidden sm:inline">友だち情報</span>
                    </button>
                  </div>
              </div>

              <div className="flex shrink-0 items-center border-b border-gray-200 bg-white px-3 py-1">
                <button
                  type="button"
                  onClick={() => setDeliveryTarget({ id: chatDetail.friendId, name: chatDetail.friendName })}
                  className="min-h-11 rounded-md px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600"
                >
                  配信の停止・再開
                </button>
              </div>

              <div className={`${showChatSettings ? 'flex' : 'hidden'} min-h-12 flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5`}>
                <label className="w-28 flex-shrink-0">
                  <span className="sr-only">優先度</span>
                  <select
                    value={priorityValue}
                    onChange={(event) => setPriorityValue(event.target.value as Chat['priority'])}
                    className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="urgent">緊急</option>
                    <option value="high">高</option>
                    <option value="normal">通常</option>
                    <option value="low">低</option>
                  </select>
                </label>
                <label className="min-w-48 flex-1">
                  <span className="sr-only">対応期限</span>
                  <input
                    type="datetime-local"
                    value={dueAtValue}
                    onChange={(event) => setDueAtValue(event.target.value)}
                    className={`h-9 w-full rounded-md border bg-white px-2 text-xs focus:outline-none focus:ring-1 ${
                      chatDetail && isOverdue(chatDetail)
                        ? 'border-red-400 text-red-700 focus:border-red-500 focus:ring-red-500'
                        : 'border-gray-300 text-gray-700 focus:border-green-500 focus:ring-green-500'
                    }`}
                  />
                </label>
                {dueAtValue && (
                  <button
                    type="button"
                    onClick={() => setDueAtValue('')}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-800"
                    aria-label="期限をクリア"
                    title="期限をクリア"
                  >
                    ×
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveSla}
                  disabled={savingSla}
                  className="h-9 flex-shrink-0 rounded-md bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {savingSla ? '保存中...' : '保存'}
                </button>
              </div>

              {/* Messages — LINE-style chat bubbles */}
              <div ref={messagesScrollRef} className="flex-1 space-y-2 overflow-y-auto bg-[#EEF2F1] p-4">
                {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-400">メッセージはまだありません。</p>
                  </div>
                ) : (
                  (chatDetail.messages ?? []).map((msg, idx) => {
                    const prevMsg = idx > 0 ? (chatDetail.messages ?? [])[idx - 1] : null
                    const showDateSep = !prevMsg || !sameYmd(prevMsg.createdAt, msg.createdAt)
                    const showUnreadSep = idx === unreadStartIndex
                    const isOutgoing = msg.direction === 'outgoing'

                    // メッセージ表示の分岐
                    let bubbleContent: React.ReactNode
                    if (msg.messageType === 'flex') {
                      bubbleContent = (
                        // Flex は内部で固定幅を持つので、狭幅ではバブル内を
                        // 横スクロールさせて画面全体のはみ出しを防ぐ。
                        <div className="max-w-full overflow-x-auto sm:max-w-[300px]">
                          <FlexPreviewComponent content={msg.content} maxWidth={280} />
                        </div>
                      )
                    } else if (msg.messageType === 'image') {
                      try {
                        const parsed = JSON.parse(msg.content)
                        bubbleContent = (
                          <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="" className="max-w-full rounded sm:max-w-[200px]" />
                        )
                      } catch {
                        bubbleContent = <span>🖼️ [画像]</span>
                      }
                    } else if (msg.messageType === 'sticker') {
                      bubbleContent = <StickerMessageImage content={msg.content} />
                    } else {
                      bubbleContent = <span>{msg.content}</span>
                    }

                    return (
                      <div key={msg.id}>
                        {showDateSep && (
                          <div className="flex justify-center my-3">
                            <span className="rounded bg-white/90 px-2.5 py-1 text-xs text-gray-500 shadow-sm">
                              {formatYmdSlash(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        {showUnreadSep && (
                          <div className="my-3 flex items-center gap-2" aria-label="ここから未読">
                            <span className="h-px flex-1 bg-red-300/70" />
                            <span className="rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-medium text-white">
                              ここから未読
                            </span>
                            <span className="h-px flex-1 bg-red-300/70" />
                          </div>
                        )}
                        <div
                          className={`flex items-end gap-2 ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                        >
                          {/* 相手のアイコン（incoming のみ） */}
                          {!isOutgoing && (
                            chatDetail.friendPictureUrl ? (
                              <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 mb-1" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0 mb-1" />
                            )
                          )}

                          {/*
                            バブル幅は固定 320px だと 375px 端末（アイコン+余白で
                            実質 295px しかない）ではみ出すため、狭幅では列全体を
                            割合で抑え、sm 以上で従来の 320px 上限に戻す。
                          */}
                          <div className={`flex min-w-0 max-w-[82%] flex-col sm:max-w-[70%] xl:max-w-[34rem] ${isOutgoing ? 'items-end' : 'items-start'}`}>
                            {/* メッセージバブル */}
                            <div
                              className={`max-w-full px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                                isOutgoing
                                  ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl bg-[#D9F2DF] text-gray-900'
                                  : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl border border-gray-200 bg-white text-gray-900'
                              }`}
                            >
                              {bubbleContent}
                            </div>
                            <span className="mt-0.5 px-1 text-xs text-gray-500">
                              {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* 返信・メモ・送信設定を1つのコンポーザーに集約する。 */}
              <footer className={`flex-shrink-0 border-t border-gray-200 ${composerMode === 'note' ? 'bg-amber-50' : 'bg-white'}`}>
                <div className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-gray-200 px-2">
                  <div className="flex h-8 flex-shrink-0 items-center rounded-md bg-gray-100 p-0.5" role="tablist" aria-label="入力種別">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={composerMode === 'reply'}
                      onClick={() => setComposerMode('reply')}
                      className={`h-7 rounded px-2.5 text-xs font-medium ${composerMode === 'reply' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      返信
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={composerMode === 'note'}
                      onClick={() => setComposerMode('note')}
                      className={`h-7 rounded px-2.5 text-xs font-medium ${composerMode === 'note' ? 'bg-white text-amber-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      メモ
                    </button>
                  </div>
                  {composerMode === 'reply' && (
                    <>
                      <MessageVariableButton
                        targetRef={messageContentRef}
                        value={messageContent}
                        onChange={setMessageContent}
                        insertValue={chatDetail.friendName || '{{name}}'}
                        label="名前を挿入"
                        disabled={!chatDetail.friendName}
                        compact
                      />
                      <CcPromptButton prompts={ccPrompts} variant="inline" />
                    </>
                  )}
                  <div className="ml-auto" />
                  {composerMode === 'note' ? (
                    <span className="flex-shrink-0 px-1 text-xs text-amber-700">相手には送信されません</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowSendOptions((open) => !open)}
                      aria-expanded={showSendOptions}
                      className={`inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium ${showSendOptions ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}
                      title="送信設定"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 .6 1.65 1.65 0 00-.4 1.08V21a2 2 0 11-4 0v-.08A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-.6-1 1.65 1.65 0 00-1.08-.4H3a2 2 0 110-4h-.08A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-.6 1.65 1.65 0 00.4-1.08V3a2 2 0 114 0v.08A1.65 1.65 0 0015.4 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.37.36.71.64.99.29.29.67.47 1.08.51H21a2 2 0 110 4h.08A1.65 1.65 0 0019.4 15z" />
                      </svg>
                      <span className="hidden sm:inline">送信設定</span>
                    </button>
                  )}
                </div>

                {composerMode === 'reply' && showSendOptions && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <label className="inline-flex cursor-pointer select-none items-center gap-2">
                      <input
                        type="checkbox"
                        checked={showLoadingIndicator}
                        onChange={(event) => setShowLoadingIndicator(event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      入力中ローディングを表示
                    </label>
                    <select
                      value={loadingSeconds}
                      onChange={(event) => setLoadingSeconds(Number.parseInt(event.target.value, 10))}
                      disabled={!showLoadingIndicator}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      {[5, 10, 15, 20, 30, 45, 60].map((sec) => (
                        <option key={sec} value={sec}>{sec}秒</option>
                      ))}
                    </select>
                    <span className="text-gray-500">送信キー:</span>
                    <label className="flex cursor-pointer items-center gap-1">
                      <input type="radio" checked={sendMode === 'enter'} onChange={() => setSendMode('enter')} className="accent-green-600" />
                      <span>Enter</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1">
                      <input type="radio" checked={sendMode === 'shift-enter'} onChange={() => setSendMode('shift-enter')} className="accent-green-600" />
                      <span>Shift+Enter</span>
                    </label>
                  </div>
                )}

                <div className="flex items-end gap-2 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                  {composerMode === 'reply' ? (
                    <textarea
                      ref={messageContentRef}
                      rows={2}
                      value={messageContent}
                      onChange={(event) => {
                        const value = event.target.value
                        setMessageContent(value)
                        if (selectedChatId && isMessageInputFocused && value.trim()) void triggerLoadingAnimation(selectedChatId)
                      }}
                      onCompositionStart={() => { isComposingRef.current = true }}
                      onCompositionEnd={() => { isComposingRef.current = false }}
                      onFocus={() => {
                        setIsMessageInputFocused(true)
                        if (selectedChatId) void triggerLoadingAnimation(selectedChatId)
                      }}
                      onBlur={() => setIsMessageInputFocused(false)}
                      onKeyDown={handleKeyDown}
                      placeholder="メッセージを入力..."
                      className="min-h-11 max-h-40 min-w-0 flex-1 resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  ) : (
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="この友だちに関するメモを入力..."
                      className="min-h-11 max-h-40 min-w-0 flex-1 resize-y rounded-md border border-amber-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                    />
                  )}
                  <button
                    type="button"
                    onClick={composerMode === 'reply' ? handleSendMessage : handleSaveNotes}
                    disabled={composerMode === 'reply' ? sending || !messageContent.trim() : savingNotes}
                    className={`h-11 min-w-[4.5rem] flex-shrink-0 rounded-md px-4 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${composerMode === 'reply' ? 'bg-[#06C755] hover:bg-[#05b84e]' : 'bg-amber-700 hover:bg-amber-800'}`}
                  >
                    {composerMode === 'reply'
                      ? (sending ? '送信中...' : '送信')
                      : (savingNotes ? '保存中...' : 'メモ保存')}
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </section>
      </div>

      <Sheet
        open={deliveryTarget !== null}
        onClose={() => setDeliveryTarget(null)}
        title="配信の停止・再開"
        description={deliveryTarget?.name}
        busy={deliveryConfirmationOpen}
      >
        {deliveryTarget && (
          <div className="-mx-5 -my-4">
            <FriendDeliveryControls
              key={deliveryTarget.id}
              friendId={deliveryTarget.id}
              onConfirmationChange={setDeliveryConfirmationOpen}
            />
          </div>
        )}
      </Sheet>

      {/* 友だち詳細は画面幅に関係なくシートで開き、会話領域を常時圧迫しない。 */}
      <FriendInfoSheet
        open={showFriendSheet}
        onClose={() => setShowFriendSheet(false)}
        friendId={selectedFriendId || selectedChatId}
        chatStatus={
          chatDetail && chatDetail.id === (selectedFriendId || selectedChatId)
            ? { status: chatDetail.status, notes: chatDetail.notes }
            : undefined
        }
        operatorName={
          chatDetail && chatDetail.id === (selectedFriendId || selectedChatId)
            ? operatorNameById(chatDetail.operatorId)
            : null
        }
      />
    </div>
  )
}
