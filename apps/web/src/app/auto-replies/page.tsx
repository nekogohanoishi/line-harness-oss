'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import EditDialog, { type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'
import { EmptyState } from '@/components/ui'
import { FriendBubble, MessageBubble, TalkArea, TalkNote, TalkStep, TalkTimeline } from '@/components/messages/talk-preview'
import { formatSeconds, replyTimingLabel } from '@/lib/delivery-labels'

interface EffectiveAccount {
  accountId: string
  accountName: string
  status: 'reply' | 'silent' | 'not_applicable'
  via: 'inline' | 'automation' | null
}

interface AutoReply {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  createdAt: string
  effectiveAccounts?: EffectiveAccount[]
}

interface TemplateLite {
  id: string
  name: string
  messageType: string
  messageContent: string
}

/** 返信の1通分。複数メッセージ以外のルールは、本文全体を1通として扱う */
interface ReplyMessage {
  messageType: string
  messageContent: string
  delaySeconds?: number
  deliveryTimeJst?: string
  sameDayCutoffTimeJst?: string
}

/** 適用アカウントバッジの凡例 */
const legend = (
  <>
    <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-100 text-green-700">返信あり</span> このアカウントで自動返信します。</p>
    <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">返信なし</span> 言葉には反応しますが、メッセージを送りません。</p>
    <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-50 text-gray-400">対象外</span> 別のLINEアカウント用のルールです。</p>
  </>
)

/** 返信の本文を1通ずつの配列にする。複数メッセージの中身を読めないときは空にする */
function replyMessages(type: string, content: string): ReplyMessage[] {
  if (type !== 'sequence') return [{ messageType: type, messageContent: content, delaySeconds: 0 }]
  try {
    const parsed = JSON.parse(content) as { messages?: unknown }
    if (!Array.isArray(parsed.messages)) return []
    return parsed.messages.filter((item): item is ReplyMessage => item !== null && typeof item === 'object'
      && typeof item.messageType === 'string' && typeof item.messageContent === 'string')
  } catch {
    return []
  }
}

/** 画面に出すときだけ、名前の差し込みを分かりやすい言葉にする (保存してある本文は変えない) */
const readableContent = (content: string) => content.replaceAll('{{name}}', '［友だちの表示名］')

interface TimingGroup {
  /** 「すぐ」「5分後に」「当日または翌日の20:00に」のような言い方 */
  phrase: string
  /** 当日に届く受け取りの締切時刻 (指定時刻の返信だけ) */
  cutoff?: string
  count: number
}

/** 返信のタイミングを、同じ言い方ごとに通数をまとめて並べる (例: すぐ1通、当日または翌日の20:00に1通) */
function timingGroups(messages: ReplyMessage[]): TimingGroup[] {
  const groups = new Map<string, TimingGroup>()
  for (const item of messages) {
    let group: Omit<TimingGroup, 'count'>
    if (item.deliveryTimeJst) {
      group = item.sameDayCutoffTimeJst
        ? { phrase: `当日または翌日の${item.deliveryTimeJst}に`, cutoff: item.sameDayCutoffTimeJst }
        : { phrase: `受け取った日の${item.deliveryTimeJst}に` }
    } else {
      group = item.delaySeconds && item.delaySeconds > 0
        ? { phrase: `${formatSeconds(item.delaySeconds)}後に` }
        : { phrase: 'すぐ' }
    }
    const key = `${group.phrase}/${group.cutoff ?? ''}`
    const current = groups.get(key)
    if (current) current.count += 1
    else groups.set(key, { ...group, count: 1 })
  }
  return Array.from(groups.values())
}

/** 一覧の1行に出す「いつ、何通返るか」。詳しい文面は行を開いたときの1通ごとの表示で見せる */
function TimingSummary({ messages }: { messages: ReplyMessage[] }) {
  return (
    <>
      {timingGroups(messages).map((group, index) => (
        <span key={`${group.phrase}/${group.cutoff ?? ''}`}>
          {index > 0 && '、'}
          {group.phrase}{group.count}通
          {group.cutoff && <span className="inline-block text-gray-500">（{group.cutoff}までの受信は当日）</span>}
        </span>
      ))}
    </>
  )
}

