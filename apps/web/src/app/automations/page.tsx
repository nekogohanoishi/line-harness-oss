'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, eventsApi, webinarApi, type EventListItem, type WebinarCtaItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import { ConfirmSheet, EmptyState, TechnicalDetails } from '@/components/ui'

type AutomationEventType =
  | "friend_add"
  | "tag_change"
  | "score_threshold"
  | "cv_fire"
  | "message_received"
  | "calendar_booked"
  | "webinar_opened"
  | "webinar_started"
  | "webinar_completed"
  | "webinar_cta_clicked"
  | "webinar_abandoned"

interface AutomationAction {
  type: "add_tag" | "remove_tag" | "start_scenario" | "send_message" | "send_webhook" | "switch_rich_menu"
  params: Record<string, unknown>
}

type SimpleActionType = 'add_tag' | 'remove_tag' | 'start_scenario' | 'send_message' | 'send_webhook'

interface ActionDraft {
  id: string
  type: SimpleActionType
  targetId: string
  content: string
  url: string
}

interface TemplateOption {
  id: string
  name: string
  messageType: string
}

const actionTypeOptions: Array<{ value: SimpleActionType; label: string }> = [
  { value: 'add_tag', label: 'タグを付ける' },
  { value: 'remove_tag', label: 'タグを外す' },
  { value: 'start_scenario', label: 'シナリオを開始する' },
  { value: 'send_message', label: 'メッセージを送る' },
  { value: 'send_webhook', label: '外部サービスへ通知する' },
]

function createActionDraft(type: SimpleActionType = 'add_tag'): ActionDraft {
  return { id: crypto.randomUUID(), type, targetId: '', content: '', url: '' }
}

