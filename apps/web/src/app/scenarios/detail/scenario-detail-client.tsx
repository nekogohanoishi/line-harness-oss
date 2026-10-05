'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

import Link from 'next/link'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode } from '@line-crm/shared'
import { api, type SurveySettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import MessageVariableButton from '@/components/message-variable-button'
import FlexBuilder from '@/components/flex-builder/flex-builder'
import ScheduleInput, {
  emptySchedule,
  buildSchedulePayload,
  uiFromOffsetMinutes,
  type ScheduleValue,
} from '@/components/scenarios/schedule-input'
import BulkPreviewModal from '@/components/scenarios/bulk-preview-modal'
import ActionMenu from '@/components/scenarios/action-menu'
import EditSheet from '@/components/scenarios/edit-sheet'
import ScenarioStatusSheet from '@/components/scenarios/scenario-status-sheet'
import ScenarioParticipants from '@/components/scenarios/scenario-participants'
import { ConfirmSheet, Sheet, SheetButton } from '@/components/ui'
import { MessageBubble, TalkArea, TalkStep, TalkTimeline } from '@/components/messages/talk-preview'
import { stepConditionText, stepTimingLabel } from '@/lib/delivery-labels'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }
type ScenarioWithCount = Scenario & { stepCount?: number }

const triggerOptions: { value: ScenarioTriggerType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加時' },
  { value: 'tag_added', label: 'タグ付与時' },
  { value: 'manual', label: '手動' },
]

const messageTypeOptions: { value: MessageType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'カード型' },
]

const modeBadgeStyle: Record<DeliveryMode, { bg: string; text: string; label: string }> = {
  relative: { bg: 'bg-gray-100', text: 'text-gray-600', label: '前のステップから待機' },
  elapsed: { bg: 'bg-blue-50', text: 'text-blue-700', label: '開始からの経過時間' },
  absolute_time: { bg: 'bg-amber-50', text: 'text-amber-700', label: '指定時刻' },
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


/** Flex JSON から最初のテキストを拾う (折りたたみ見出しの本文冒頭に使う) */
function firstFlexText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const obj = node as Record<string, unknown>
  if (obj.type === 'text' && typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim()
  for (const key of ['header', 'hero', 'body', 'footer', 'contents']) {
    const child = obj[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = firstFlexText(item)
        if (found) return found
      }
    } else if (child) {
      const found = firstFlexText(child)
      if (found) return found
    }
  }
  return ''
}