/** 開くと返信の中身 (トーク画面のプレビュー) が出る1行。編集・削除は開かなくても押せるよう、行の外に置く */
function RuleRow({
  title,
  status,
  condition,
  timing,
  accounts,
  actions,
  children,
}: {
  title: ReactNode
  status: ReactNode
  condition: ReactNode
  timing: ReactNode
  accounts: ReactNode
  actions: ReactNode
  children: ReactNode
}) {
  // 画像やボタン付きメッセージを含む本文は、開かれてから描画する。閉じても作り直さない
  const [opened, setOpened] = useState(false)
  return (
    <li className="border-b border-gray-300 sm:flex sm:items-start sm:gap-3">
      <details
        className="group min-w-0 sm:flex-1"
        onToggle={(event) => { if (event.currentTarget.open) setOpened(true) }}
      >
        <summary className="flex cursor-pointer list-none items-start gap-3 rounded-md px-1 py-3.5 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
          <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="mt-1 h-4 w-4 shrink-0 text-gray-500 group-open:rotate-90 motion-safe:transition-transform">
            <path fillRule="evenodd" d="M7.2 4.2a1 1 0 011.4 0l5.1 5.1a1 1 0 010 1.4l-5.1 5.1a1 1 0 01-1.4-1.4L11.6 10 7.2 5.6a1 1 0 010-1.4z" clipRule="evenodd" />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2">
              <span className="block min-w-0 text-[15px] font-semibold leading-6 text-gray-900 break-words">{title}</span>
              {status}
            </span>
            <span className="mt-0.5 block text-sm leading-6 text-gray-600">{condition}</span>
            <span className="block text-sm leading-6 text-gray-800 break-words">{timing}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span>適用アカウント</span>
              {accounts}
            </span>
          </span>
        </summary>
        <div className="pb-5 sm:pl-8">{opened && children}</div>
      </details>
      <div className="flex gap-2 px-1 pb-3.5 sm:shrink-0 sm:px-0 sm:pb-0 sm:pt-3.5 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>
    </li>
  )
}

/** 行を開いたときの中身。友だちが送る言葉 (右の緑) と、返信 (左の白) を1通ずつ見せる */
function RuleTalk({
  keyword,
  viaAutomation,
  silent,
  messages,
  note,
  usesTemplate,
}: {
  keyword: string
  viaAutomation: boolean
  silent: boolean
  messages: ReplyMessage[]
  note: string
  usesTemplate: boolean
}) {
  const linkClass = 'inline-flex min-h-[44px] items-center text-sm font-medium text-blue-700 hover:underline'
  return (
    <>
      <TalkArea>
        <div className="space-y-5">
          <FriendBubble>{keyword}</FriendBubble>
          {viaAutomation && <TalkNote>このルールは返信文を持たず、自動化ルールから送信します</TalkNote>}
          {silent && <TalkNote>このルールは返信しません</TalkNote>}
          {!viaAutomation && !silent && messages.length === 0 && <TalkNote>本文を確認できません。「編集」から内容を確認してください</TalkNote>}
          {messages.length > 0 && (
            <TalkTimeline>
              {messages.map((item, index) => (
                <TalkStep
                  key={index}
                  number={index + 1}
                  timing={replyTimingLabel(item)}
                  note={index === 0 && note ? note : undefined}
                  isLast={index === messages.length - 1}
                >
                  <MessageBubble type={item.messageType} content={readableContent(item.messageContent)} />
                </TalkStep>
              ))}
            </TalkTimeline>
          )}
        </div>
      </TalkArea>
      {viaAutomation && <Link href="/automations" className={`mt-1 ${linkClass}`}>返信を送る自動化ルールを見る</Link>}
      {usesTemplate && <Link href="/templates" className={`mt-1 ${linkClass}`}>共有テンプレートの画面で本文を編集する</Link>}
    </>
  )
}

