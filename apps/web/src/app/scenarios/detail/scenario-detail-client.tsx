'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

import Link from 'next/link'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode } from '@line-crm/shared'
import { api, type SurveySettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import MessageVariableButton from '@/components/message-variable-button'
import ScheduleInput, {
  emptySchedule,
  buildSchedulePayload,
  uiFromOffsetMinutes,
  type ScheduleValue,
} from '@/components/scenarios/schedule-input'
import BulkPreviewModal from '@/components/scenarios/bulk-preview-modal'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }

const triggerOptions: { value: ScenarioTriggerType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加時' },
  { value: 'tag_added', label: 'タグ付与時' },
  { value: 'manual', label: '手動' },
]

const messageTypeOptions: { value: MessageType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'Flex' },
]

const modeBadgeStyle: Record<DeliveryMode, { bg: string; text: string; label: string }> = {
  relative: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Legacy' },
  elapsed: { bg: 'bg-blue-50', text: 'text-blue-700', label: '経過時間' },
  absolute_time: { bg: 'bg-amber-50', text: 'text-amber-700', label: '時刻指定' },
}

type StepConditionType =
  | 'tag_exists'
  | 'tag_not_exists'
  | 'tracked_url_clicked'
  | 'tracked_url_not_clicked'
  | 'incoming_text_contains'
  | 'incoming_text_not_contains'
  | 'metadata_equals'
  | 'metadata_not_equals'

const conditionOptions: { value: StepConditionType; label: string }[] = [
  { value: 'tag_exists', label: 'タグがある' },
  { value: 'tag_not_exists', label: 'タグがない' },
  { value: 'tracked_url_clicked', label: 'URLクリック済み' },
  { value: 'tracked_url_not_clicked', label: 'URL未クリック' },
  { value: 'incoming_text_contains', label: '文言送信済み' },
  { value: 'incoming_text_not_contains', label: '文言未送信' },
  { value: 'metadata_equals', label: 'メタデータ一致' },
  { value: 'metadata_not_equals', label: 'メタデータ不一致' },
]

const conditionLabelMap: Record<StepConditionType, string> = {
  tag_exists: 'タグがある',
  tag_not_exists: 'タグがない',
  tracked_url_clicked: 'URLクリック済み',
  tracked_url_not_clicked: 'URL未クリック',
  incoming_text_contains: '文言送信済み',
  incoming_text_not_contains: '文言未送信',
  metadata_equals: 'メタデータ一致',
  metadata_not_equals: 'メタデータ不一致',
}

function formatConditionLabel(conditionType?: string | null): string | null {
  if (!conditionType) return null
  return conditionLabelMap[conditionType as StepConditionType] ?? conditionType
}

function isTagCondition(conditionType?: string | null): boolean {
  return conditionType === 'tag_exists' || conditionType === 'tag_not_exists'
}

function isTrackedUrlCondition(conditionType?: string | null): boolean {
  return conditionType === 'tracked_url_clicked' || conditionType === 'tracked_url_not_clicked'
}

function isIncomingTextCondition(conditionType?: string | null): boolean {
  return conditionType === 'incoming_text_contains' || conditionType === 'incoming_text_not_contains'
}

function isMetadataCondition(conditionType?: string | null): boolean {
  return conditionType === 'metadata_equals' || conditionType === 'metadata_not_equals'
}

