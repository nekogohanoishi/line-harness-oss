'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { Automation, Scenario, ScenarioStep, Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type RegistrationSurveySettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { PageHeader } from '@/components/ui'
import ManualRefreshButton from '@/components/ui/manual-refresh-button'
import FlexPreviewComponent from '@/components/flex-preview'

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

const triggerLabels: Record<Scenario['triggerType'], string> = {
  friend_add: '友だち追加・ブロック解除',
  tag_added: 'タグが付いたとき',
  manual: '手動開始',
}

function MessageContent({ type, content }: { type: string; content: string }) {
  if (type === 'flex' || type === 'carousel') {
    return <div className="max-w-[320px] overflow-x-auto"><FlexPreviewComponent content={content} maxWidth={300} /></div>
  }
  if (type === 'image') {
    try {
      const image = JSON.parse(content) as { previewImageUrl?: string; originalContentUrl?: string }
      const url = image.previewImageUrl || image.originalContentUrl
      return url ? <img src={url} alt="配信する画像" className="max-h-48 max-w-full object-contain" /> : <p className="text-sm text-red-600">画像URLが設定されていません</p>
    } catch {
      return <p className="text-sm text-red-600">画像情報を読み込めません</p>
    }
  }
  return <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">{content}</p>
}

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

function scheduleLabel(step: ScenarioStep, mode: Scenario['deliveryMode']) {
  if (mode === 'absolute_time') return `開始から${step.offsetDays ?? 0}日後 ${step.deliveryTime ?? '時刻未設定'}（日本時間）`
  if (mode === 'elapsed') return `開始から${step.offsetDays ?? 0}日と${step.offsetMinutes ?? 0}分後`
  return `前のステップから${step.delayMinutes}分後`
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
      if (requestId === requestIdRef.current) setStepErrors((current) => ({ ...current, [scenarioId]: 'ステップを読み込めませんでした。もう一度開いてください。' }))
    } finally {
      if (requestId === requestIdRef.current) setLoadingStepId(null)
    }
  }

  const resolved = (type: string, content: string, templateId: string | null | undefined) => {
    if (!templateId) return { type, content, note: '' }
    if (!templates) return { type: '', content: '', note: '共有テンプレートを読み込めないため、現在の本文は確認できません' }
    const template = templateById.get(templateId)
    return template
      ? { type: template.messageType, content: template.messageContent, note: `共有テンプレート「${template.name}」の現在の内容` }
      : { type, content, note: '参照先のテンプレートがないため、保存済みの本文を使用' }
  }

  const formatTime = (value: string | null) => value
    ? new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '日時未設定'

  return (
    <div>
      <PageHeader
        title="現在有効な配信"
        description={`${selectedAccount?.displayName || selectedAccount?.name || '選択中のアカウント'}のHarness内設定`}
        actions={<ManualRefreshButton onClick={load} loading={loading} />}
      />
      <p className="mb-4 border-l-2 border-amber-400 pl-3 text-xs leading-5 text-gray-600">
        ここでは設定上有効な配信を表示します。LINE公式アカウント側の挨拶、既に送信待ちの遅延返信、友だちごとの停止状態、リマインダーは含みません。実際の送信は条件や個別の状態で変わります。
      </p>
      {loading && <p role="status" className="mb-4 text-sm text-gray-600">配信設定を読み込み中...</p>}
      {!accountLoading && !selectedAccountId && <p role="alert" className="mb-4 text-sm text-red-700">LINEアカウントが選択されていません。</p>}
      {loadedAt && <p className="mb-4 text-xs text-gray-500">確認時刻: {formatTime(loadedAt.toISOString())}（日本時間）</p>}
      {errors.length > 0 && (
        <div role="alert" className="mb-5 border-l-2 border-red-500 pl-3 text-sm text-red-700">
          {errors.join('・')}を読み込めませんでした。この画面の一覧は不完全です。
        </div>
      )}

      <section className="mb-8" aria-labelledby="active-scenarios">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
          <h2 id="active-scenarios" className="text-base font-semibold">シナリオ配信 <span className="text-sm font-normal text-gray-500">{loading ? '確認中' : `${activeScenarios.length}件`}</span></h2>
          <Link href="/scenarios" className="text-sm text-blue-700 hover:underline">シナリオを編集</Link>
        </div>
        {!loading && !errors.includes('シナリオ') && activeScenarios.length === 0 && <p className="py-3 text-sm text-gray-500">有効なシナリオはありません。</p>}
        {activeScenarios.map((scenario) => (
          <details key={scenario.id} className="border-b border-gray-100 py-3" onToggle={(event) => {
            if (event.currentTarget.open) void showScenario(scenario.id)
          }}>
            <summary className="cursor-pointer text-sm font-medium text-gray-900">{scenario.name} <span className="ml-2 font-normal text-gray-500">{triggerLabels[scenario.triggerType]}{scenario.triggerType === 'tag_added' && scenario.triggerTagId ? `「${tagById.get(scenario.triggerTagId) ?? 'タグ名未確認'}」` : ''}・{scenario.stepCount ?? 0}通</span></summary>
            <div className="mt-3 space-y-4 pl-4">
              <Link href={`/scenarios/detail?id=${scenario.id}`} className="text-sm text-blue-700 hover:underline">設定・参加者を確認</Link>
              {loadingStepId === scenario.id && <p className="text-sm text-gray-500">読み込み中...</p>}
              {stepErrors[scenario.id] && <p className="text-sm text-red-700">{stepErrors[scenario.id]}</p>}
              {stepsByScenario[scenario.id]?.map((step, index) => {
                const message = resolved(step.messageType, step.messageContent, step.templateId)
                return (
                  <div key={step.id} className="border-l-2 border-gray-200 pl-3">
                    <p className="mb-1 text-xs font-medium text-gray-600">{index + 1}通目・{scheduleLabel(step, scenario.deliveryMode)}{step.conditionType ? '・条件あり' : ''}</p>
                    {message.note && <p className="mb-1 text-xs text-gray-500">{message.note}</p>}
                    {message.type && <MessageContent type={message.type} content={message.content} />}
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </section>

      <section className="mb-8" aria-labelledby="active-survey">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
          <h2 id="active-survey" className="text-base font-semibold">登録時アンケート</h2>
          <Link href="/surveys" className="text-sm text-blue-700 hover:underline">アンケートを編集</Link>
        </div>
        {survey ? (
          <p className="py-2 text-sm text-gray-700">
            {survey.form.name}：{survey.isActive && survey.friendAddScenario?.isActive ? '挨拶シナリオ内で有効' : '配信されない設定'}
            <span className="ml-2 text-gray-500">{survey.questions.length}問</span>
          </p>
        ) : !loading && <p className="py-2 text-sm text-gray-500">設定を確認できませんでした。</p>}
      </section>

      <section className="mb-8" aria-labelledby="scheduled-broadcasts">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
          <h2 id="scheduled-broadcasts" className="text-base font-semibold">一斉配信 <span className="text-sm font-normal text-gray-500">{loading ? '確認中' : `${scheduledBroadcasts.length}件`}</span></h2>
          <Link href="/broadcasts" className="text-sm text-blue-700 hover:underline">一斉配信を編集</Link>
        </div>
        {!loading && !errors.includes('一斉配信') && scheduledBroadcasts.length === 0 && <p className="py-3 text-sm text-gray-500">予約済み・送信中の一斉配信はありません。</p>}
        {scheduledBroadcasts.map((broadcast) => (
          <details key={broadcast.id} className="border-b border-gray-100 py-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-900">{broadcast.title} <span className="ml-2 font-normal text-gray-500">{broadcast.status === 'sending' ? '送信中' : formatTime(broadcast.scheduledAt)}・{broadcast.targetType === 'all' ? '全員' : broadcast.targetType === 'tag' ? `タグ「${broadcast.targetTagId ? tagById.get(broadcast.targetTagId) ?? '名前未確認' : '未指定'}」` : '複数アカウント'}</span></summary>
            <div className="mt-3 space-y-3 pl-4">
              <MessageContent type={broadcast.messageType} content={broadcast.messageContent} />
              <Link href={`/broadcasts?id=${broadcast.id}`} className="text-sm text-blue-700 hover:underline">配信詳細を確認</Link>
            </div>
          </details>
        ))}
      </section>

      <section className="mb-8" aria-labelledby="active-replies">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
          <h2 id="active-replies" className="text-base font-semibold">自動返信 <span className="text-sm font-normal text-gray-500">{loading ? '確認中' : `${activeReplies.length}件`}</span></h2>
          <Link href="/auto-replies" className="text-sm text-blue-700 hover:underline">自動返信を編集</Link>
        </div>
        {!loading && !errors.includes('自動返信') && activeReplies.length === 0 && <p className="py-3 text-sm text-gray-500">このアカウントで返信する有効なルールはありません。</p>}
        {activeReplies.map((reply) => {
          const message = resolved(reply.responseType, reply.responseContent, reply.templateId)
          const viaAutomation = reply.effectiveAccounts?.some((account) => account.accountId === selectedAccountId && account.via === 'automation')
          const messages = message.type && !viaAutomation ? sequenceMessages(message.type, message.content) : []
          return (
            <details key={reply.id} className="border-b border-gray-100 py-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-900">「{reply.keyword}」 <span className="ml-2 font-normal text-gray-500">{reply.matchType === 'exact' ? '完全一致' : '部分一致'}{viaAutomation ? '・自動化経由' : ''}</span></summary>
              <div className="mt-3 space-y-3 pl-4">
                {message.note && <p className="text-xs text-gray-500">{message.note}</p>}
                {viaAutomation
                  ? <p className="text-sm text-gray-700">このルールは返信文を持たず、下の自動化ルールから送信します。</p>
                  : messages.length === 0 && <p className="text-sm text-amber-700">本文を確認できません。編集画面で確認してください。</p>}
                {messages.map((item, index) => (
                  <div key={index} className="border-l-2 border-gray-200 pl-3">
                    <p className="mb-1 text-xs text-gray-500">{index + 1}通目{item.deliveryTimeJst ? `・${item.sameDayCutoffTimeJst}までの受信で当日${item.deliveryTimeJst}、以降は翌日` : item.delaySeconds ? `・${item.delaySeconds}秒後` : '・即時'}</p>
                    <MessageContent type={item.messageType} content={item.messageContent} />
                  </div>
                ))}
                {viaAutomation && <p className="text-xs text-gray-500">自動化経由の本文は下の自動化ルールでも確認してください。</p>}
              </div>
            </details>
          )
        })}
      </section>

      <section className="mb-8" aria-labelledby="active-automations">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
          <h2 id="active-automations" className="text-base font-semibold">メッセージに関係する自動化 <span className="text-sm font-normal text-gray-500">{loading ? '確認中' : `${activeAutomations.length}件`}</span></h2>
          <Link href="/automations" className="text-sm text-blue-700 hover:underline">自動化を編集</Link>
        </div>
        {!loading && !errors.includes('自動化') && activeAutomations.length === 0 && <p className="py-3 text-sm text-gray-500">このアカウントで有効な対象ルールはありません。</p>}
        {activeAutomations.map((automation) => (
          <details key={automation.id} className="border-b border-gray-100 py-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-900">{automation.name} <span className="ml-2 font-normal text-gray-500">{automation.eventType === 'friend_add' ? '友だち追加' : automation.eventType === 'message_received' ? 'メッセージ受信' : automation.eventType}{Object.keys(automation.conditions).length > 0 ? '・条件あり' : ''}</span></summary>
            <div className="mt-3 space-y-3 pl-4">
              {automation.actions.filter((action) => action.type === 'send_message' || action.type === 'start_scenario').map((action, index) => {
                if (action.type === 'start_scenario') {
                  const next = scenarios.find((scenario) => scenario.id === action.params.scenarioId)
                  return <p key={index} className="text-sm text-gray-700">シナリオ「{next?.name ?? '参照先未確認'}」を開始</p>
                }
                const message = resolved(
                  typeof action.params.messageType === 'string' ? action.params.messageType : 'text',
                  typeof action.params.content === 'string' ? action.params.content : '',
                  typeof action.params.template_id === 'string' ? action.params.template_id : null,
                )
                return <div key={index} className="border-l-2 border-gray-200 pl-3">{message.note && <p className="mb-1 text-xs text-gray-500">{message.note}</p>}{message.type && <MessageContent type={message.type} content={message.content} />}</div>
              })}
            </div>
          </details>
        ))}
      </section>
    </div>
  )
}