export default function AutoRepliesPage() {
  const { selectedAccountId, accounts } = useAccount()
  const [items, setItems] = useState<AutoReply[]>([])
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AutoReplyDraft | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [arRes, tplRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(),
      ])
      if (arRes.success) setItems(arRes.data)
      if (tplRes.success) setTemplates(tplRes.data.map((t) => ({
        id: t.id,
        name: t.name,
        messageType: t.messageType,
        messageContent: t.messageContent,
      })))
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const templateById = new Map(templates.map((t) => [t.id, t]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const renderEffectiveCell = (r: AutoReply) => {
    if (!r.effectiveAccounts || r.effectiveAccounts.length === 0) {
      // 古い shape の fallback (effectiveAccounts 計算前)
      if (!r.lineAccountId) return <span className="text-gray-500">全アカウント</span>
      const acc = accountById.get(r.lineAccountId)
      return <span className="text-gray-700">{acc?.displayName ?? acc?.name ?? '名前を確認できないアカウント'}</span>
    }
    return (
      <span className="flex flex-wrap gap-1">
        {r.effectiveAccounts.map((ea) => {
          const acc = accountById.get(ea.accountId)
          const label = acc?.displayName ?? acc?.name ?? ea.accountName
          if (ea.status === 'not_applicable') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-50 text-gray-400 line-through"
                title={`${label}: このルールの対象外です`}
              >
                {label}
              </span>
            )
          }
          if (ea.status === 'reply') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium"
                title={`${label}: 自動返信します`}
              >
                ✓ {label}
              </span>
            )
          }
          // silent
          return (
            <span
              key={ea.accountId}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700"
              title={`${label}: 言葉には反応しますが返信しません`}
            >
              ⚠ {label}
            </span>
          )
        })}
      </span>
    )
  }

  /** テンプレートを参照するルールは、今のテンプレート本文を返信として見せる (読み込めないときは保存済みの本文) */
  const resolveReply = (r: AutoReply) => {
    if (!r.templateId) return { type: r.responseType, content: r.responseContent, note: '' }
    const template = templateById.get(r.templateId)
    return template
      ? { type: template.messageType, content: template.messageContent, note: `共有テンプレート「${template.name}」の今の本文です` }
      : { type: r.responseType, content: r.responseContent, note: '共有テンプレートの今の本文を確認できないため、保存済みの本文を表示しています' }
  }

  /** 選択中のアカウントで、返信文を持たず自動化ルールから返信するルールか */
  const isViaAutomation = (r: AutoReply) => Boolean(r.effectiveAccounts?.some(
    (ea) => ea.via === 'automation' && (!selectedAccountId || ea.accountId === selectedAccountId),
  ))

  const handleDelete = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    try {
      await api.autoReplies.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const renderRule = (r: AutoReply) => {
    const resolved = resolveReply(r)
    const viaAutomation = isViaAutomation(r)
    const silent = !viaAutomation && resolved.type === 'silent'
    const messages = viaAutomation || silent ? [] : replyMessages(resolved.type, resolved.content)
    const templateName = r.templateId ? templateById.get(r.templateId)?.name : undefined

    let timing: ReactNode
    if (viaAutomation) timing = '返信は自動化ルールから送信します'
    else if (silent) timing = '返信はしません'
    else if (messages.length === 0) timing = '返信の本文を確認できません'
    else {
      timing = (
        <>
          <TimingSummary messages={messages} />
          {r.templateId && (
            <span className={`inline-block ${templateName ? 'text-gray-500' : 'text-amber-700'}`}>
              （{templateName ? `共有テンプレート「${templateName}」` : '参照先の共有テンプレートが見つかりません'}）
            </span>
          )}
        </>
      )
    }

    return (
      <RuleRow
        key={r.id}
        title={`「${r.keyword}」`}
        status={
          <span className={`mt-0.5 shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${r.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
            {r.isActive ? '有効' : '無効'}
          </span>
        }
        condition={r.matchType === 'exact' ? 'この言葉とまったく同じとき' : 'この言葉を含むとき'}
        timing={timing}
        accounts={renderEffectiveCell(r)}
        actions={
          <>
            <button
              onClick={() => setEditing({
                id: r.id,
                keyword: r.keyword,
                matchType: r.matchType,
                responseType: r.responseType,
                responseContent: r.responseContent,
                templateId: r.templateId,
                lineAccountId: r.lineAccountId,
                isActive: r.isActive,
              })}
              aria-label={`「${r.keyword}」を編集`}
              className="px-2.5 py-1 min-h-[44px] sm:min-h-0 text-sm sm:text-xs font-medium text-blue-600 bg-blue-50 sm:bg-transparent hover:bg-blue-50 rounded-md"
            >
              編集
            </button>
            <button
              onClick={() => handleDelete(r.id)}
              aria-label={`「${r.keyword}」を削除`}
              className="px-2.5 py-1 min-h-[44px] sm:min-h-0 text-sm sm:text-xs font-medium text-red-500 bg-red-50 sm:bg-transparent hover:bg-red-50 rounded-md"
            >
              削除
            </button>
          </>
        }
      >
        <RuleTalk
          keyword={r.keyword}
          viaAutomation={viaAutomation}
          silent={silent}
          messages={messages}
          note={resolved.note}
          usesTemplate={Boolean(r.templateId)}
        />
      </RuleRow>
    )
  }

  return (
    <div>
      <Header
        title="自動返信ルール"
        action={
          <button
            onClick={() => setEditing({
              keyword: '',
              matchType: 'exact',
              responseType: 'text',
              responseContent: '',
              templateId: null,
              lineAccountId: selectedAccountId,
              isActive: true,
            })}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規ルール
          </button>
        }
      />

      <div className="mb-4 flex flex-col gap-1 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          友だちから受信した言葉に応じて、送る内容とタイミングを設定します。行を開くと、友だちのトーク画面での見え方を確認できます。
        </p>
        <p className="text-xs font-medium text-gray-500">有効 {items.filter((item) => item.isActive).length}件</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <details className="mb-4 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-700">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center px-3 font-medium">
          適用アカウントの見かた
        </summary>
        <div className="space-y-1 px-3 pb-3">{legend}</div>
      </details>

      {loading ? (
        <p role="status" className="py-12 text-center text-sm text-gray-500">読み込み中...</p>
      ) : items.length === 0 ? (
        <EmptyState size="sm" title="自動返信ルールがありません" />
      ) : (
        <ul className="border-t border-gray-300">{items.map(renderRule)}</ul>
      )}


      {editing && (
        <EditDialog
          draft={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