interface Automation {
  id: string
  name: string
  description: string | null
  eventType: AutomationEventType
  conditions: Record<string, unknown>
  actions: AutomationAction[]
  isActive: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

const eventTypeOptions: { value: AutomationEventType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加' },
  { value: 'tag_change', label: 'タグ変更' },
  { value: 'score_threshold', label: 'スコア到達' },
  { value: 'cv_fire', label: 'コンバージョン発生' },
  { value: 'message_received', label: 'メッセージ受信' },
  { value: 'calendar_booked', label: 'カレンダー予約' },
  { value: 'webinar_opened', label: 'ウェビナーページを開いた' },
  { value: 'webinar_started', label: 'ウェビナー動画を再生した' },
  { value: 'webinar_completed', label: 'ウェビナーを最後まで視聴した' },
  { value: 'webinar_cta_clicked', label: 'ウェビナーの案内ボタンを押した' },
  { value: 'webinar_abandoned', label: 'ウェビナー途中離脱' },
]

const eventTypeLabelMap: Record<AutomationEventType, string> = {
  friend_add: '友だち追加',
  tag_change: 'タグ変更',
  score_threshold: 'スコア到達',
  cv_fire: 'コンバージョン発生',
  message_received: 'メッセージ受信',
  calendar_booked: 'カレンダー予約',
  webinar_opened: 'ウェビナーページを開いた',
  webinar_started: 'ウェビナー動画を再生した',
  webinar_completed: 'ウェビナーを最後まで視聴した',
  webinar_cta_clicked: 'ウェビナーの案内ボタンを押した',
  webinar_abandoned: 'ウェビナー途中離脱',
}

const eventTypeBadgeColor: Record<AutomationEventType, string> = {
  friend_add: 'bg-green-100 text-green-700',
  tag_change: 'bg-blue-100 text-blue-700',
  score_threshold: 'bg-yellow-100 text-yellow-700',
  cv_fire: 'bg-red-100 text-red-700',
  message_received: 'bg-purple-100 text-purple-700',
  calendar_booked: 'bg-indigo-100 text-indigo-700',
  webinar_opened: 'bg-teal-100 text-teal-700',
  webinar_started: 'bg-teal-100 text-teal-700',
  webinar_completed: 'bg-emerald-100 text-emerald-700',
  webinar_cta_clicked: 'bg-orange-100 text-orange-700',
  webinar_abandoned: 'bg-rose-100 text-rose-700',
}

interface CreateFormState {
  name: string
  description: string
  eventType: AutomationEventType
  actionsJson: string
  conditionsJson: string
  priority: number
}

const initialForm: CreateFormState = {
  name: '',
  description: '',
  eventType: 'friend_add',
  actionsJson: '[\n  {\n    "type": "add_tag",\n    "params": {}\n  }\n]',
  conditionsJson: '{}',
  priority: 0,
}

const ccPrompts = [
  {
    title: 'オートメーションルール作成',
    prompt: `新しいオートメーションルールを作成するサポートをしてください。
1. 利用可能なイベントタイプ（友だち追加、タグ変更、スコア閾値等）の説明
2. 画面の選択項目を使った設定例を提供
3. 条件設定と実行内容の組み合わせを提案
手順を示してください。`,
  },
  {
    title: 'オートメーション効果分析',
    prompt: `現在のオートメーションルールの効果を分析してください。
1. 各ルールの発火回数と成功率を確認
2. イベントタイプ別の自動化カバレッジを評価
3. 効果の低いルールの改善提案と新規ルールの推奨
結果をレポートしてください。`,
  },
]

export default function AutomationsPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ ...initialForm })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [actionDrafts, setActionDrafts] = useState<ActionDraft[]>([createActionDraft()])
  const [advancedActions, setAdvancedActions] = useState(false)
  const [advancedConditions, setAdvancedConditions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmTarget, setConfirmTarget] = useState<{
    kind: 'toggle' | 'delete'
    automation: Automation
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  // 条件欄の手書きJSONをやめて、イベント種別に応じたプルダウン/入力から自動組み立てする。
  const [events, setEvents] = useState<EventListItem[]>([])
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [ctaItems, setCtaItems] = useState<WebinarCtaItem[]>([])
  const [conditionEventId, setConditionEventId] = useState('')
  const [conditionCtaItemId, setConditionCtaItemId] = useState('')
  const [conditionTagId, setConditionTagId] = useState('')
  const [conditionScore, setConditionScore] = useState('')
  const [conditionKeyword, setConditionKeyword] = useState('')
  const [conditionKeywordMatch, setConditionKeywordMatch] = useState<'exact' | 'contains'>('exact')

  const loadAutomations = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.automations.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setAutomations(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('オートメーションの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return

    let cancelled = false

    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.automations.list({ accountId: selectedAccountId || undefined })
        if (cancelled) return
        if (res.success) {
          setAutomations(res.data)
        } else {
          setError(res.error)
        }
      } catch {
        if (cancelled) return
        setError('オートメーションの読み込みに失敗しました。もう一度お試しください。')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [selectedAccountId, accountLoading])

  // ウェビナー系イベントのプルダウン用にイベント一覧を取得 (アカウント選択時のみ)
  useEffect(() => {
    if (!selectedAccountId) {
      setEvents([])
      return
    }
    let cancelled = false
    eventsApi.listEvents(selectedAccountId)
      .then((res) => { if (!cancelled) setEvents(res.items) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [selectedAccountId])

  // 選択式フォームで使う候補をまとめて取得する。
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.tags.list(),
      api.scenarios.list({ accountId: selectedAccountId || undefined }),
      api.templates.list(),
    ]).then(([tagsRes, scenariosRes, templatesRes]) => {
      if (cancelled) return
      if (tagsRes.success) setTags(tagsRes.data.map((tag) => ({ id: tag.id, name: tag.name })))
      if (scenariosRes.success) setScenarios(scenariosRes.data.map((scenario) => ({ id: scenario.id, name: scenario.name })))
      if (templatesRes.success) {
        setTemplates(templatesRes.data.map((template) => ({
          id: template.id,
          name: template.name,
          messageType: template.messageType,
        })))
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedAccountId])

  useEffect(() => {
    if (form.eventType !== 'webinar_cta_clicked' || !selectedAccountId || !conditionEventId) {
      setCtaItems([])
      return
    }
    let cancelled = false
    webinarApi.getCtaList(conditionEventId, selectedAccountId)
      .then((res) => { if (!cancelled) setCtaItems(res.items) })
      .catch(() => { if (!cancelled) setCtaItems([]) })
    return () => { cancelled = true }
  }, [conditionEventId, form.eventType, selectedAccountId])

  const isWebinarEventType = form.eventType.startsWith('webinar_')
  const isTagChangeEventType = form.eventType === 'tag_change'

  const resetEditor = () => {
    setShowCreate(false)
    setEditingId(null)
    setForm({ ...initialForm })
    setActionDrafts([createActionDraft()])
    setAdvancedActions(false)
    setAdvancedConditions(false)
    setConditionEventId('')
    setConditionCtaItemId('')
    setConditionTagId('')
    setConditionScore('')
    setConditionKeyword('')
    setConditionKeywordMatch('exact')
    setFormError('')
  }

  const parseSimpleActions = (): AutomationAction[] => actionDrafts.map((draft, index) => {
    const position = index + 1
    if (draft.type === 'add_tag' || draft.type === 'remove_tag') {
      if (!draft.targetId) throw new Error(`${position}件目のタグを選択してください`)
      return { type: draft.type, params: { tagId: draft.targetId } }
    }
    if (draft.type === 'start_scenario') {
      if (!draft.targetId) throw new Error(`${position}件目のシナリオを選択してください`)
      return { type: draft.type, params: { scenarioId: draft.targetId } }
    }
    if (draft.type === 'send_message') {
      if (draft.targetId) return { type: draft.type, params: { template_id: draft.targetId } }
      if (!draft.content.trim()) throw new Error(`${position}件目のメッセージを入力してください`)
      return { type: draft.type, params: { messageType: 'text', content: draft.content } }
    }
    if (!draft.url.trim().startsWith('https://')) {
      throw new Error(`${position}件目の通知先URLは https:// から入力してください`)
    }
    return { type: draft.type, params: { url: draft.url.trim() } }
  })

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
      return
    }

    let parsedActions: AutomationAction[]
    try {
      parsedActions = advancedActions ? JSON.parse(form.actionsJson) : parseSimpleActions()
      if (!Array.isArray(parsedActions) || parsedActions.length === 0) {
        throw new Error('実行することを1件以上設定してください')
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '実行内容を確認してください')
      return
    }

    let parsedConditions: Record<string, unknown>
    if (advancedConditions) {
      try {
        parsedConditions = JSON.parse(form.conditionsJson)
      } catch {
        setFormError('高度な条件設定の形式が正しくありません')
        return
      }
    } else if (isWebinarEventType) {
      parsedConditions = {}
      if (conditionEventId) parsedConditions.eventId = conditionEventId
      if (form.eventType === 'webinar_cta_clicked' && conditionCtaItemId.trim()) {
        parsedConditions.ctaItemId = conditionCtaItemId.trim()
      }
    } else if (isTagChangeEventType) {
      parsedConditions = {}
      if (conditionTagId) parsedConditions.tag_id = conditionTagId
    } else if (form.eventType === 'score_threshold') {
      const score = Number(conditionScore)
      if (!conditionScore.trim() || !Number.isFinite(score)) {
        setFormError('基準となるスコアを入力してください')
        return
      }
      parsedConditions = { score_threshold: score }
    } else if (form.eventType === 'message_received') {
      parsedConditions = conditionKeyword.trim()
        ? { [conditionKeywordMatch === 'exact' ? 'keyword_exact' : 'keyword']: conditionKeyword.trim() }
        : {}
    } else {
      parsedConditions = {}
    }

    setSaving(true)
    setFormError('')
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        eventType: form.eventType,
        actions: parsedActions,
        conditions: parsedConditions,
        priority: form.priority,
      }
      const res = editingId
        ? await api.automations.update(editingId, payload)
        : await api.automations.create({ ...payload, lineAccountId: selectedAccountId || null })
      if (res.success) {
        setNotice(editingId ? 'オートメーションを更新しました。' : 'オートメーションを作成しました。')
        resetEditor()
        loadAutomations()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError(editingId ? '更新に失敗しました' : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (automation: Automation) => {
    const drafts: ActionDraft[] = []
    let needsAdvancedActions = false
    for (const action of automation.actions) {
      const params = action.params as Record<string, string | undefined>
      if (action.type === 'add_tag' || action.type === 'remove_tag') {
        drafts.push({ ...createActionDraft(action.type), targetId: params.tagId ?? '' })
      } else if (action.type === 'start_scenario') {
        drafts.push({ ...createActionDraft(action.type), targetId: params.scenarioId ?? '' })
      } else if (action.type === 'send_message' && (params.template_id || !params.messageType || params.messageType === 'text')) {
        drafts.push({
          ...createActionDraft('send_message'),
          targetId: params.template_id ?? '',
          content: params.content ?? '',
        })
      } else if (action.type === 'send_webhook') {
        drafts.push({ ...createActionDraft('send_webhook'), url: params.url ?? '' })
      } else {
        needsAdvancedActions = true
      }
    }

    const conditions = automation.conditions ?? {}
    const knownConditionKeys = new Set(
      automation.eventType.startsWith('webinar_')
        ? ['eventId', 'ctaItemId']
        : automation.eventType === 'tag_change'
          ? ['tag_id']
          : automation.eventType === 'score_threshold'
            ? ['score_threshold']
            : automation.eventType === 'message_received'
              ? ['keyword', 'keyword_exact']
              : [],
    )
    const needsAdvancedConditions = Object.keys(conditions).some((key) => !knownConditionKeys.has(key))

    setEditingId(automation.id)
    setForm({
      name: automation.name,
      description: automation.description ?? '',
      eventType: automation.eventType,
      actionsJson: JSON.stringify(automation.actions, null, 2),
      conditionsJson: JSON.stringify(conditions, null, 2),
      priority: automation.priority,
    })
    setActionDrafts(drafts.length > 0 ? drafts : [createActionDraft()])
    setAdvancedActions(needsAdvancedActions)
    setAdvancedConditions(needsAdvancedConditions)
    setConditionEventId(typeof conditions.eventId === 'string' ? conditions.eventId : '')
    setConditionCtaItemId(typeof conditions.ctaItemId === 'string' ? conditions.ctaItemId : '')
    setConditionTagId(typeof conditions.tag_id === 'string' ? conditions.tag_id : '')
    setConditionScore(conditions.score_threshold === undefined ? '' : String(conditions.score_threshold))
    if (typeof conditions.keyword_exact === 'string') {
      setConditionKeyword(conditions.keyword_exact)
      setConditionKeywordMatch('exact')
    } else {
      setConditionKeyword(typeof conditions.keyword === 'string' ? conditions.keyword : '')
      setConditionKeywordMatch('contains')
    }
    setFormError('')
    setShowCreate(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openCreate = () => {
    resetEditor()
    setShowCreate(true)
  }

  const updateActionDraft = (id: string, patch: Partial<ActionDraft>) => {
    setActionDrafts((current) => current.map((draft) => (
      draft.id === id ? { ...draft, ...patch } : draft
    )))
  }

  const describeAction = (action: AutomationAction): string => {
    const params = action.params as Record<string, string | undefined>
    if (action.type === 'add_tag' || action.type === 'remove_tag') {
      const tag = tags.find((item) => item.id === params.tagId)
      const name = tag?.name ?? '削除されたタグ'
      return action.type === 'add_tag' ? `タグ「${name}」を付ける` : `タグ「${name}」を外す`
    }
    if (action.type === 'start_scenario') {
      const scenario = scenarios.find((item) => item.id === params.scenarioId)
      return `シナリオ「${scenario?.name ?? '削除されたシナリオ'}」を開始する`
    }
    if (action.type === 'send_message') {
      const template = templates.find((item) => item.id === params.template_id)
      return template ? `テンプレート「${template.name}」を送る` : 'メッセージを送る'
    }
    if (action.type === 'send_webhook') return '外部サービスへ通知する'
    return 'リッチメニューを切り替える'
  }

  const handleConfirmedAction = async () => {
    if (!confirmTarget) return
    setConfirmBusy(true)
    setConfirmError('')
    setNotice('')
    try {
      if (confirmTarget.kind === 'toggle') {
        const nextActive = !confirmTarget.automation.isActive
        const res = await api.automations.update(confirmTarget.automation.id, { isActive: nextActive })
        if (!res.success) throw new Error(res.error)
        setNotice(nextActive ? 'オートメーションを有効にしました。' : 'オートメーションを無効にしました。')
      } else {
        const res = await api.automations.delete(confirmTarget.automation.id)
        if (!res.success) throw new Error(res.error)
        setNotice('オートメーションを削除しました。')
      }
      setConfirmTarget(null)
      await loadAutomations()
    } catch (actionError) {
      setConfirmError(actionError instanceof Error ? actionError.message : '操作に失敗しました')
    } finally {
      setConfirmBusy(false)
    }
  }

  return (
    <div>
      <Header
        title="オートメーション"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規ルール
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 border-l-4 border-green-500 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">
            {editingId ? 'オートメーションを編集' : '新規オートメーションを作成'}
          </h2>
          <div className="space-y-5 max-w-2xl">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ルール名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 友だち追加時にウェルカムタグ付与"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={2}
                placeholder="ルールの説明 (省略可)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">イベントタイプ</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={form.eventType}
                disabled={advancedActions || advancedConditions}
                onChange={(e) => {
                  setForm({ ...form, eventType: e.target.value as AutomationEventType })
                  setConditionEventId('')
                  setConditionCtaItemId('')
                  setConditionTagId('')
                  setConditionScore('')
                  setConditionKeyword('')
                  setAdvancedConditions(false)
                }}
              >
                {eventTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {(advancedActions || advancedConditions) && (
                <p className="mt-1 text-xs text-amber-700">既存の複雑な設定を保持するため、発生条件は変更できません。</p>
              )}
            </div>

            <div>
              <div className="mb-2">
                <label className="block text-xs font-medium text-gray-600">実行すること</label>
              </div>
              {advancedActions ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">このルールには画面で編集できない実行内容があります</p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">
                    保存済みの内容は変更せずに保持します。実行内容を組み直す場合は、新しいルールを作成してください。
                  </p>
                  <TechnicalDetails
                    className="mt-2"
                    items={[{ label: '保存されている実行設定', value: form.actionsJson, copyable: true }]}
                  />
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                  {actionDrafts.map((draft, index) => (
                    <div key={draft.id} className="p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500 shrink-0">{index + 1}</span>
                        <select
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          value={draft.type}
                          onChange={(e) => updateActionDraft(draft.id, {
                            type: e.target.value as SimpleActionType,
                            targetId: '',
                            content: '',
                            url: '',
                          })}
                        >
                          {actionTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        {actionDrafts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setActionDrafts((current) => current.filter((item) => item.id !== draft.id))}
                            className="min-w-11 min-h-11 text-xs text-red-600 hover:bg-red-50 rounded-lg"
                            aria-label={`${index + 1}件目を削除`}
                            title="削除"
                          >
                            削除
                          </button>
                        )}
                      </div>

                      {(draft.type === 'add_tag' || draft.type === 'remove_tag') && (
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          value={draft.targetId}
                          onChange={(e) => updateActionDraft(draft.id, { targetId: e.target.value })}
                        >
                          <option value="">タグを選択してください</option>
                          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                        </select>
                      )}

                      {draft.type === 'start_scenario' && (
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          value={draft.targetId}
                          onChange={(e) => updateActionDraft(draft.id, { targetId: e.target.value })}
                        >
                          <option value="">シナリオを選択してください</option>
                          {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
                        </select>
                      )}

                      {draft.type === 'send_message' && (
                        <div className="space-y-2">
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                            value={draft.targetId}
                            onChange={(e) => updateActionDraft(draft.id, { targetId: e.target.value })}
                          >
                            <option value="">直接メッセージを入力する</option>
                            {templates.map((template) => (
                              <option key={template.id} value={template.id}>{template.name}</option>
                            ))}
                          </select>
                          {!draft.targetId && (
                            <textarea
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                              rows={4}
                              placeholder="送信するメッセージ"
                              value={draft.content}
                              onChange={(e) => updateActionDraft(draft.id, { content: e.target.value })}
                            />
                          )}
                        </div>
                      )}

                      {draft.type === 'send_webhook' && (
                        <input
                          type="url"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="https://example.jp/webhook"
                          value={draft.url}
                          onChange={(e) => updateActionDraft(draft.id, { url: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                  <div className="p-3">
                    <button
                      type="button"
                      onClick={() => setActionDrafts((current) => [...current, createActionDraft()])}
                      className="text-sm font-medium text-green-700 hover:text-green-800"
                    >
                      + 実行内容を追加
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2">
                <label className="block text-xs font-medium text-gray-600">対象を絞り込む条件</label>
              </div>
              {advancedConditions ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">このルールには画面で編集できない絞り込み条件があります</p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">保存済みの条件は変更せずに保持します。</p>
                  <TechnicalDetails
                    className="mt-2"
                    items={[{ label: '保存されている条件', value: form.conditionsJson, copyable: true }]}
                  />
                </div>
              ) : isWebinarEventType ? (
                <div className="space-y-2">
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={conditionEventId}
                    onChange={(e) => {
                      setConditionEventId(e.target.value)
                      setConditionCtaItemId('')
                    }}
                    disabled={!selectedAccountId}
                  >
                    <option value="">すべてのウェビナー</option>
                    {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                  </select>
                  {!selectedAccountId && (
                    <p className="text-xs text-amber-700">先にLINEアカウントを選択してください。</p>
                  )}
                  {form.eventType === 'webinar_cta_clicked' && conditionEventId && (
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      value={conditionCtaItemId}
                      onChange={(e) => setConditionCtaItemId(e.target.value)}
                    >
                      <option value="">すべての案内ボタン</option>
                      {ctaItems.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  )}
                </div>
              ) : isTagChangeEventType ? (
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  value={conditionTagId}
                  onChange={(e) => setConditionTagId(e.target.value)}
                >
                  <option value="">すべてのタグ変更</option>
                  {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
              ) : form.eventType === 'score_threshold' ? (
                <div>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="例: 10"
                    value={conditionScore}
                    onChange={(e) => setConditionScore(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500">この点数以上になった友だちが対象です。</p>
                </div>
              ) : form.eventType === 'message_received' ? (
                <div className="space-y-2">
                  <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-50">
                    {([
                      ['exact', '完全一致'],
                      ['contains', '一部を含む'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setConditionKeywordMatch(value)}
                        className={`px-3 py-1.5 text-xs rounded-md ${conditionKeywordMatch === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="例: 作成会希望"
                    value={conditionKeyword}
                    onChange={(e) => setConditionKeyword(e.target.value)}
                  />
                  <p className="text-xs text-gray-500">空欄なら、すべての受信メッセージが対象です。</p>
                </div>
              ) : (
                <p className="px-3 py-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg">
                  このイベントが発生したすべての友だちが対象です。
                </p>
              )}
            </div>

            <details className="border-t border-gray-200 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-gray-600">その他の設定</summary>
              <div className="mt-3 max-w-xs">
                <label className="block text-xs font-medium text-gray-600 mb-1">実行順</label>
                <input
                  type="number"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
                />
                <p className="mt-1 text-xs text-gray-500">数字が大きいルールから先に実行します。通常は0のままで構いません。</p>
              </div>
            </details>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex flex-col sm:flex-row gap-2 sticky bottom-0 bg-white pt-2 pb-1 -mx-4 px-4 sm:static sm:mx-0 sm:px-0 sm:pt-0 sm:pb-0">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : editingId ? '変更を保存' : '作成'}
              </button>
              <button
                onClick={resetEditor}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="p-4 animate-pulse">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-100 rounded w-28" />
                <div className="h-4 bg-gray-100 rounded w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : automations.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <EmptyState
            title="オートメーションがありません"
            description="「新規ルール」から作成してください。"
          />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
          {automations.map((automation) => (
            <div key={automation.id} className="p-4 hover:bg-gray-50">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(200px,1.2fr)_minmax(180px,0.8fr)_minmax(240px,1.4fr)_auto] gap-3 lg:items-center">
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 text-sm font-semibold text-gray-900 leading-5 break-words">{automation.name}</h3>
                  </div>
                  {automation.description && (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-2">{automation.description}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${eventTypeBadgeColor[automation.eventType]}`}>
                    {eventTypeLabelMap[automation.eventType]}
                  </span>
                  <span className={`text-xs font-medium ${automation.isActive ? 'text-green-700' : 'text-gray-500'}`}>
                    {automation.isActive ? '有効' : '無効'}
                  </span>
                </div>

                <div className="space-y-1 min-w-0">
                  {automation.actions.slice(0, 3).map((action, index) => (
                    <p key={`${automation.id}-${index}`} className="text-xs text-gray-600 truncate">
                      {describeAction(action)}
                    </p>
                  ))}
                  {automation.actions.length > 3 && (
                    <p className="text-xs text-gray-400">ほか {automation.actions.length - 3} 件</p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setConfirmTarget({ kind: 'toggle', automation })
                      setConfirmError('')
                    }}
                    className="px-3 py-1 min-h-11 text-xs font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors"
                  >
                    {automation.isActive ? '無効にする' : '有効にする'}
                  </button>
                  <button
                    onClick={() => openEdit(automation)}
                    className="px-3 py-1 min-h-11 text-xs font-medium text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => {
                      setConfirmTarget({ kind: 'delete', automation })
                      setConfirmError('')
                    }}
                    className="px-3 py-1 min-h-11 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmSheet
        open={Boolean(confirmTarget)}
        title={confirmTarget?.kind === 'delete'
          ? 'オートメーションを削除しますか？'
          : confirmTarget?.automation.isActive
            ? 'オートメーションを無効にしますか？'
            : 'オートメーションを有効にしますか？'}
        message={confirmTarget?.kind === 'delete'
          ? `「${confirmTarget.automation.name}」を削除します。この操作は元に戻せません。`
          : confirmTarget?.automation.isActive
            ? `「${confirmTarget?.automation.name ?? ''}」は今後実行されなくなります。`
            : `「${confirmTarget?.automation.name ?? ''}」は、条件を満たした友だちに対して実行されるようになります。`}
        confirmLabel={confirmTarget?.kind === 'delete'
          ? '削除する'
          : confirmTarget?.automation.isActive
            ? '無効にする'
            : '有効にする'}
        tone={confirmTarget?.kind === 'delete' ? 'danger' : 'default'}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={handleConfirmedAction}
        onClose={() => {
          if (confirmBusy) return
          setConfirmTarget(null)
          setConfirmError('')
        }}
      />
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
