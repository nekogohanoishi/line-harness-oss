'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { parseStickerMessageContent, stickerFallback } from '@line-crm/shared'
import { api, fetchApi, type ChatCounts, type ChatOperatorMetric } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import FlexPreviewComponent from '@/components/flex-preview'
import FriendInfoSidebar from '@/components/chats/friend-info-sidebar'
import MessageVariableButton from '@/components/message-variable-button'

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
    if (msg.messageType === 'text') return msg.content
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
        <button onClick={onBack} className="lg:hidden text-gray-400 hover:text-gray-600">
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
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
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
      <div className="px-4 py-3 border-t border-gray-200">
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
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
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
      // Metrics can recover on the next polling cycle without blocking chat work.
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

  useEffect(() => {
    void Promise.all([loadChats(), loadChatCounts(), loadOperatorMetrics()])
    const id = window.setInterval(() => {
      void Promise.all([loadChats(true), loadChatCounts(), loadOperatorMetrics()])
    }, 30_000)
    return () => window.clearInterval(id)
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
      // The next polling cycle retries the server-derived state.
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
      const id = window.setInterval(() => {
        void loadChatDetail(selectedChatId, true)
        void markChatRead(selectedChatId)
      }, 30_000)
      return () => window.clearInterval(id)
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
    setSelectedChatId(chatId)
    setMessageContent('')
  }

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
    <div>
      <Header title="オペレーターチャット" />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-4 h-[calc(100vh-120px)] lg:h-[calc(100vh-180px)]">
        {/* Left Panel: Chat List */}
        <div className={`w-full lg:w-[26rem] lg:flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
          <div className="border-b border-gray-200 bg-white">
            <div className="flex gap-1 overflow-x-auto px-2 pt-2">
              {inboxFilters.map((filter) => {
                const active = inboxFilter === filter.key
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setInboxFilter(filter.key)}
                    className={`flex h-8 flex-shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <span>{filter.label}</span>
                    <span className={`min-w-5 text-center tabular-nums ${active ? 'text-white/80' : 'text-gray-400'}`}>
                      {chatCounts[filter.countKey]}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 px-2 py-2">
              <label className="min-w-0">
                <span className="sr-only">担当者で絞り込む</span>
                <select
                  value={operatorFilter}
                  onChange={(event) => setOperatorFilter(event.target.value)}
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">優先度：全て</option>
                  <option value="urgent">緊急</option>
                  <option value="high">高</option>
                  <option value="normal">通常</option>
                  <option value="low">低</option>
                </select>
              </label>
            </div>

            <div className="flex min-h-10 items-center justify-between border-t border-gray-100 px-3 py-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={chats.length === 0}
                  className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 disabled:opacity-40"
                />
                表示中を全選択
              </label>
              <div className="flex items-center gap-3">
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
                {(inboxFilter !== 'all' || operatorFilter || tagFilter || priorityFilter) && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800"
                  >
                    絞り込み解除
                  </button>
                )}
              </div>
            </div>

            {showOperatorMetrics && (
              <div className="max-h-52 overflow-auto border-t border-gray-200">
                <table className="w-full table-fixed text-left text-[11px]">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="w-[32%] px-3 py-2 font-medium">担当者</th>
                      <th className="px-1 py-2 text-right font-medium">対応中</th>
                      <th className="px-1 py-2 text-right font-medium">超過</th>
                      <th className="px-1 py-2 text-right font-medium">30日解決</th>
                      <th className="px-3 py-2 text-right font-medium">初回応答</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
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

            {showOperatorForm && (
              <form onSubmit={handleCreateOperator} className="border-t border-gray-200 bg-gray-50 px-3 py-2">
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="mb-1 block text-[11px] text-gray-500">担当者名</span>
                    <input
                      type="text"
                      value={newOperatorName}
                      onChange={(event) => setNewOperatorName(event.target.value)}
                      required
                      className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[11px] text-gray-500">メールアドレス</span>
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBulkRead}
                    disabled={bulkAction !== null}
                    className="h-9 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  >
                    {bulkAction === 'read' ? '確認中...' : '確認済みにする'}
                  </button>
                  <select
                    value={bulkOperatorId}
                    onChange={(event) => setBulkOperatorId(event.target.value)}
                    className="h-9 min-w-32 flex-1 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                    className="h-9 rounded-md bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
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
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="px-4 py-3 border-b border-gray-100 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-gray-200 rounded w-32" />
                        <div className="h-2 bg-gray-100 rounded w-20" />
                      </div>
                      <div className="h-5 bg-gray-100 rounded-full w-12" />
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
                  const previewRaw = chat.lastMessageContent ?? ''
                  const preview = (() => {
                    if (chat.lastMessageType === 'image') return '📷 画像'
                    if (chat.lastMessageType === 'flex') return '📋 Flexメッセージ'
                    if (chat.lastMessageType === 'sticker') return '🎨 スタンプ'
                    if (chat.lastMessageType === 'video') return '🎥 動画'
                    if (chat.lastMessageType === 'audio') return '🎤 音声'
                    if (chat.lastMessageType === 'file') return '📎 ファイル'
                    if (chat.lastMessageType === 'location') return '📍 位置情報'
                    return previewRaw.replace(/\n+/g, ' ').slice(0, 60)
                  })()
                  return (
                    <div
                      key={chat.id}
                      className={`flex border-b border-gray-100 transition-colors ${
                        isSelected && !selectedFriendId
                          ? 'bg-green-50'
                          : selectedChatIds.has(chat.id)
                            ? 'bg-gray-50'
                            : 'hover:bg-gray-50'
                      }`}
                    >
                      <label className="flex flex-shrink-0 cursor-pointer items-start px-3 pt-4">
                        <span className="sr-only">{chat.friendName}を選択</span>
                        <input
                          type="checkbox"
                          checked={selectedChatIds.has(chat.id)}
                          onChange={() => toggleChatSelection(chat.id)}
                          className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => { setSelectedFriendId(null); handleSelectChat(chat.id); }}
                        className="min-w-0 flex-1 py-3 pr-3 text-left"
                      >
                        <div className="flex items-start gap-3">
                          {chat.friendPictureUrl ? (
                            <img src={chat.friendPictureUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded-full" />
                          ) : (
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-200">
                              <span className="text-sm text-gray-500">{chat.friendName.charAt(0)}</span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                {hasUnreadMessage && (
                                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" aria-label="新着メッセージ" />
                                )}
                                <p className="truncate text-sm font-medium text-gray-900">{chat.friendName}</p>
                              </div>
                              <span className="flex-shrink-0 text-[10px] text-gray-400">{formatDatetime(chat.lastMessageAt)}</span>
                            </div>
                            <p
                              className={`mt-0.5 truncate text-xs ${
                                hasUnreadMessage ? 'font-medium text-gray-900' : 'text-gray-400'
                              }`}
                              title={preview}
                            >
                              {chat.lastMessageDirection === 'outgoing' && (
                                <span className="mr-1 text-gray-400">↪</span>
                              )}
                              {preview || <span className="italic text-gray-300">(まだメッセージなし)</span>}
                            </p>
                            <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px]">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={statusConfig[chat.status].className.split(' ').slice(1).join(' ')}>
                                  {statusConfig[chat.status].label}
                                </span>
                                <span className={priorityConfig[chat.priority || 'normal'].className}>
                                  優先度：{priorityConfig[chat.priority || 'normal'].label}
                                </span>
                              </div>
                              <span className="truncate text-gray-400">{operatorNameById(chat.operatorId)}</span>
                            </div>
                            {chat.status !== 'resolved' && chat.dueAt && (
                              <p className={`mt-0.5 truncate text-[10px] ${overdue ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
                                {overdue ? '期限超過' : '期限'}：{formatDatetime(chat.dueAt)}
                              </p>
                            )}
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
        </div>

        {/* Right Panel: Chat Detail */}
        <div className={`flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId || selectedFriendId ? 'flex' : 'hidden lg:flex'}`}>
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
              <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setSelectedChatId(null)}
                    className="lg:hidden flex-shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-700"
                    aria-label="戻る"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {chatDetail.friendPictureUrl && (
                    <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {chatDetail.friendName}
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${statusConfig[chatDetail.status].className}`}
                    >
                      {statusConfig[chatDetail.status].label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {chatDetail.status !== 'unread' && (
                    <button
                      onClick={() => handleStatusUpdate('unread')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                    >
                      未対応に戻す
                    </button>
                  )}
                  {chatDetail.status !== 'in_progress' && (
                    <button
                      onClick={() => handleStatusUpdate('in_progress')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 rounded-md transition-colors"
                    >
                      対応中にする
                    </button>
                  )}
                  {chatDetail.status !== 'resolved' && (
                    <button
                      onClick={() => handleStatusUpdate('resolved')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                    >
                      解決済にする
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2">
                <label className="min-w-28">
                  <span className="mb-1 block text-[11px] text-gray-500">優先度</span>
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
                <label className="min-w-52 flex-1">
                  <span className="mb-1 block text-[11px] text-gray-500">対応期限</span>
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
                    className="h-9 px-2 text-xs font-medium text-gray-500 hover:text-gray-800"
                  >
                    期限をクリア
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveSla}
                  disabled={savingSla}
                  className="h-9 rounded-md bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {savingSla ? '保存中...' : '保存'}
                </button>
              </div>

              {/* Messages — LINE-style chat bubbles */}
              <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-4 space-y-2" style={{ backgroundColor: '#7494C0' }}>
                {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
                  <div className="text-center py-8">
                    <p className="text-white/60 text-sm">メッセージはまだありません。</p>
                  </div>
                ) : (
                  (chatDetail.messages ?? []).map((msg, idx) => {
                    const prevMsg = idx > 0 ? (chatDetail.messages ?? [])[idx - 1] : null
                    const showDateSep = !prevMsg || !sameYmd(prevMsg.createdAt, msg.createdAt)
                    const isOutgoing = msg.direction === 'outgoing'

                    // メッセージ表示の分岐
                    let bubbleContent: React.ReactNode
                    if (msg.messageType === 'flex') {
                      bubbleContent = (
                        <div className="max-w-[300px]">
                          <FlexPreviewComponent content={msg.content} maxWidth={280} />
                        </div>
                      )
                    } else if (msg.messageType === 'image') {
                      try {
                        const parsed = JSON.parse(msg.content)
                        bubbleContent = (
                          <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="" className="max-w-[200px] rounded" />
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
                            <span className="text-[11px] text-white/85 bg-black/20 px-2.5 py-0.5 rounded-full">
                              {formatYmdSlash(msg.createdAt)}
                            </span>
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

                          <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                            {/* メッセージバブル */}
                            <div
                              className={`max-w-[320px] px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                                isOutgoing
                                  ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-white'
                                  : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-white text-gray-900'
                              }`}
                              style={isOutgoing ? { backgroundColor: '#06C755' } : undefined}
                            >
                              {bubbleContent}
                            </div>
                            {/* 時刻 */}
                            <span className="text-xs text-white/50 mt-0.5 px-1">
                              {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Notes */}
              <div className="px-4 py-2 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="メモを入力..."
                    className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                  <button
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
                  >
                    {savingNotes ? '保存中...' : 'メモ保存'}
                  </button>
                </div>
              </div>

              {/* Send Message Form */}
              <div className="px-4 py-3 border-t border-gray-200">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-600">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showLoadingIndicator}
                      onChange={(e) => setShowLoadingIndicator(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    入力中ローディングを表示
                  </label>
                  <select
                    value={loadingSeconds}
                    onChange={(e) => setLoadingSeconds(Number.parseInt(e.target.value, 10))}
                    disabled={!showLoadingIndicator}
                    className="border border-gray-300 rounded-md px-2 py-1 bg-white disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {[5, 10, 15, 20, 30, 45, 60].map((sec) => (
                      <option key={sec} value={sec}>{sec}秒</option>
                    ))}
                  </select>
                  <span className="text-gray-500">送信キー:</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={sendMode === 'enter'}
                      onChange={() => setSendMode('enter')}
                      className="accent-green-600"
                    />
                    <span>Enter</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={sendMode === 'shift-enter'}
                      onChange={() => setSendMode('shift-enter')}
                      className="accent-green-600"
                    />
                    <span>Shift+Enter</span>
                  </label>
                  <MessageVariableButton
                    targetRef={messageContentRef}
                    value={messageContent}
                    onChange={setMessageContent}
                    insertValue={chatDetail.friendName || '{{name}}'}
                    disabled={!chatDetail.friendName}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={messageContentRef}
                    rows={2}
                    value={messageContent}
                    onChange={(e) => {
                      const value = e.target.value
                      setMessageContent(value)
                      if (selectedChatId && isMessageInputFocused && value.trim()) {
                        void triggerLoadingAnimation(selectedChatId)
                      }
                    }}
                    onCompositionStart={() => { isComposingRef.current = true }}
                    onCompositionEnd={() => { isComposingRef.current = false }}
                    onFocus={() => {
                      setIsMessageInputFocused(true)
                      if (selectedChatId) {
                        void triggerLoadingAnimation(selectedChatId)
                      }
                    }}
                    onBlur={() => setIsMessageInputFocused(false)}
                    onKeyDown={handleKeyDown}
                    placeholder="メッセージを入力..."
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || !messageContent.trim()}
                    className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {sending ? '送信中...' : '送信'}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Right-most Panel: 友だち詳細サイドバー — chat detail を開いている時のみ表示 */}
        {/*
          friendId は **現在の selection** を優先する。chatDetail の load 中は前の chat
          のデータが残ったままなので、それを参照するとサイドバーだけ前の友だちを
          表示し続けて pane 間の不整合になる。selection ID 自体が friend_id なので
          直接渡せる (chat list SQL が `id: f.id` で friend_id を返す)。
        */}
        {(selectedChatId || selectedFriendId) && (
          <div className="hidden xl:flex">
            <FriendInfoSidebar
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
        )}
      </div>
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
