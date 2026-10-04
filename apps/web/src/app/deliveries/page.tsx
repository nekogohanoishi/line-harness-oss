'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { Automation, Scenario, ScenarioStep, Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type RegistrationSurveySettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { PageHeader } from '@/components/ui'
import ManualRefreshButton from '@/components/ui/manual-refresh-button'
import { FriendBubble, MessageBubble, TalkArea, TalkNote, TalkStep, TalkTimeline } from '@/components/messages/talk-preview'
import { replyTimingLabel, scenarioStartText, stepConditionText, stepTimingLabel } from '@/lib/delivery-labels'

type AutoReplyItem = {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  effectiveAccounts?: Array<{ accountId: string; status: 'reply' | 'silent' | 'not_applicable'; via: 'inline' | 'automation' | null }>
}

type TemplateItem = { id: string; name: string; messageType: string; messageContent: string }
type ScenarioItem = Scenario & { stepCount?: number }

function sequenceMessages(type: string, content: string) {
  if (type !== 'sequence') return [{ messageType: type, messageContent: content, delaySeconds: 0 }]
  try {
    const parsed = JSON.parse(content) as { messages?: unknown }
    if (!Array.isArray(parsed.messages)) return []
    return parsed.messages.filter((item): item is {
      messageType: string
      messageContent: string
      delaySeconds?: number
      deliveryTimeJst?: string
      sameDayCutoffTimeJst?: string
    } => item !== null && typeof item === 'object'
      && typeof item.messageType === 'string' && typeof item.messageContent === 'string')
  } catch {
    return []
  }
}