/** 保存された conditionValue (タグID / トラッキングリンクID / メタデータJSON等) を人間可読な表示に逆引きする */
function formatConditionValue(
  conditionType: string | null | undefined,
  conditionValue: string | null | undefined,
  tags: TagOpt[],
  trackedLinks: TrackedLinkOpt[],
): string {
  if (!conditionValue) return ''
  if (isTagCondition(conditionType)) {
    return tags.find((t) => t.id === conditionValue)?.name ?? conditionValue
  }
  if (isTrackedUrlCondition(conditionType)) {
    const link = trackedLinks.find((l) => l.id === conditionValue)
    return link ? (link.name ?? link.originalUrl) : conditionValue
  }
  if (isMetadataCondition(conditionType)) {
    try {
      const parsed = JSON.parse(conditionValue) as { key?: string; value?: unknown }
      return `${parsed.key ?? ''} = ${parsed.value ?? ''}`
    } catch {
      return conditionValue
    }
  }
  return conditionValue
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return '即時'
  if (minutes < 60) return `${minutes}分後`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}時間後` : `${h}時間${m}分後`
  }
  const d = Math.floor(minutes / 1440)
  const remaining = minutes % 1440
  if (remaining === 0) return `${d}日後`
  const h = Math.floor(remaining / 60)
  return h > 0 ? `${d}日${h}時間後` : `${d}日${remaining}分後`
}

function formatScheduleLabel(mode: DeliveryMode | undefined, step: ScenarioStep): string {
  const m = mode ?? 'relative'
  if (m === 'relative') return formatDelay(step.delayMinutes)
  if (m === 'elapsed') {
    const days = step.offsetDays ?? 0
    const mins = step.offsetMinutes ?? 0
    const h = Math.floor(mins / 60)
    const r = mins % 60
    if (days === 0 && mins === 0) return '即時 (購読開始)'
    const parts: string[] = []
    if (days > 0) parts.push(`${days}日`)
    if (h > 0) parts.push(`${h}時間`)
    if (r > 0) parts.push(`${r}分`)
    return `購読開始から${parts.join('')}後`
  }
  // absolute_time
  return `購読開始から${step.offsetDays ?? 0}日後の ${step.deliveryTime ?? '00:00'}`
}

interface StepFormState {
  stepOrder: number
  schedule: ScheduleValue
  messageType: MessageType
  messageContent: string
  templateId: string | null
  surveyId: string | null
  onReachTagId: string | null
  conditionType: string | null
  conditionValue: string
  metadataKey: string
  metadataValueInput: string
  inputMode: 'direct' | 'template' | 'survey'
}

function emptyStepForm(stepOrder: number): StepFormState {
  return {
    stepOrder,
    schedule: { ...emptySchedule },
    messageType: 'text',
    messageContent: '',
    templateId: null,
    surveyId: null,
    onReachTagId: null,
    conditionType: null,
    conditionValue: '',
    metadataKey: '',
    metadataValueInput: '',
    inputMode: 'direct',
  }
}

interface TemplateOpt {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

interface TagOpt {
  id: string
  name: string
}

interface TrackedLinkOpt {
  id: string
  name: string | null
  originalUrl: string
}

interface ScenarioStats {
  enrolledTotal: number
  activeNow: number
  completed: number
  paused: number
  steps: Array<{ stepOrder: number; reachedCount: number; reachRate: number }>
}

function FlexPreview({ content }: { content: string }) {
  return <FlexPreviewComponent content={content} maxWidth={300} />
}

function buildSurveyPostbackData(formId: string, questionIndex: number, answer: string): string {
  return [
    'lh:surveyform',
    encodeURIComponent(formId),
    String(questionIndex),
    encodeURIComponent(answer),
  ].join(':')
}

function buildSurveyFlexContent(survey: SurveySettings): string {
  const question = survey.questions[0]
  if (!question) return ''
  return JSON.stringify({
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'text',
          text: `アンケート 1/${survey.questions.length}`,
          size: 'xs',
          color: '#06C755',
          weight: 'bold',
        },
        {
          type: 'text',
          text: question.label,
          size: 'lg',
          weight: 'bold',
          color: '#111827',
          wrap: true,
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: question.options.map((option) => ({
        type: 'button',
        style: 'primary',
        color: '#06C755',
        height: 'sm',
        action: {
          type: 'postback',
          label: option,
          data: buildSurveyPostbackData(survey.form.id, 0, option),
          displayText: option,
        },
      })),
    },
  })
}

function getSurveyIdFromContent(content: string): string | null {
  const match = content.match(/lh:(?:surveyform|regsurvey):([^:"]+)/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function getSurveyFromContent(content: string, surveys: SurveySettings[]): SurveySettings | null {
  const surveyId = getSurveyIdFromContent(content)
  return surveyId ? surveys.find((survey) => survey.form.id === surveyId) ?? null : null
}

function ImagePreview({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content)
    const url = parsed.previewImageUrl || parsed.originalContentUrl
    return (
      <div>
        <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded mb-2 inline-block">画像</span>
        {url ? (
          <img src={url} alt="preview" className="max-w-[200px] rounded-lg border border-gray-200 mt-1" />
        ) : (
          <p className="text-xs text-gray-400">プレビューなし</p>
        )}
      </div>
    )
  } catch {
    return <p className="text-xs text-red-500">画像 JSON パースエラー</p>
  }
}

export default function ScenarioDetailClient({ scenarioId }: { scenarioId: string }) {
  const id = scenarioId
  const { selectedAccountId } = useAccount()

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', triggerType: 'friend_add' as ScenarioTriggerType, isActive: true })
  const [saving, setSaving] = useState(false)

  const [showStepForm, setShowStepForm] = useState(false)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>(() => emptyStepForm(1))
  const [stepSaving, setStepSaving] = useState(false)
  const [stepError, setStepError] = useState('')
  const stepMessageRef = useRef<HTMLTextAreaElement | null>(null)

  const [previewOpen, setPreviewOpen] = useState(false)

  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [templates, setTemplates] = useState<TemplateOpt[]>([])
  const [tags, setTags] = useState<TagOpt[]>([])
  const [surveys, setSurveys] = useState<SurveySettings[]>([])
  const [trackedLinks, setTrackedLinks] = useState<TrackedLinkOpt[]>([])

  // テスト送信: ステップごとの送信中フラグ / 結果メッセージ
  const [testSendingStepId, setTestSendingStepId] = useState<string | null>(null)
  const [testSendMessages, setTestSendMessages] = useState<Record<string, string>>({})

  // テスト受信者未設定時の簡易登録モーダル
  const [recipientModalOpen, setRecipientModalOpen] = useState(false)
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipientResults, setRecipientResults] = useState<Array<{ id: string; displayName: string | null }>>([])
  const [recipientSearching, setRecipientSearching] = useState(false)
  const [recipientSelected, setRecipientSelected] = useState<Set<string>>(new Set())
  const [recipientSaving, setRecipientSaving] = useState(false)
  const [recipientError, setRecipientError] = useState('')
  const pendingTestStepIdRef = useRef<string | null>(null)

  const deliveryMode: DeliveryMode = (scenario?.deliveryMode ?? 'relative') as DeliveryMode

  const loadScenario = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.get(id)
      if (res.success) {
        setScenario(res.data)
        setEditForm({
          name: res.data.name,
          description: res.data.description ?? '',
          triggerType: res.data.triggerType,
          isActive: res.data.isActive,
        })
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadScenario()
  }, [loadScenario])

  // 並列で stats / templates / tags / トラッキングリンクを取得（リグレッションを起こさないよう失敗は無視）
  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api.scenarios.stats(id).catch(() => null),
      api.templates.list().catch(() => null),
      api.tags.list().catch(() => null),
      api.surveys.list().catch(() => null),
      api.trackedLinks.list().catch(() => null),
    ]).then(([statsRes, tplRes, tagRes, surveysRes, linkRes]) => {
      if (cancelled) return
      if (statsRes && statsRes.success) setStats(statsRes.data)
      if (tplRes && tplRes.success) {
        setTemplates(tplRes.data.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          messageType: t.messageType,
          messageContent: t.messageContent,
        })))
      }
      if (tagRes && tagRes.success) {
        setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      }
      if (surveysRes && surveysRes.success) {
        setSurveys(surveysRes.data)
      }
      if (linkRes && linkRes.success) {
        setTrackedLinks(linkRes.data.map((l) => ({ id: l.id, name: l.name, originalUrl: l.originalUrl })))
      }
    })
    return () => { cancelled = true }
  }, [id])

  const reloadStats = useCallback(() => {
    api.scenarios.stats(id).then((r) => { if (r.success) setStats(r.data) }).catch(() => {})
  }, [id])

  const handleSaveScenario = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      const res = await api.scenarios.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        triggerType: editForm.triggerType,
        isActive: editForm.isActive,
      })
      if (res.success) {
        setEditing(false)
        loadScenario()
      } else {
        setError(res.error)
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const openAddStep = () => {
    const nextOrder = scenario ? (scenario.steps.length > 0 ? Math.max(...scenario.steps.map(s => s.stepOrder)) + 1 : 1) : 1
    setStepForm(emptyStepForm(nextOrder))
    setEditingStepId(null)
    setShowStepForm(true)
    setStepError('')
  }

  const openEditStep = (step: ScenarioStep) => {
    const ui = uiFromOffsetMinutes(step.offsetMinutes)
    const surveyId = getSurveyIdFromContent(step.messageContent)
    let metadataKey = ''
    let metadataValueInput = ''
    if (isMetadataCondition(step.conditionType) && step.conditionValue) {
      try {
        const parsed = JSON.parse(step.conditionValue) as { key?: string; value?: unknown }
        metadataKey = parsed.key ?? ''
        metadataValueInput = parsed.value !== undefined ? String(parsed.value) : ''
      } catch {
        // 手書き時代の壊れた JSON 等。キー/値は空のまま、生値は他 UI で確認できる。
      }
    }
    setStepForm({
      stepOrder: step.stepOrder,
      schedule: {
        delayMinutes: step.delayMinutes,
        offsetDays: step.offsetDays ?? 0,
        offsetHours: ui.offsetHours,
        offsetMinutesRemainder: ui.offsetMinutesRemainder,
        deliveryTime: step.deliveryTime ?? '09:00',
      },
      messageType: step.messageType,
      messageContent: step.messageContent,
      templateId: step.templateId ?? null,
      surveyId,
      onReachTagId: step.onReachTagId ?? null,
      conditionType: step.conditionType ?? null,
      conditionValue: step.conditionValue ?? '',
      metadataKey,
      metadataValueInput,
      inputMode: surveyId ? 'survey' : step.templateId ? 'template' : 'direct',
    })
    setEditingStepId(step.id)
    setShowStepForm(true)
    setStepError('')
  }

  const handleSaveStep = async () => {
    // 直接入力モード: messageContent 必須 + Flex/画像 は JSON parse 検証
    if (stepForm.inputMode === 'survey') {
      if (!stepForm.surveyId) {
        setStepError('アンケートを選択してください')
        return
      }
      const survey = surveys.find((item) => item.form.id === stepForm.surveyId)
      if (!survey || survey.questions.length === 0) {
        setStepError('選択したアンケートに質問がありません')
        return
      }
    } else if (stepForm.inputMode === 'direct') {
      if (!stepForm.messageContent.trim()) {
        setStepError('メッセージ内容を入力してください')
        return
      }
      if (stepForm.messageType === 'flex' || stepForm.messageType === 'image') {
        try {
          JSON.parse(stepForm.messageContent)
        } catch {
          setStepError(
            stepForm.messageType === 'flex'
              ? 'Flex メッセージの JSON が不正です'
              : '画像メッセージの JSON が不正です',
          )
          return
        }
      }
    } else {
      if (!stepForm.templateId) {
        setStepError('テンプレートを選択してください')
        return
      }
    }
    if (isMetadataCondition(stepForm.conditionType)) {
      if (!stepForm.metadataKey.trim()) {
        setStepError('メタデータのキーを入力してください')
        return
      }
    } else if (stepForm.conditionType && !stepForm.conditionValue.trim()) {
      setStepError('配信条件の値を入力してください')
      return
    }
    setStepSaving(true)
    setStepError('')
    try {
      const schedulePayload = buildSchedulePayload(deliveryMode, stepForm.schedule)
      // テンプレモード保存時は、選択中テンプレ内容を scenario_steps の messageType /
      // messageContent にスナップショットコピーする。テンプレ削除時に resolveStepContent
      // がここから正しい内容にフォールバックできるため。
      let payloadMessageType: MessageType = stepForm.messageType
      let payloadMessageContent: string = stepForm.messageContent || ' '
      if (stepForm.inputMode === 'template' && stepForm.templateId) {
        const tpl = templates.find((t) => t.id === stepForm.templateId)
        if (tpl) {
          // messageType: テンプレが image/carousel のときは scenario_steps の CHECK に
          // ('text','image','flex') の制約があるため text/image/flex のみ許容。
          // carousel が来る可能性は低いが念のため text にフォールバック。
          payloadMessageType = (['text', 'image', 'flex'].includes(tpl.messageType)
            ? tpl.messageType
            : 'text') as MessageType
          payloadMessageContent = tpl.messageContent || ' '
        }
      }
      if (stepForm.inputMode === 'survey' && stepForm.surveyId) {
        const survey = surveys.find((item) => item.form.id === stepForm.surveyId)
        if (survey) {
          payloadMessageType = 'flex'
          payloadMessageContent = buildSurveyFlexContent(survey) || ' '
        }
      }
      // メタデータ条件は「キー」「値」の2入力から JSON を組み立てる (手書きJSON廃止)。
      // それ以外の条件は conditionValue (テキスト入力 or プルダウン選択値) をそのまま使う。
      const conditionValueToSave = !stepForm.conditionType
        ? null
        : isMetadataCondition(stepForm.conditionType)
          ? JSON.stringify({ key: stepForm.metadataKey.trim(), value: stepForm.metadataValueInput })
          : stepForm.conditionValue.trim()
      const payload = {
        stepOrder: stepForm.stepOrder,
        ...schedulePayload,
        messageType: payloadMessageType,
        messageContent: payloadMessageContent,
        templateId: stepForm.inputMode === 'template' ? stepForm.templateId : null,
        onReachTagId: stepForm.onReachTagId,
        conditionType: stepForm.conditionType,
        conditionValue: conditionValueToSave,
      }
      if (editingStepId) {
        const res = await api.scenarios.updateStep(id, editingStepId, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      } else {
        const res = await api.scenarios.addStep(id, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      }
      setShowStepForm(false)
      setEditingStepId(null)
      loadScenario()
      reloadStats()
    } catch {
      setStepError('ステップの保存に失敗しました')
    } finally {
      setStepSaving(false)
    }
  }

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('このステップを削除してもよいですか？')) return
    try {
      await api.scenarios.deleteStep(id, stepId)
      loadScenario()
    } catch {
      setError('ステップの削除に失敗しました')
    }
  }

  const handleMoveStep = async (stepId: string, direction: 'up' | 'down') => {
    if (!scenario) return
    const sorted = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
    const idx = sorted.findIndex((s) => s.id === stepId)
    const swap = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swap < 0 || swap >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swap]
    try {
      await api.scenarios.reorderSteps(id, [
        { stepId: a.id, stepOrder: b.stepOrder },
        { stepId: b.id, stepOrder: a.stepOrder },
      ])
      loadScenario()
      // 到達率バッジは stepOrder ベースでマッチングするので、並び替え後は stats も再取得
      reloadStats()
    } catch {
      setError('並び替えに失敗しました')
    }
  }

  /** mode に応じて既存ステップの schedule フィールドを addStep 用ペイロードに変換する */
  function scheduleFromStep(mode: DeliveryMode, step: ScenarioStep) {
    if (mode === 'relative') return { delayMinutes: step.delayMinutes }
    if (mode === 'elapsed') return { offsetDays: step.offsetDays ?? 0, offsetMinutes: step.offsetMinutes ?? 0 }
    return { offsetDays: step.offsetDays ?? 0, deliveryTime: step.deliveryTime ?? '09:00' }
  }

  const handleDuplicateStep = async (step: ScenarioStep) => {
    if (!scenario) return
    const sorted = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
    // 複製先 (step.stepOrder + 1) を空けるため、それ以降のステップを +1 ずらす
    const toShift = sorted.filter((s) => s.stepOrder > step.stepOrder)
    try {
      if (toShift.length > 0) {
        await api.scenarios.reorderSteps(id, toShift.map((s) => ({ stepId: s.id, stepOrder: s.stepOrder + 1 })))
      }
      const res = await api.scenarios.addStep(id, {
        stepOrder: step.stepOrder + 1,
        ...scheduleFromStep(deliveryMode, step),
        messageType: step.messageType,
        messageContent: step.messageContent,
        templateId: step.templateId,
        onReachTagId: step.onReachTagId,
        conditionType: step.conditionType,
        conditionValue: step.conditionValue,
      })
      if (!res.success) {
        setError('ステップの複製に失敗しました')
        return
      }
      loadScenario()
      reloadStats()
    } catch {
      setError('ステップの複製に失敗しました')
    }
  }

  const handleTestSend = async (stepId: string) => {
    setTestSendingStepId(stepId)
    setTestSendMessages((prev) => ({ ...prev, [stepId]: '' }))
    try {
      const accountId = scenario?.lineAccountId ?? selectedAccountId ?? undefined
      const res = await api.scenarios.testSendStep(id, stepId, accountId)
      if (res.success) {
        setTestSendMessages((prev) => ({ ...prev, [stepId]: `${res.sent ?? 0}人に送信しました` }))
      } else if (res.error === 'no_test_recipients') {
        setTestSendMessages((prev) => ({
          ...prev,
          [stepId]: 'テスト受信者が未設定です。設定画面から登録してください',
        }))
        openRecipientModal(stepId, accountId)
      } else {
        setTestSendMessages((prev) => ({ ...prev, [stepId]: res.error || '送信に失敗しました' }))
      }
    } catch {
      setTestSendMessages((prev) => ({ ...prev, [stepId]: '送信に失敗しました' }))
    } finally {
      setTestSendingStepId(null)
    }
  }

  // ── テスト受信者 未設定時の簡易登録モーダル ──────────────────────────────
  const recipientAccountIdRef = useRef<string | undefined>(undefined)

  const searchFriendsForRecipientModal = useCallback(async (query: string) => {
    setRecipientSearching(true)
    try {
      const res = await api.friends.list({ search: query || undefined, limit: 20, includeTags: false })
      if (res.success) {
        setRecipientResults(res.data.items.map((f) => ({ id: f.id, displayName: f.displayName })))
      }
    } catch {
      // 検索失敗は無視 (一覧が更新されないだけ)
    } finally {
      setRecipientSearching(false)
    }
  }, [])

  function openRecipientModal(stepId: string, accountId?: string) {
    if (!accountId) {
      // グローバルシナリオでアカウント未選択の場合、どのアカウントの
      // test_recipients を編集すべきか判断できないためモーダルは出さない。
      return
    }
    pendingTestStepIdRef.current = stepId
    recipientAccountIdRef.current = accountId
    setRecipientError('')
    setRecipientQuery('')
    setRecipientSelected(new Set())
    setRecipientModalOpen(true)
    api.accountSettings.getTestRecipients(accountId).then((res) => {
      if (res.success) {
        setRecipientSelected(new Set(res.data.map((f) => f.id)))
      }
    }).catch(() => {})
    searchFriendsForRecipientModal('')
  }

  function closeRecipientModal() {
    setRecipientModalOpen(false)
    pendingTestStepIdRef.current = null
  }

  function toggleRecipientSelected(friendId: string) {
    setRecipientSelected((prev) => {
      const next = new Set(prev)
      if (next.has(friendId)) next.delete(friendId)
      else next.add(friendId)
      return next
    })
  }

  const handleSaveRecipients = async () => {
    const accountId = recipientAccountIdRef.current
    if (!accountId) return
    setRecipientSaving(true)
    setRecipientError('')
    try {
      const res = await api.accountSettings.updateTestRecipients(accountId, Array.from(recipientSelected))
      if (!res.success) {
        setRecipientError('保存に失敗しました')
        return
      }
      const stepId = pendingTestStepIdRef.current
      closeRecipientModal()
      // 登録直後に、元々テスト送信しようとしていたステップへ自動で再送する
      if (stepId) {
        handleTestSend(stepId)
      }
    } catch {
      setRecipientError('保存に失敗しました')
    } finally {
      setRecipientSaving(false)
    }
  }

  // 検索欄の入力をデバウンスして再検索 (モーダルが開いている間のみ)
  useEffect(() => {
    if (!recipientModalOpen) return
    const timer = setTimeout(() => {
      searchFriendsForRecipientModal(recipientQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [recipientQuery, recipientModalOpen, searchFriendsForRecipientModal])

  if (loading) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-white rounded-lg border border-gray-200 p-8 animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-2/3" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!scenario) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">{error || 'シナリオが見つかりません'}</p>
          <Link href="/scenarios" className="text-sm text-green-600 hover:text-green-700 mt-4 inline-block">
            ← シナリオ一覧に戻る
          </Link>
        </div>
      </div>
    )
  }

  const sortedSteps = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const modeBadge = modeBadgeStyle[deliveryMode]

  return (
    <div>
      <Header
        title="シナリオ詳細"
        action={
          <Link
            href="/scenarios"
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors inline-flex items-center"
          >
            ← シナリオ一覧
          </Link>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Stats Header Bar */}
      {stats && stats.enrolledTotal > 0 && (
        <div className="mb-4 bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm flex-wrap">
          <span className="font-medium text-gray-700">📊 集計</span>
          <span>登録 <span className="font-semibold">{stats.enrolledTotal}</span> 人</span>
          <span className="text-gray-400">/</span>
          <span>進行中 <span className="font-semibold text-blue-700">{stats.activeNow}</span></span>
          <span className="text-gray-400">/</span>
          <span>完了 <span className="font-semibold text-green-700">{stats.completed}</span></span>
          {stats.paused > 0 && (
            <>
              <span className="text-gray-400">/</span>
              <span>一時停止 {stats.paused}</span>
            </>
          )}
        </div>
      )}

      {/* Scenario Info */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        {editing ? (
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">シナリオ名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">トリガー</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={editForm.triggerType}
                onChange={(e) => setEditForm({ ...editForm, triggerType: e.target.value as ScenarioTriggerType })}
              >
                {triggerOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="editIsActive"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <label htmlFor="editIsActive" className="text-sm text-gray-600">有効</label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveScenario}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : '基本情報を保存'}
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setEditForm({
                    name: scenario.name,
                    description: scenario.description ?? '',
                    triggerType: scenario.triggerType,
                    isActive: scenario.isActive,
                  })
                }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-4 mb-3">
              <h2 className="text-lg font-semibold text-gray-900">{scenario.name}</h2>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${modeBadge.bg} ${modeBadge.text}`}>
                  {modeBadge.label}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    scenario.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {scenario.isActive ? '有効' : '無効'}
                </span>
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs font-medium text-green-600 hover:text-green-700 px-3 py-1.5 rounded-md hover:bg-green-50 transition-colors"
                >
                  基本情報を編集
                </button>
              </div>
            </div>
            {scenario.description && (
              <p className="text-sm text-gray-500 mb-3">{scenario.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
              <span>トリガー: {triggerOptions.find(o => o.value === scenario.triggerType)?.label ?? scenario.triggerType}</span>
              <span>ステップ数: {scenario.steps.length}</span>
              <span>作成日: {new Date(scenario.createdAt).toLocaleDateString('ja-JP')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800">ステップ一覧</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={sortedSteps.length === 0}
              className="px-3 py-1.5 min-h-[44px] text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40"
            >
              一括プレビュー
            </button>
            <button
              onClick={openAddStep}
              className="px-3 py-1.5 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              + ステップ追加
            </button>
          </div>
        </div>

        {/* Step form */}
        {showStepForm && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-3">
              {editingStepId ? '本文・条件を編集' : '新しいステップを追加'}
            </h4>
            <div className="space-y-3 max-w-lg">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ステップ順序</label>
                <input
                  type="number"
                  min={1}
                  className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={stepForm.stepOrder}
                  onChange={(e) => setStepForm({ ...stepForm, stepOrder: Number(e.target.value) })}
                />
              </div>
              <ScheduleInput
                mode={deliveryMode}
                value={stepForm.schedule}
                onChange={(schedule) => setStepForm({ ...stepForm, schedule })}
              />

              {/* 入力モード切替: 直接入力 / テンプレート参照 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">メッセージの指定方法</label>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={stepForm.inputMode === 'direct'}
                      onChange={() => setStepForm({ ...stepForm, inputMode: 'direct', templateId: null, surveyId: null })}
                    />
                    <span>直接入力</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={stepForm.inputMode === 'template'}
                      onChange={() => setStepForm({ ...stepForm, inputMode: 'template', surveyId: null })}
                    />
                    <span>テンプレートを使う</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={stepForm.inputMode === 'survey'}
                      onChange={() => setStepForm({
                        ...stepForm,
                        inputMode: 'survey',
                        templateId: null,
                        surveyId: stepForm.surveyId ?? surveys[0]?.form.id ?? null,
                      })}
                    />
                    <span>アンケートを使う</span>
                  </label>
                </div>
              </div>

              {stepForm.inputMode === 'template' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">テンプレート <span className="text-red-500">*</span></label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={stepForm.templateId ?? ''}
                    onChange={(e) => setStepForm({ ...stepForm, templateId: e.target.value || null })}
                  >
                    <option value="">-- 選択してください --</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}</option>
                    ))}
                  </select>
                  <p className="text-xs text-amber-700 mt-1">
                    ⓘ テンプレートが修正されると、このステップの内容も自動で同期されます
                  </p>
                </div>
              )}

              {stepForm.inputMode === 'survey' && (() => {
                const selectedSurvey = surveys.find((survey) => survey.form.id === stepForm.surveyId) ?? null
                const previewContent = selectedSurvey ? buildSurveyFlexContent(selectedSurvey) : ''
                return (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">アンケート <span className="text-red-500">*</span></label>
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                        value={stepForm.surveyId ?? ''}
                        onChange={(e) => setStepForm({ ...stepForm, surveyId: e.target.value || null })}
                      >
                        <option value="">-- 選択してください --</option>
                        {surveys.map((survey) => (
                          <option key={survey.form.id} value={survey.form.id}>{survey.form.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      {previewContent ? (
                        <FlexPreview content={previewContent} />
                      ) : (
                        <p className="text-xs text-gray-500">アンケートがありません</p>
                      )}
                    </div>
                    <Link href="/surveys" className="inline-flex text-xs font-medium text-green-700 hover:underline">
                      アンケートを編集
                    </Link>
                  </div>
                )
              })()}

              {stepForm.inputMode === 'direct' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">メッセージタイプ</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      value={stepForm.messageType}
                      onChange={(e) => setStepForm({ ...stepForm, messageType: e.target.value as MessageType })}
                    >
                      {messageTypeOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-xs font-medium text-gray-600">メッセージ内容 <span className="text-red-500">*</span></label>
                      {stepForm.messageType !== 'image' && (
                        <MessageVariableButton
                          targetRef={stepMessageRef}
                          value={stepForm.messageContent}
                          onChange={(nextValue) => setStepForm({ ...stepForm, messageContent: nextValue })}
                        />
                      )}
                    </div>
                    <textarea
                      ref={stepMessageRef}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                      rows={4}
                      placeholder="メッセージ内容を入力..."
                      value={stepForm.messageContent}
                      onChange={(e) => setStepForm({ ...stepForm, messageContent: e.target.value })}
                    />
                  </div>
                </>
              )}

              {/* 配信条件 */}
              <div className="pt-3 border-t border-gray-200 space-y-2">
                <h4 className="text-xs font-semibold text-gray-700">配信条件</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">このステップを送る相手</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={stepForm.conditionType ?? ''}
                    onChange={(e) => {
                      const nextType = e.target.value || null
                      setStepForm({
                        ...stepForm,
                        conditionType: nextType,
                        conditionValue: nextType ? stepForm.conditionValue : '',
                      })
                    }}
                  >
                    <option value="">全員に送る</option>
                    {conditionOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    {stepForm.conditionType && !conditionOptions.some((opt) => opt.value === stepForm.conditionType) && (
                      <option value={stepForm.conditionType}>既存条件: {formatConditionLabel(stepForm.conditionType)}</option>
                    )}
                  </select>
                </div>
                {stepForm.conditionType && isTagCondition(stepForm.conditionType) && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">対象タグ</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      value={stepForm.conditionValue}
                      onChange={(e) => setStepForm({ ...stepForm, conditionValue: e.target.value })}
                    >
                      <option value="">-- 選択してください --</option>
                      {tags.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {stepForm.conditionType && isTrackedUrlCondition(stepForm.conditionType) && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">対象トラッキングリンク</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      value={stepForm.conditionValue}
                      onChange={(e) => setStepForm({ ...stepForm, conditionValue: e.target.value })}
                    >
                      <option value="">-- 選択してください --</option>
                      {trackedLinks.map((l) => (
                        <option key={l.id} value={l.id}>{l.name ?? l.originalUrl}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-0.5">
                      作成会リンクを押した人には翌日追撃を送らない、という分岐に使います
                    </p>
                  </div>
                )}
                {stepForm.conditionType && isIncomingTextCondition(stepForm.conditionType) && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">対象文言</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="例: 作成会希望"
                      value={stepForm.conditionValue}
                      onChange={(e) => setStepForm({ ...stepForm, conditionValue: e.target.value })}
                    />
                    <p className="text-xs text-gray-400 mt-0.5">
                      作成会希望など、指定した文言を送っていない人だけに追撃する場合に使います
                    </p>
                  </div>
                )}
                {stepForm.conditionType && isMetadataCondition(stepForm.conditionType) && (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">メタデータのキー</label>
                      <input
                        type="text"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="例: industry"
                        value={stepForm.metadataKey}
                        onChange={(e) => setStepForm({ ...stepForm, metadataKey: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">値</label>
                      <input
                        type="text"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="例: 弁護士"
                        value={stepForm.metadataValueInput}
                        onChange={(e) => setStepForm({ ...stepForm, metadataValueInput: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 到達時のアクション */}
              <div className="pt-3 border-t border-gray-200 space-y-2">
                <h4 className="text-xs font-semibold text-gray-700">到達時のアクション</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">到達したらタグ付与</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={stepForm.onReachTagId ?? ''}
                    onChange={(e) => setStepForm({ ...stepForm, onReachTagId: e.target.value || null })}
                  >
                    <option value="">-- なし --</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-0.5">
                    このステップが配信完了したら、選んだタグを友だちに付与します
                  </p>
                </div>
              </div>

              {stepError && <p className="text-xs text-red-600">{stepError}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleSaveStep}
                  disabled={stepSaving}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {stepSaving ? '保存中...' : editingStepId ? 'ステップを更新' : 'ステップを追加'}
                </button>
                <button
                  onClick={() => { setShowStepForm(false); setEditingStepId(null); setStepError('') }}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Steps list */}
        {sortedSteps.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            ステップがありません。「+ ステップ追加」から追加してください。
          </div>
        ) : (
          <div className="space-y-3">
            {sortedSteps.map((step, idx) => (
              <div
                key={step.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white shrink-0"
                        style={{ backgroundColor: '#06C755' }}
                      >
                        {step.stepOrder}
                      </span>
                      <span className="text-xs text-gray-500">{formatScheduleLabel(deliveryMode, step)}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        step.messageType === 'text' ? 'bg-blue-50 text-blue-600' :
                        step.messageType === 'image' ? 'bg-purple-50 text-purple-600' :
                        'bg-orange-50 text-orange-600'
                      }`}>
                        {messageTypeOptions.find(o => o.value === step.messageType)?.label ?? step.messageType}
                      </span>
                      {getSurveyFromContent(step.messageContent, surveys) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                          アンケート
                        </span>
                      )}
                      {step.conditionType && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                          条件: {formatConditionLabel(step.conditionType)}
                        </span>
                      )}
                      {(() => {
                        const stat = stats?.steps.find((s) => s.stepOrder === step.stepOrder)
                        return stat ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">
                            📊 {stat.reachedCount}人到達 ({Math.round(stat.reachRate * 100)}%)
                          </span>
                        ) : null
                      })()}
                    </div>
                    {(() => {
                      // テンプレ参照時は、表示も「現在のテンプレ内容」を見せる。
                      // (templates state には list で取得済みの最新内容が入っている)
                      const survey = getSurveyFromContent(step.messageContent, surveys)
                      const tpl = step.templateId ? templates.find((t) => t.id === step.templateId) : null
                      const displayType = survey ? 'flex' : tpl ? tpl.messageType : step.messageType
                      const displayContent = survey ? buildSurveyFlexContent(survey) : tpl ? tpl.messageContent : step.messageContent
                      return (
                        <div className="text-sm text-gray-700 bg-gray-50 rounded-md px-3 py-2">
                          {displayType === 'text' ? (
                            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                          ) : displayType === 'flex' ? (
                            <FlexPreview content={displayContent} />
                          ) : displayType === 'image' ? (
                            <ImagePreview content={displayContent} />
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                          )}
                        </div>
                      )
                    })()}
                    {step.templateId && (
                      <p className="mt-2 text-xs text-amber-700">
                        📋 テンプレ: {templates.find((t) => t.id === step.templateId)?.name ?? step.templateId}
                      </p>
                    )}
                    {(() => {
                      const survey = getSurveyFromContent(step.messageContent, surveys)
                      return survey ? (
                        <p className="mt-2 text-xs text-green-700">
                          アンケート: {survey.form.name}
                        </p>
                      ) : null
                    })()}
                    {step.onReachTagId && (
                      <p className="mt-1 text-xs text-green-700">
                        🏷 到達タグ: {tags.find((t) => t.id === step.onReachTagId)?.name ?? step.onReachTagId}
                      </p>
                    )}
                    {step.conditionType && step.conditionValue && (
                      <p className="mt-1 text-xs text-amber-700">
                        配信条件: {formatConditionLabel(step.conditionType)} / {formatConditionValue(step.conditionType, step.conditionValue, tags, trackedLinks)}
                      </p>
                    )}
                    {testSendMessages[step.id] && (
                      <p className="mt-1 text-xs text-blue-700">{testSendMessages[step.id]}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-stretch gap-1 shrink-0">
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleMoveStep(step.id, 'up')}
                        disabled={idx === 0}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMoveStep(step.id, 'down')}
                        disabled={idx === sortedSteps.length - 1}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      onClick={() => handleTestSend(step.id)}
                      disabled={testSendingStepId === step.id}
                      className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      {testSendingStepId === step.id ? '送信中...' : 'テスト送信'}
                    </button>
                    <button
                      onClick={() => handleDuplicateStep(step)}
                      className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                    >
                      複製
                    </button>
                    <button
                      onClick={() => openEditStep(step)}
                      className="text-xs text-green-600 hover:text-green-700 px-2 py-1 rounded hover:bg-green-50 transition-colors"
                    >
                      本文・条件を編集
                    </button>
                    <button
                      onClick={() => handleDeleteStep(step.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BulkPreviewModal
        open={previewOpen}
        scenarioId={id}
        onClose={() => setPreviewOpen(false)}
      />

      {/* テスト受信者 未設定時の簡易登録モーダル */}
      {recipientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">テスト受信者を選択</h3>
            <p className="text-xs text-gray-500">
              検索して友だちを選び、保存すると自動でテスト送信を再実行します。
            </p>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="名前で検索..."
              value={recipientQuery}
              onChange={(e) => setRecipientQuery(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {recipientSearching ? (
                <p className="p-3 text-xs text-gray-400">検索中...</p>
              ) : recipientResults.length === 0 ? (
                <p className="p-3 text-xs text-gray-400">該当する友だちがいません</p>
              ) : (
                recipientResults.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={recipientSelected.has(f.id)}
                      onChange={() => toggleRecipientSelected(f.id)}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span>{f.displayName || '(名前未設定)'}</span>
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-gray-500">選択中: {recipientSelected.size}人</p>
            {recipientError && <p className="text-xs text-red-600">{recipientError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveRecipients}
                disabled={recipientSaving || recipientSelected.size === 0}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {recipientSaving ? '保存中...' : '保存してテスト送信'}
              </button>
              <button
                onClick={closeRecipientModal}
                disabled={recipientSaving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