/** 折りたたんだステップカードの見出しに出す本文の冒頭 */
function buildStepSnippet(messageType: string, content: string): string {
  const truncate = (text: string) => (text.length > 44 ? `${text.slice(0, 44)}…` : text)
  const readable = (text: string) => text.replaceAll('{{name}}', '［友だちの表示名］')
  if (messageType === 'flex') {
    try {
      const text = firstFlexText(JSON.parse(content))
      return text ? truncate(readable(text).replace(/\s+/g, ' ')) : 'カード型メッセージ'
    } catch {
      return 'カード型メッセージ'
    }
  }
  if (messageType === 'image') return '画像メッセージ'
  const oneLine = readable(content).replace(/\s+/g, ' ').trim()
  return oneLine ? truncate(oneLine) : '(本文なし)'
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

export default function ScenarioDetailClient({ scenarioId }: { scenarioId: string }) {
  const id = scenarioId
  const { accounts, selectedAccountId } = useAccount()

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    triggerType: 'friend_add' as ScenarioTriggerType,
    triggerTagId: '',
  })
  const [saving, setSaving] = useState(false)
  const [statusSheetOpen, setStatusSheetOpen] = useState(false)
  const [statusConflict, setStatusConflict] = useState<ScenarioWithCount | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState('')

  const [showStepForm, setShowStepForm] = useState(false)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>(() => emptyStepForm(1))
  const [stepSaving, setStepSaving] = useState(false)
  const [stepError, setStepError] = useState('')
  const [deleteStepTarget, setDeleteStepTarget] = useState<ScenarioStep | null>(null)
  const [stepActionBusy, setStepActionBusy] = useState(false)
  const [deleteStepError, setDeleteStepError] = useState('')
  const stepMessageRef = useRef<HTMLTextAreaElement | null>(null)

  const [previewOpen, setPreviewOpen] = useState(false)

  // モバイルでのステップ折りたたみ状態。デスクトップ (>= md) は CSS で常に展開するため、
  // この state が効くのは md 未満の幅だけ。
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(new Set())
  const toggleStepExpanded = (stepId: string) => {
    setExpandedStepIds((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [templates, setTemplates] = useState<TemplateOpt[]>([])
  const [tags, setTags] = useState<TagOpt[]>([])
  const [surveys, setSurveys] = useState<SurveySettings[]>([])
  const [trackedLinks, setTrackedLinks] = useState<TrackedLinkOpt[]>([])

  // テスト送信: ステップごとの送信中フラグ / 結果メッセージ
  const [testSendingStepId, setTestSendingStepId] = useState<string | null>(null)
  const [testSendMessages, setTestSendMessages] = useState<Record<string, string>>({})
  const [testConfirmStep, setTestConfirmStep] = useState<ScenarioStep | null>(null)
  const [testConfirmRecipients, setTestConfirmRecipients] = useState<Array<{ id: string; displayName: string }>>([])
  const [testConfirmAccountId, setTestConfirmAccountId] = useState<string | null>(null)
  const [testConfirmPreview, setTestConfirmPreview] = useState<{ messageType: string; content: string } | null>(null)
  const [testConfirmLoadingStepId, setTestConfirmLoadingStepId] = useState<string | null>(null)
  const testConfirmRequestRef = useRef(0)

  // テスト受信者未設定時の簡易登録モーダル
  const [recipientModalOpen, setRecipientModalOpen] = useState(false)
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipientResults, setRecipientResults] = useState<Array<{ id: string; displayName: string | null }>>([])
  const [recipientSearching, setRecipientSearching] = useState(false)
  const [recipientSelected, setRecipientSelected] = useState<Set<string>>(new Set())
  const [recipientSaving, setRecipientSaving] = useState(false)
  const [recipientError, setRecipientError] = useState('')
  const pendingTestStepIdRef = useRef<string | null>(null)
  const recipientSearchRequestRef = useRef(0)
  const recipientSettingsRequestRef = useRef(0)

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
          triggerTagId: res.data.triggerTagId ?? '',
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

  const refreshStats = useCallback(async () => {
    try {
      const res = await api.scenarios.stats(id)
      if (res.success) setStats(res.data)
    } catch {
      // 参加者一覧の操作は完了しているため、集計の再読込失敗だけでは操作結果を戻さない。
    }
  }, [id])

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
    if (
      scenario?.isActive
      && (
        editForm.triggerType !== scenario.triggerType
        || (editForm.triggerTagId || null) !== scenario.triggerTagId
      )
    ) {
      setError('開始条件を変える場合は、先に配信を停止してください')
      return
    }
    if (editForm.triggerType === 'tag_added' && !editForm.triggerTagId) {
      setError('タグ付与時に開始する場合は、対象タグを選択してください')
      return
    }
    setSaving(true)
    try {
      const res = await api.scenarios.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        triggerType: editForm.triggerType,
        triggerTagId: editForm.triggerType === 'tag_added' ? editForm.triggerTagId : null,
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

  const requestStatusChange = async () => {
    if (!scenario) return
    setStatusError('')
    setStatusConflict(null)
    setStatusBusy(true)
    try {
      if (!scenario.isActive && scenario.triggerType === 'friend_add') {
        const listRes = await api.scenarios.list(
          scenario.lineAccountId ? { accountId: scenario.lineAccountId } : undefined,
        )
        if (!listRes.success) throw new Error(listRes.error || '現在のシナリオ状態を確認できませんでした')
        setStatusConflict(listRes.data.find((candidate) => (
          candidate.id !== scenario.id
          && candidate.triggerType === 'friend_add'
          && candidate.isActive
        )) ?? null)
      }
      setStatusSheetOpen(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '現在のシナリオ状態を確認できませんでした')
    } finally {
      setStatusBusy(false)
    }
  }

  const handleStatusChange = async (options?: { alsoDeactivateId?: string }) => {
    if (!scenario) return
    setStatusBusy(true)
    setStatusError('')
    let deactivatedExisting = false
    try {
      if (options?.alsoDeactivateId) {
        const deactivateRes = await api.scenarios.update(options.alsoDeactivateId, { isActive: false })
        if (!deactivateRes.success) throw new Error(deactivateRes.error || '既存シナリオを停止できませんでした')
        deactivatedExisting = true
      }

      const updateRes = await api.scenarios.update(id, { isActive: !scenario.isActive })
      if (!updateRes.success) {
        if (deactivatedExisting && options?.alsoDeactivateId) {
          await api.scenarios.update(options.alsoDeactivateId, { isActive: true }).catch(() => undefined)
        }
        throw new Error(updateRes.error || '状態を変更できませんでした')
      }

      setStatusSheetOpen(false)
      setStatusConflict(null)
      await loadScenario()
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : '状態を変更できませんでした')
    } finally {
      setStatusBusy(false)
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

  const handleDeleteStep = async () => {
    if (!deleteStepTarget) return
    setStepActionBusy(true)
    setDeleteStepError('')
    try {
      const res = await api.scenarios.deleteStep(id, deleteStepTarget.id)
      if (!res.success) throw new Error(res.error || 'ステップを削除できませんでした')
      setDeleteStepTarget(null)
      await loadScenario()
    } catch (cause) {
      setDeleteStepError(cause instanceof Error ? cause.message : 'ステップの削除に失敗しました')
    } finally {
      setStepActionBusy(false)
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
      const res = await api.scenarios.reorderSteps(id, [
        { stepId: a.id, stepOrder: b.stepOrder },
        { stepId: b.id, stepOrder: a.stepOrder },
      ])
      if (!res.success) throw new Error(res.error || '並び替えに失敗しました')
      await loadScenario()
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
        const reorderRes = await api.scenarios.reorderSteps(id, toShift.map((s) => ({ stepId: s.id, stepOrder: s.stepOrder + 1 })))
        if (!reorderRes.success) throw new Error(reorderRes.error || '複製位置を確保できませんでした')
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

  const handleTestSend = async (stepId: string, fixedAccountId?: string | null) => {
    setTestSendingStepId(stepId)
    setTestSendMessages((prev) => ({ ...prev, [stepId]: '' }))
    try {
      const accountId = fixedAccountId ?? scenario?.lineAccountId ?? selectedAccountId ?? undefined
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

  const requestTestSend = async (step: ScenarioStep, fixedAccountId?: string) => {
    const accountId = fixedAccountId ?? scenario?.lineAccountId ?? selectedAccountId ?? undefined
    if (!accountId) {
      setTestSendMessages((prev) => ({
        ...prev,
        [step.id]: '送信先のLINEアカウントを選択してください',
      }))
      return
    }

    setTestConfirmLoadingStepId(step.id)
    const requestId = ++testConfirmRequestRef.current
    try {
      const recipientsRes = await api.accountSettings.getTestRecipients(accountId)
      if (requestId !== testConfirmRequestRef.current) return
      if (!recipientsRes.success) throw new Error('テスト受信者を確認できませんでした')
      if (recipientsRes.data.length === 0) {
        openRecipientModal(step.id, accountId)
        return
      }
      const survey = getSurveyFromContent(step.messageContent, surveys)
      const template = step.templateId ? templates.find((candidate) => candidate.id === step.templateId) : null
      const previewMessageType = survey ? 'flex' : template ? template.messageType : step.messageType
      const previewContent = survey
        ? buildSurveyFlexContent(survey)
        : template
          ? template.messageContent
          : step.messageContent
      setTestConfirmRecipients(recipientsRes.data)
      setTestConfirmAccountId(accountId)
      setTestConfirmPreview({
        messageType: previewMessageType,
        content: previewContent.replaceAll('{{name}}', '［友だちの表示名］'),
      })
      setTestConfirmStep(step)
    } catch (cause) {
      setTestSendMessages((prev) => ({
        ...prev,
        [step.id]: cause instanceof Error ? cause.message : 'テスト受信者を確認できませんでした',
      }))
    } finally {
      if (requestId === testConfirmRequestRef.current) setTestConfirmLoadingStepId(null)
    }
  }

  // ── テスト受信者 未設定時の簡易登録モーダル ──────────────────────────────
  const recipientAccountIdRef = useRef<string | undefined>(undefined)

  const searchFriendsForRecipientModal = useCallback(async (query: string) => {
    const requestId = ++recipientSearchRequestRef.current
    const accountId = recipientAccountIdRef.current
    setRecipientSearching(true)
    try {
      const res = await api.friends.list({
        search: query || undefined,
        accountId,
        limit: 20,
        includeTags: false,
      })
      if (
        requestId === recipientSearchRequestRef.current
        && accountId === recipientAccountIdRef.current
        && res.success
      ) {
        setRecipientResults(res.data.items.map((f) => ({ id: f.id, displayName: f.displayName })))
      }
    } catch {
      // 検索失敗は無視 (一覧が更新されないだけ)
    } finally {
      if (requestId === recipientSearchRequestRef.current) setRecipientSearching(false)
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
    const settingsRequestId = ++recipientSettingsRequestRef.current
    api.accountSettings.getTestRecipients(accountId).then((res) => {
      if (
        settingsRequestId === recipientSettingsRequestRef.current
        && accountId === recipientAccountIdRef.current
        && res.success
      ) {
        setRecipientSelected(new Set(res.data.map((f) => f.id)))
      }
    }).catch(() => {})
    searchFriendsForRecipientModal('')
  }

  function closeRecipientModal() {
    recipientSearchRequestRef.current += 1
    recipientSettingsRequestRef.current += 1
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
      const step = scenario?.steps.find((candidate) => candidate.id === stepId)
      if (step) {
        await requestTestSend(step, accountId)
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
  const testAccountId = testConfirmAccountId ?? scenario.lineAccountId ?? selectedAccountId
  const testAccountName = accounts.find((account) => account.id === testAccountId)?.displayName
    || accounts.find((account) => account.id === testAccountId)?.name
    || '選択中のLINEアカウント'

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
        <div className="mb-4 bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-x-3 gap-y-1 text-sm flex-wrap">
          <span className="font-medium text-gray-700">配信状況</span>
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
          <a href="#participants" className="ml-auto min-h-10 rounded-md px-3 py-2 font-medium text-green-700 hover:bg-green-50">
            友だちを確認
          </a>
        </div>
      )}

      {/* Scenario Info */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
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
                disabled={scenario.isActive}
                onChange={(e) => setEditForm({
                  ...editForm,
                  triggerType: e.target.value as ScenarioTriggerType,
                  triggerTagId: e.target.value === 'tag_added' ? editForm.triggerTagId : '',
                })}
              >
                {triggerOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {scenario.isActive && <p className="mt-1 text-xs text-amber-700">開始条件を変える場合は、先に配信を停止してください。</p>}
            </div>
            {editForm.triggerType === 'tag_added' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  開始に使うタグ <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  value={editForm.triggerTagId}
                  disabled={scenario.isActive}
                  onChange={(e) => setEditForm({ ...editForm, triggerTagId: e.target.value })}
                >
                  <option value="">選択してください</option>
                  {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
                {!editForm.triggerTagId && <p className="mt-1 text-xs text-red-600">対象タグを選択してください</p>}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
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
                    triggerTagId: scenario.triggerTagId ?? '',
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
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-3">
              <h2 className="text-lg font-semibold text-gray-900 break-words">{scenario.name}</h2>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {scenario.lineAccountId === null && (
                  <span title="すべてのLINEアカウントに適用されます" className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    全アカウント共通
                  </span>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${modeBadge.bg} ${modeBadge.text}`}>
                  {modeBadge.label}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    scenario.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {scenario.isActive ? '配信中' : '停止中'}
                </span>
                <button
                  onClick={() => setEditing(true)}
                  className="ml-auto sm:ml-0 text-xs font-medium text-green-600 hover:text-green-700 px-3 py-2 min-h-[44px] sm:min-h-0 sm:py-1.5 rounded-md hover:bg-green-50 transition-colors"
                >
                  基本情報を編集
                </button>
                <button
                  onClick={() => void requestStatusChange()}
                  disabled={statusBusy}
                  className="min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {statusBusy ? '確認中...' : scenario.isActive ? '配信を停止' : '配信を有効化'}
                </button>
              </div>
            </div>
            {scenario.description && (
              <p className="text-sm text-gray-500 mb-3">{scenario.description}</p>
            )}
            <div className="flex items-center gap-x-4 gap-y-1 text-xs text-gray-500 flex-wrap">
              <span>
                開始条件: {triggerOptions.find(o => o.value === scenario.triggerType)?.label ?? '未設定'}
                {scenario.triggerType === 'tag_added' && scenario.triggerTagId
                  ? `（${tags.find((tag) => tag.id === scenario.triggerTagId)?.name ?? '削除されたタグ'}）`
                  : ''}
              </span>
              <span>ステップ数: {scenario.steps.length}</span>
              <span>作成日: {new Date(scenario.createdAt).toLocaleDateString('ja-JP')}</span>
            </div>
          </div>
        )}
      </div>

      <ScenarioParticipants
        scenarioId={scenario.id}
        scenarioActive={scenario.isActive}
        onChanged={() => void refreshStats()}
      />

      {/* Steps */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold text-gray-800">ステップ一覧</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={sortedSteps.length === 0}
              className="flex-1 sm:flex-none px-3 py-1.5 min-h-[44px] text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40"
            >
              一括プレビュー
            </button>
            <button
              onClick={openAddStep}
              className="flex-1 sm:flex-none px-3 py-1.5 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              + ステップ追加
            </button>
          </div>
        </div>

        {/* Step form: モバイルはボトムシート / デスクトップは従来どおりインライン */}
        <EditSheet
          open={showStepForm}
          title={editingStepId ? '本文・条件を編集' : '新しいステップを追加'}
          onClose={() => { setShowStepForm(false); setEditingStepId(null); setStepError('') }}
          footer={
            <>
              {stepError && <p className="mb-2 text-xs text-red-600">{stepError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveStep}
                  disabled={stepSaving}
                  className="flex-1 md:flex-none px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {stepSaving ? '保存中...' : editingStepId ? 'ステップを更新' : 'ステップを追加'}
                </button>
                <button
                  onClick={() => { setShowStepForm(false); setEditingStepId(null); setStepError('') }}
                  className="flex-1 md:flex-none px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </>
          }
        >
            <div className={`space-y-3 ${stepForm.inputMode === 'direct' && stepForm.messageType === 'flex' ? 'md:max-w-3xl' : 'md:max-w-lg'}`}>
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
                <div className="flex flex-col sm:flex-row sm:gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0">
                    <input
                      type="radio"
                      className="w-4 h-4"
                      checked={stepForm.inputMode === 'direct'}
                      onChange={() => setStepForm({ ...stepForm, inputMode: 'direct', templateId: null, surveyId: null })}
                    />
                    <span>直接入力</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0">
                    <input
                      type="radio"
                      className="w-4 h-4"
                      checked={stepForm.inputMode === 'template'}
                      onChange={() => setStepForm({ ...stepForm, inputMode: 'template', surveyId: null })}
                    />
                    <span>テンプレートを使う</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0">
                    <input
                      type="radio"
                      className="w-4 h-4"
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
                  {stepForm.messageType === 'flex' ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        メッセージ内容 <span className="text-red-500">*</span>
                      </label>
                      <FlexBuilder
                        key={editingStepId ?? 'new'}
                        value={stepForm.messageContent}
                        onChange={(nextValue) => setStepForm({ ...stepForm, messageContent: nextValue })}
                      />
                    </div>
                  ) : (
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
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y min-h-[140px]"
                        rows={5}
                        placeholder="メッセージ内容を入力..."
                        value={stepForm.messageContent}
                        onChange={(e) => setStepForm({ ...stepForm, messageContent: e.target.value })}
                      />
                    </div>
                  )}
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

            </div>
        </EditSheet>

        {/* Steps list: 友だちのトーク画面での見え方に寄せ、1通ずつ吹き出しと番号付きの縦線で区切る */}
        {sortedSteps.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            ステップがありません。「+ ステップ追加」から1通目を追加してください。
          </div>
        ) : (
          <TalkArea>
            <TalkTimeline>
              {sortedSteps.map((step, idx) => {
                // テンプレ参照時は、表示も「現在のテンプレ内容」を見せる。
                // (templates state には list で取得済みの最新内容が入っている)
                const survey = getSurveyFromContent(step.messageContent, surveys)
                const tpl = step.templateId ? templates.find((t) => t.id === step.templateId) : null
                const displayType = survey ? 'flex' : tpl ? tpl.messageType : step.messageType
                const displayContent = survey ? buildSurveyFlexContent(survey) : tpl ? tpl.messageContent : step.messageContent
                const readableDisplayContent = displayContent.replaceAll('{{name}}', '［友だちの表示名］')
                const stat = stats?.steps.find((s) => s.stepOrder === step.stepOrder)
                const reachTagName = step.onReachTagId ? (tags.find((t) => t.id === step.onReachTagId)?.name ?? '削除されたタグ') : null
                // モバイルだけ長文を4行に縮める。デスクトップは md: クラスで常に全文を出す。
                const isExpanded = expandedStepIds.has(step.id)
                const testBusy = testConfirmLoadingStepId === step.id || testSendingStepId === step.id
                const notes = [
                  survey && <p key="survey">アンケート「{survey.form.name}」を送ります</p>,
                  step.templateId && <p key="template">共有テンプレート「{tpl?.name ?? '参照先が見つかりません'}」の今の本文です</p>,
                  reachTagName && <p key="tag">この通が届いたら、タグ「{reachTagName}」を付けます</p>,
                  stat && <p key="stat">ここまで届いた人: {stat.reachedCount}人（{Math.round(stat.reachRate * 100)}%）</p>,
                  testSendMessages[step.id] && <p key="test" className="text-blue-700">{testSendMessages[step.id]}</p>,
                ].filter(Boolean)

                return (
                  <TalkStep
                    key={step.id}
                    number={idx + 1}
                    timing={stepTimingLabel(step, idx, deliveryMode, scenario.triggerType)}
                    condition={stepConditionText(
                      step,
                      (tagId) => tags.find((t) => t.id === tagId)?.name,
                      (linkId) => {
                        const link = trackedLinks.find((l) => l.id === linkId)
                        return link ? (link.name ?? link.originalUrl) : undefined
                      },
                    )}
                    isLast={idx === sortedSteps.length - 1}
                    note={notes.length > 0 ? <>{notes}</> : undefined}
                    actions={
                      <>
                        <button
                          type="button"
                          onClick={() => openEditStep(step)}
                          className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-green-700 hover:bg-green-50"
                        >
                          編集
                        </button>
                        <ActionMenu
                          label={`${idx + 1}通目のその他の操作`}
                          items={[
                            {
                              label: testConfirmLoadingStepId === step.id ? '送信先を確認中...' : testSendingStepId === step.id ? '送信中...' : 'テスト送信',
                              disabled: testBusy,
                              onSelect: () => void requestTestSend(step),
                            },
                            { label: '複製', onSelect: () => void handleDuplicateStep(step) },
                            { label: '上へ移動', disabled: idx === 0, onSelect: () => void handleMoveStep(step.id, 'up') },
                            { label: '下へ移動', disabled: idx === sortedSteps.length - 1, onSelect: () => void handleMoveStep(step.id, 'down') },
                            { label: '削除', tone: 'danger', onSelect: () => { setDeleteStepError(''); setDeleteStepTarget(step) } },
                          ]}
                        />
                      </>
                    }
                  >
                    <div className={isExpanded ? 'block' : 'hidden md:block'}>
                      <MessageBubble type={displayType} content={readableDisplayContent} />
                    </div>
                    {!isExpanded && (
                      <div className="md:hidden">
                        {displayType === 'text'
                          ? <MessageBubble type="text" content={readableDisplayContent} clamp />
                          : <MessageBubble type="text" content={buildStepSnippet(displayType, readableDisplayContent)} />}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleStepExpanded(step.id)}
                      aria-expanded={isExpanded}
                      className="mt-1 min-h-[36px] text-sm font-medium text-blue-700 md:hidden"
                    >
                      {isExpanded ? '短く表示する' : '全文を表示する'}
                    </button>
                  </TalkStep>
                )
              })}
            </TalkTimeline>
          </TalkArea>
        )}
      </div>

      <ScenarioStatusSheet
        open={statusSheetOpen}
        scenario={{ ...scenario, stepCount: scenario.steps.length }}
        conflict={statusConflict}
        busy={statusBusy}
        error={statusError}
        onClose={() => {
          if (!statusBusy) {
            setStatusSheetOpen(false)
            setStatusConflict(null)
            setStatusError('')
          }
        }}
        onConfirm={(options) => void handleStatusChange(options)}
      />

      <ConfirmSheet
        open={Boolean(deleteStepTarget)}
        title={deleteStepTarget ? `ステップ${deleteStepTarget.stepOrder}を削除しますか？` : 'ステップを削除しますか？'}
        message="このステップは元に戻せません。後ろのステップは残ります。"
        confirmLabel="削除する"
        tone="danger"
        busy={stepActionBusy}
        error={deleteStepError}
        onClose={() => {
          if (!stepActionBusy) {
            setDeleteStepTarget(null)
            setDeleteStepError('')
          }
        }}
        onConfirm={() => void handleDeleteStep()}
      />

      <ConfirmSheet
        open={Boolean(testConfirmStep)}
        title="この内容をテスト送信しますか？"
        message={testConfirmStep ? (
          <span>
            送信先: {testAccountName}<br />
            受信者: {testConfirmRecipients.length}人<br />
            対象: ステップ{testConfirmStep.stepOrder}<br />
            本文: {testConfirmPreview
              ? buildStepSnippet(testConfirmPreview.messageType, testConfirmPreview.content)
              : buildStepSnippet(testConfirmStep.messageType, testConfirmStep.messageContent)}
          </span>
        ) : undefined}
        confirmLabel="テスト送信する"
        busy={testConfirmStep ? testSendingStepId === testConfirmStep.id : false}
        onClose={() => {
          if (!testSendingStepId) {
            setTestConfirmStep(null)
            setTestConfirmRecipients([])
            setTestConfirmAccountId(null)
            setTestConfirmPreview(null)
          }
        }}
        onConfirm={() => {
          if (!testConfirmStep) return
          const stepId = testConfirmStep.id
          const accountId = testConfirmAccountId
          setTestConfirmStep(null)
          setTestConfirmRecipients([])
          setTestConfirmAccountId(null)
          setTestConfirmPreview(null)
          void handleTestSend(stepId, accountId)
        }}
      />

      <BulkPreviewModal
        open={previewOpen}
        scenarioId={id}
        onClose={() => setPreviewOpen(false)}
      />

      {/* テスト受信者 未設定時の簡易登録シート (モバイルはボトムシート) */}
      <Sheet
        open={recipientModalOpen}
        onClose={closeRecipientModal}
        busy={recipientSaving}
        title="テスト受信者を選択"
        description="検索して友だちを選びます。保存後に送信内容を確認できます。"
        footer={
          <>
            <SheetButton onClick={closeRecipientModal} disabled={recipientSaving}>
              キャンセル
            </SheetButton>
            <SheetButton
              variant="primary"
              onClick={handleSaveRecipients}
              disabled={recipientSelected.size === 0}
              busy={recipientSaving}
              busyLabel="保存中..."
              className="!bg-[#06C755] hover:!bg-[#05b34c]"
            >
              保存して確認へ
            </SheetButton>
          </>
        }
      >
        <div className="space-y-3">
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="名前で検索..."
            value={recipientQuery}
            onChange={(e) => setRecipientQuery(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-200">
            {recipientSearching ? (
              <p className="p-3 text-xs text-gray-400">検索中...</p>
            ) : recipientResults.length === 0 ? (
              <p className="p-3 text-xs text-gray-400">該当する友だちがいません</p>
            ) : (
              recipientResults.map((f) => (
                <label key={f.id} className="flex min-h-[44px] items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={recipientSelected.has(f.id)}
                    onChange={() => toggleRecipientSelected(f.id)}
                    className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span>{f.displayName || '(名前未設定)'}</span>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-gray-500">選択中: {recipientSelected.size}人</p>
          {recipientError && <p className="text-xs text-red-600">{recipientError}</p>}
        </div>
      </Sheet>
    </div>
  )
}