/** 区切りの太線・見出し・件数・編集リンク・ひとこと説明をまとめたセクション */
function DeliverySection({
  id,
  title,
  count,
  loading,
  description,
  editHref,
  editLabel,
  children,
}: {
  id: string
  title: string
  count?: number
  loading: boolean
  description: string
  editHref: string
  editLabel: string
  children: ReactNode
}) {
  return (
    <section className="mt-10 border-t-2 border-gray-900 pt-3 first-of-type:mt-6" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-lg font-bold text-gray-900">
          {title}
          {count !== undefined && <span className="ml-2 text-sm font-medium text-gray-500">{loading ? '確認中' : `${count}件`}</span>}
        </h2>
        <Link href={editHref} className="text-sm font-medium text-blue-700 hover:underline">{editLabel}</Link>
      </div>
      <p className="mt-1 text-sm leading-6 text-gray-600">{description}</p>
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** 開くと中身 (トーク画面のプレビュー) が出る1行。区切り線は濃いめにする */
function DeliveryRow({
  title,
  subtitle,
  onOpen,
  children,
}: {
  title: ReactNode
  subtitle: ReactNode
  onOpen?: () => void
  children: ReactNode
}) {
  return (
    <details
      className="group border-b border-gray-300"
      onToggle={(event) => { if (event.currentTarget.open) onOpen?.() }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-md px-1 py-3.5 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="mt-1 h-4 w-4 shrink-0 text-gray-500 group-open:rotate-90 motion-safe:transition-transform">
          <path fillRule="evenodd" d="M7.2 4.2a1 1 0 011.4 0l5.1 5.1a1 1 0 010 1.4l-5.1 5.1a1 1 0 01-1.4-1.4L11.6 10 7.2 5.6a1 1 0 010-1.4z" clipRule="evenodd" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-6 text-gray-900 break-words">{title}</span>
          <span className="mt-0.5 block text-sm leading-6 text-gray-600">{subtitle}</span>
        </span>
      </summary>
      <div className="pb-5 sm:pl-8">{children}</div>
    </details>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-gray-500">{children}</p>
}

export default function DeliveriesPage() {
  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  const [scenarios, setScenarios] = useState<ScenarioItem[]>([])
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [autoReplies, setAutoReplies] = useState<AutoReplyItem[]>([])
  const [automations, setAutomations] = useState<Automation[]>([])
  const [survey, setSurvey] = useState<RegistrationSurveySettings | null>(null)
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [stepsByScenario, setStepsByScenario] = useState<Record<string, ScenarioStep[]>>({})
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})
  const [loadingStepId, setLoadingStepId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    const requestId = ++requestIdRef.current
    setLoading(true)
    setErrors([])
    setScenarios([])
    setBroadcasts([])
    setAutoReplies([])
    setAutomations([])
    setSurvey(null)
    setTemplates(null)
    setTags([])
    setLoadedAt(null)
    setStepsByScenario({})
    setStepErrors({})
    const [scenarioResult, broadcastResult, replyResult, automationResult, surveyResult, templateResult, tagResult] = await Promise.allSettled([
      api.scenarios.list({ accountId: selectedAccountId }),
      api.broadcasts.list({ accountId: selectedAccountId }),
      api.autoReplies.list({ accountId: selectedAccountId }),
      api.automations.list({ accountId: selectedAccountId }),
      api.registrationSurvey.get(selectedAccountId),
      api.templates.list(),
      api.tags.list(),
    ])
    if (requestId !== requestIdRef.current) return
    const failures: string[] = []
    if (scenarioResult.status === 'fulfilled' && scenarioResult.value.success) setScenarios(scenarioResult.value.data)
    else { setScenarios([]); failures.push('シナリオ') }
    if (broadcastResult.status === 'fulfilled' && broadcastResult.value.success) setBroadcasts(broadcastResult.value.data)
    else { setBroadcasts([]); failures.push('一斉配信') }
    if (replyResult.status === 'fulfilled' && replyResult.value.success) setAutoReplies(replyResult.value.data)
    else { setAutoReplies([]); failures.push('自動返信') }
    if (automationResult.status === 'fulfilled' && automationResult.value.success) setAutomations(automationResult.value.data)
    else { setAutomations([]); failures.push('自動化') }
    if (surveyResult.status === 'fulfilled' && surveyResult.value.success) setSurvey(surveyResult.value.data)
    else setSurvey(null)
    if (templateResult.status === 'fulfilled' && templateResult.value.success) setTemplates(templateResult.value.data)
    else { setTemplates(null); failures.push('共有テンプレート') }
    if (tagResult.status === 'fulfilled' && tagResult.value.success) setTags(tagResult.value.data)
    else { setTags([]); failures.push('タグ名') }
    setErrors(failures)
    setLoadedAt(new Date())
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
    return () => { requestIdRef.current += 1 }
  }, [accountLoading, load])

  const templateById = useMemo(() => new Map(templates?.map((template) => [template.id, template]) ?? []), [templates])
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])
  const tagName = useCallback((id: string) => tagById.get(id), [tagById])
  const activeScenarios = scenarios.filter((scenario) => scenario.isActive)
  const scheduledBroadcasts = broadcasts.filter((broadcast) => broadcast.status === 'scheduled' || broadcast.status === 'sending')
  const activeReplies = autoReplies.filter((reply) => reply.isActive && reply.effectiveAccounts?.some(
    (account) => account.accountId === selectedAccountId && account.status === 'reply',
  ))
  const activeAutomations = automations.filter((automation) => automation.isActive && automation.actions.some(
    (action) => action.type === 'send_message' || action.type === 'start_scenario',
  ))

  const showScenario = async (scenarioId: string) => {
    if (stepsByScenario[scenarioId] || loadingStepId === scenarioId) return
    const requestId = requestIdRef.current
    setLoadingStepId(scenarioId)
    try {
      const result = await api.scenarios.get(scenarioId)
      if (requestId !== requestIdRef.current) return
      if (!result.success) throw new Error(result.error)
      setStepsByScenario((current) => ({ ...current, [scenarioId]: result.data.steps }))
      setStepErrors((current) => ({ ...current, [scenarioId]: '' }))
    } catch {
      if (requestId === requestIdRef.current) setStepErrors((current) => ({ ...current, [scenarioId]: 'ステップを読み込めませんでした。閉じてからもう一度開いてください。' }))
    } finally {
      if (requestId === requestIdRef.current) setLoadingStepId(null)
    }
  }

  const resolved = (type: string, content: string, templateId: string | null | undefined) => {
    if (!templateId) return { type, content, note: '' }
    if (!templates) return { type: '', content: '', note: '共有テンプレートを読み込めないため、今の本文は確認できません' }
    const template = templateById.get(templateId)
    return template
      ? { type: template.messageType, content: template.messageContent, note: `共有テンプレート「${template.name}」の今の本文です` }
      : { type, content, note: '参照先のテンプレートがないため、保存済みの本文を表示しています' }
  }

  const formatTime = (value: string | null) => value
    ? new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '日時未設定'

  const broadcastTarget = (broadcast: ApiBroadcast) => broadcast.targetType === 'all'
    ? '友だち全員'
    : broadcast.targetType === 'tag'
      ? `タグ「${broadcast.targetTagId ? tagById.get(broadcast.targetTagId) ?? 'タグ名未確認' : '未指定'}」の人`
      : '複数アカウントの友だち'

  return (
    <div className="pb-10">
      <PageHeader
        title="現在有効な配信"
        description={`${selectedAccount?.displayName || selectedAccount?.name || '選択中のアカウント'}で、今の設定のまま届くメッセージ`}
        actions={<ManualRefreshButton onClick={load} loading={loading} />}
      />
      <p className="mb-2 border-l-2 border-amber-400 pl-3 text-xs leading-5 text-gray-600">
        Harnessの設定上で有効な配信だけを表示しています。LINE公式アカウント側のあいさつ、送信待ちの遅延返信、友だちごとの停止、リマインダーは含みません。実際に届くかは、条件や友だちごとの状態で変わります。
      </p>
      {loadedAt && <p className="text-xs text-gray-500">{formatTime(loadedAt.toISOString())} 時点（日本時間）</p>}
      {loading && <p role="status" className="mt-3 text-sm text-gray-600">配信設定を読み込み中...</p>}
      {!accountLoading && !selectedAccountId && <p role="alert" className="mt-3 text-sm text-red-700">LINEアカウントが選択されていません。</p>}
      {errors.length > 0 && (
        <p role="alert" className="mt-3 border-l-2 border-red-500 pl-3 text-sm text-red-700">
          {errors.join('、')}を読み込めませんでした。この画面の一覧は不完全です。右上の「更新」で読み込み直してください。
        </p>
      )}

      <DeliverySection
        id="active-scenarios"
        title="シナリオ配信"
        count={activeScenarios.length}
        loading={loading}
        description="友だち追加などをきっかけに、決めた順番で自動で届くメッセージです。開くと1通ずつ確認できます。"
        editHref="/scenarios"
        editLabel="シナリオを編集"
      >
        {!loading && !errors.includes('シナリオ') && activeScenarios.length === 0 && <EmptyLine>有効なシナリオはありません。</EmptyLine>}
        {activeScenarios.map((scenario) => {
          const steps = stepsByScenario[scenario.id]
          return (
            <DeliveryRow
              key={scenario.id}
              title={scenario.name}
              subtitle={`${scenarioStartText(scenario.triggerType, scenario.triggerTagId ? tagById.get(scenario.triggerTagId) : null)}。全${scenario.stepCount ?? 0}通。`}
              onOpen={() => void showScenario(scenario.id)}
            >
              <TalkArea>
                {loadingStepId === scenario.id && <TalkNote>読み込み中...</TalkNote>}
                {stepErrors[scenario.id] && <p className="text-sm text-red-700">{stepErrors[scenario.id]}</p>}
                {steps && steps.length === 0 && <TalkNote>このシナリオにはまだメッセージがありません</TalkNote>}
                {steps && steps.length > 0 && (
                  <TalkTimeline>
                    {steps.map((step, index) => {
                      const message = resolved(step.messageType, step.messageContent, step.templateId)
                      return (
                        <TalkStep
                          key={step.id}
                          number={index + 1}
                          timing={stepTimingLabel(step, index, scenario.deliveryMode, scenario.triggerType)}
                          condition={stepConditionText(step, tagName)}
                          note={message.note}
                          isLast={index === steps.length - 1}
                        >
                          {message.type ? <MessageBubble type={message.type} content={message.content} /> : null}
                        </TalkStep>
                      )
                    })}
                  </TalkTimeline>
                )}
              </TalkArea>
              <Link href={`/scenarios/detail?id=${scenario.id}`} className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline">
                このシナリオの設定と参加者を見る
              </Link>
            </DeliveryRow>
          )
        })}
      </DeliverySection>

      <DeliverySection
        id="active-survey"
        title="登録時アンケート"
        loading={loading}
        description="友だち追加の直後に、あいさつのシナリオの中で送るアンケートです。"
        editHref="/surveys"
        editLabel="アンケートを編集"
      >
        {survey ? (
          <div className="border-b border-gray-300 px-1 py-3.5">
            <p className="text-[15px] font-semibold leading-6 text-gray-900 break-words">{survey.form.name}</p>
            <p className="mt-0.5 text-sm leading-6 text-gray-600">
              {survey.isActive && survey.friendAddScenario?.isActive ? 'あいさつのシナリオの中で送っています' : '今は送らない設定です'}。全{survey.questions.length}問。
            </p>
          </div>
        ) : !loading && <EmptyLine>設定を確認できませんでした。</EmptyLine>}
      </DeliverySection>

      <DeliverySection
        id="scheduled-broadcasts"
        title="一斉配信"
        count={scheduledBroadcasts.length}
        loading={loading}
        description="日時を決めて、対象の友だちにまとめて送るメッセージです。予約済みと送信中のものを表示します。"
        editHref="/broadcasts"
        editLabel="一斉配信を編集"
      >
        {!loading && !errors.includes('一斉配信') && scheduledBroadcasts.length === 0 && <EmptyLine>予約済み・送信中の一斉配信はありません。</EmptyLine>}
        {scheduledBroadcasts.map((broadcast) => (
          <DeliveryRow
            key={broadcast.id}
            title={broadcast.title}
            subtitle={`${broadcast.status === 'sending' ? '今送信しています' : `${formatTime(broadcast.scheduledAt)}に送信予定`}。送り先は${broadcastTarget(broadcast)}。`}
          >
            <TalkArea>
              <div className="space-y-4">
                <TalkNote>{broadcast.status === 'sending' ? '送信中' : `${formatTime(broadcast.scheduledAt)} に届く`}</TalkNote>
                <div className="pl-2"><MessageBubble type={broadcast.messageType} content={broadcast.messageContent} /></div>
              </div>
            </TalkArea>
            <Link href={`/broadcasts?id=${broadcast.id}`} className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline">
              この一斉配信の詳細を見る
            </Link>
          </DeliveryRow>
        ))}
      </DeliverySection>

      <DeliverySection
        id="active-replies"
        title="自動返信"
        count={activeReplies.length}
        loading={loading}
        description="友だちが決まった言葉を送ってきたときに、自動で返すメッセージです。右の緑が友だちの送る言葉、左の白が返信です。"
        editHref="/auto-replies"
        editLabel="自動返信を編集"
      >
        {!loading && !errors.includes('自動返信') && activeReplies.length === 0 && <EmptyLine>このアカウントで返信する有効なルールはありません。</EmptyLine>}
        {activeReplies.map((reply) => {
          const message = resolved(reply.responseType, reply.responseContent, reply.templateId)
          const viaAutomation = reply.effectiveAccounts?.some((account) => account.accountId === selectedAccountId && account.via === 'automation')
          const messages = message.type && !viaAutomation ? sequenceMessages(message.type, message.content) : []
          return (
            <DeliveryRow
              key={reply.id}
              title={`「${reply.keyword}」`}
              subtitle={`${reply.matchType === 'exact' ? 'この言葉とまったく同じとき' : 'この言葉を含むとき'}に返信${viaAutomation ? '（返信は自動化ルールから送信）' : messages.length > 0 ? `。全${messages.length}通` : ''}。`}
            >
              <TalkArea>
                <div className="space-y-5">
                  <FriendBubble>{reply.keyword}</FriendBubble>
                  {viaAutomation && <TalkNote>このルールは返信文を持たず、下の「メッセージに関係する自動化」から送信します</TalkNote>}
                  {!viaAutomation && messages.length === 0 && <TalkNote>本文を確認できません。自動返信の編集画面で確認してください</TalkNote>}
                  {messages.length > 0 && (
                    <TalkTimeline>
                      {messages.map((item, index) => (
                        <TalkStep
                          key={index}
                          number={index + 1}
                          timing={replyTimingLabel(item)}
                          note={index === 0 ? message.note : undefined}
                          isLast={index === messages.length - 1}
                        >
                          <MessageBubble type={item.messageType} content={item.messageContent} />
                        </TalkStep>
                      ))}
                    </TalkTimeline>
                  )}
                </div>
              </TalkArea>
            </DeliveryRow>
          )
        })}
      </DeliverySection>

      <DeliverySection
        id="active-automations"
        title="メッセージに関係する自動化"
        count={activeAutomations.length}
        loading={loading}
        description="友だち追加やメッセージの受信などをきっかけに、メッセージを送ったりシナリオを始めたりするルールです。"
        editHref="/automations"
        editLabel="自動化を編集"
      >
        {!loading && !errors.includes('自動化') && activeAutomations.length === 0 && <EmptyLine>このアカウントで有効な対象ルールはありません。</EmptyLine>}
        {activeAutomations.map((automation) => {
          const actions = automation.actions.filter((action) => action.type === 'send_message' || action.type === 'start_scenario')
          return (
            <DeliveryRow
              key={automation.id}
              title={automation.name}
              subtitle={`${automation.eventType === 'friend_add' ? '友だち追加のとき' : automation.eventType === 'message_received' ? 'メッセージを受け取ったとき' : `「${automation.eventType}」のとき`}に動きます${Object.keys(automation.conditions).length > 0 ? '（条件あり）' : ''}。`}
            >
              <TalkArea>
                <div className="space-y-4">
                  {actions.map((action, index) => {
                    if (action.type === 'start_scenario') {
                      const next = scenarios.find((scenario) => scenario.id === action.params.scenarioId)
                      return <TalkNote key={index}>シナリオ「{next?.name ?? '参照先未確認'}」を開始</TalkNote>
                    }
                    const message = resolved(
                      typeof action.params.messageType === 'string' ? action.params.messageType : 'text',
                      typeof action.params.content === 'string' ? action.params.content : '',
                      typeof action.params.template_id === 'string' ? action.params.template_id : null,
                    )
                    return (
                      <div key={index} className="pl-2">
                        {message.type && <MessageBubble type={message.type} content={message.content} />}
                        {message.note && <p className="mt-1.5 text-xs leading-5 text-gray-600">{message.note}</p>}
                      </div>
                    )
                  })}
                </div>
              </TalkArea>
            </DeliveryRow>
          )
        })}
      </DeliverySection>
    </div>
  )
}
