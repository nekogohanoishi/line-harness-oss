'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Header from '@/components/layout/header'
import MessageVariableButton from '@/components/message-variable-button'
import { api, type RegistrationSurveySettings, type SurveyQuestion, type SurveySettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import type { Scenario, Tag } from '@line-crm/shared'

const emptyQuestion = (index: number): SurveyQuestion => ({
  name: `質問${index + 1}`,
  label: '',
  options: ['ある', 'ない'],
})

function IconButton({
  label,
  children,
  disabled,
  onClick,
}: {
  label: string
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3m-8 0h10" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function isRegistrationSettings(settings: SurveySettings | RegistrationSurveySettings | null): settings is RegistrationSurveySettings {
  return Boolean(settings && 'greetingMessageContent' in settings)
}

export default function SurveysPage() {
  const { selectedAccountId } = useAccount()
  const [surveyList, setSurveyList] = useState<SurveySettings[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [registrationSurveyId, setRegistrationSurveyId] = useState('')
  const [registrationSurveyIds, setRegistrationSurveyIds] = useState<string[]>([])
  const [registrationDeliveryActive, setRegistrationDeliveryActive] = useState(false)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState<SurveyQuestion[]>([])
  const [onSubmitTagId, setOnSubmitTagId] = useState('')
  const [onSubmitScenarioId, setOnSubmitScenarioId] = useState('')
  const [onSubmitMessageContent, setOnSubmitMessageContent] = useState('')
  const [greetingMessageContent, setGreetingMessageContent] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [savedIsActive, setSavedIsActive] = useState(true)
  const [friendAddScenarioName, setFriendAddScenarioName] = useState('')

  const [loading, setLoading] = useState(true)
  const [loadingSelected, setLoadingSelected] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const greetingMessageRef = useRef<HTMLTextAreaElement | null>(null)
  const completionMessageRef = useRef<HTMLTextAreaElement | null>(null)

  const selectedSurvey = useMemo(
    () => surveyList.find((survey) => survey.form.id === selectedId) ?? null,
    [surveyList, selectedId],
  )
  const isRegistrationCandidate = selectedId !== '' && registrationSurveyIds.includes(selectedId)
  const isRegistrationSelected = selectedId !== '' && selectedId === registrationSurveyId
  const manualScenarios = useMemo(
    () => scenarios.filter((scenario) => scenario.triggerType === 'manual'),
    [scenarios],
  )

  const applySettings = (settings: SurveySettings | RegistrationSurveySettings) => {
    setSelectedId(settings.form.id)
    setName(settings.form.name)
    setDescription(settings.form.description ?? '')
    setQuestions(settings.questions)
    setOnSubmitTagId(settings.form.onSubmitTagId ?? '')
    setOnSubmitScenarioId(settings.form.onSubmitScenarioId ?? '')
    setOnSubmitMessageContent(settings.form.onSubmitMessageContent ?? '')
    const effectiveIsActive = isRegistrationSettings(settings) ? settings.isActive : settings.form.isActive
    setIsActive(effectiveIsActive)
    setSavedIsActive(effectiveIsActive)
    if (isRegistrationSettings(settings)) {
      setRegistrationSurveyId(settings.selectedFormId)
      setRegistrationSurveyIds(settings.candidateFormIds)
      setRegistrationDeliveryActive(settings.isActive)
      setGreetingMessageContent(settings.greetingMessageContent ?? '')
      setFriendAddScenarioName(settings.friendAddScenario?.name ?? '')
    } else {
      setGreetingMessageContent('')
      setFriendAddScenarioName('')
    }
  }

  const refreshList = async () => {
    const res = await api.surveys.list()
    if (res.success) setSurveyList(res.data)
    return res
  }

  const refreshRegistrationCandidates = async () => {
    if (!selectedAccountId) return null
    const res = await api.registrationSurvey.list(selectedAccountId)
    if (res.success) setRegistrationSurveyIds(res.data.map((candidate) => candidate.form.id))
    return res
  }

  const loadSelected = async (id: string, registrationId = registrationSurveyId) => {
    setLoadingSelected(true)
    setError('')
    try {
      const res = id === registrationId
        ? await api.registrationSurvey.get(selectedAccountId ?? undefined)
        : await api.surveys.get(id)
      if (!res.success) {
        setError(res.error)
        return
      }
      applySettings(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoadingSelected(false)
    }
  }

  const load = async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    try {
      const [surveysRes, registrationRes, registrationCandidatesRes, tagsRes, scenariosRes] = await Promise.all([
        api.surveys.list(),
        api.registrationSurvey.get(selectedAccountId),
        api.registrationSurvey.list(selectedAccountId),
        api.tags.list(),
        api.scenarios.list({ accountId: selectedAccountId }),
      ])
      if (surveysRes.success) setSurveyList(surveysRes.data)
      if (registrationCandidatesRes.success) {
        setRegistrationSurveyIds(registrationCandidatesRes.data.map((candidate) => candidate.form.id))
      }
      if (tagsRes.success) setTags(tagsRes.data)
      if (scenariosRes.success) setScenarios(scenariosRes.data)

      if (registrationRes.success) {
        applySettings(registrationRes.data)
      } else if (surveysRes.success && surveysRes.data[0]) {
        applySettings(surveysRes.data[0])
      } else if (!surveysRes.success) {
        setError(surveysRes.error)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [selectedAccountId])

  const updateQuestion = (index: number, patch: Partial<SurveyQuestion>) => {
    setQuestions((current) => current.map((question, i) => i === index ? { ...question, ...patch } : question))
  }

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    setQuestions((current) => current.map((question, i) => {
      if (i !== questionIndex) return question
      return {
        ...question,
        options: question.options.map((option, oi) => oi === optionIndex ? value : option),
      }
    }))
  }

  const addQuestion = () => {
    setQuestions((current) => [...current, emptyQuestion(current.length)])
  }

  const removeQuestion = (index: number) => {
    setQuestions((current) => current.filter((_, i) => i !== index))
  }

  const moveQuestion = (index: number, direction: -1 | 1) => {
    setQuestions((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const item = next[index]
      next[index] = next[target]
      next[target] = item
      return next
    })
  }

  const addOption = (questionIndex: number) => {
    setQuestions((current) => current.map((question, i) => (
      i === questionIndex ? { ...question, options: [...question.options, ''] } : question
    )))
  }

  const removeOption = (questionIndex: number, optionIndex: number) => {
    setQuestions((current) => current.map((question, i) => (
      i === questionIndex
        ? { ...question, options: question.options.filter((_, oi) => oi !== optionIndex) }
        : question
    )))
  }

  const payloadQuestions = () => questions.map((question, index) => ({
    name: question.name.trim() || question.label.trim() || `質問${index + 1}`,
    label: question.label.trim(),
    options: question.options.map((option) => option.trim()).filter(Boolean),
  }))

  const save = async () => {
    if (!selectedId) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        name: name.trim() || 'アンケート',
        description: description.trim() || null,
        questions: payloadQuestions(),
        onSubmitTagId: onSubmitTagId || null,
        onSubmitScenarioId: onSubmitScenarioId || null,
        onSubmitMessageContent: onSubmitMessageContent.trim() || null,
        isActive,
      }
      const res = isRegistrationSelected
        ? await api.registrationSurvey.update({
            accountId: selectedAccountId ?? undefined,
            formId: selectedId,
            name: payload.name,
            description: payload.description,
            questions: payload.questions,
            onSubmitTagId: payload.onSubmitTagId,
            onSubmitScenarioId: payload.onSubmitScenarioId,
            onSubmitMessageContent: payload.onSubmitMessageContent,
            greetingMessageContent: greetingMessageContent.trim() || null,
            isActive,
          })
        : await api.surveys.update(selectedId, payload)
      if (!res.success) {
        setError(res.error)
        return
      }
      applySettings(res.data)
      await refreshList()
      await refreshRegistrationCandidates()
      setNotice(
        isRegistrationSelected
          ? `保存しました。登録時アンケートは${isActive ? '有効' : '無効'}です`
          : `保存しました。アンケートは${isActive ? '有効' : '無効'}です`,
      )
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const createSurvey = async () => {
    setCreating(true)
    setError('')
    setNotice('')
    try {
      const res = await api.surveys.create({
        name: '新しいアンケート',
        questions: [emptyQuestion(0)],
        onSubmitMessageContent: 'ご回答ありがとうございました！',
        isActive: true,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      await refreshList()
      applySettings(res.data)
      setNotice('作成しました')
    } catch {
      setError('作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const createRegistrationSurvey = async () => {
    if (!selectedAccountId) return
    setCreating(true)
    setError('')
    setNotice('')
    try {
      const res = await api.registrationSurvey.create({
        accountId: selectedAccountId,
        name: `登録時アンケート ${registrationSurveyIds.length + 1}`,
        questions: [emptyQuestion(0)],
        onSubmitMessageContent: 'ご回答ありがとうございました！',
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      await Promise.all([refreshList(), refreshRegistrationCandidates()])
      applySettings(res.data)
      setNotice('登録時アンケート候補を作成しました')
    } catch {
      setError('作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const selectRegistrationSurvey = async () => {
    if (!selectedAccountId || !selectedId || !isRegistrationCandidate) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.registrationSurvey.update({
        accountId: selectedAccountId,
        formId: selectedId,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      applySettings(res.data)
      await refreshList()
      setNotice('友だち追加時に使用するアンケートを変更しました')
    } catch {
      setError('切り替えに失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const deleteSelected = async () => {
    if (!selectedId || isRegistrationSelected || !selectedAccountId) return
    setDeleting(true)
    setError('')
    setNotice('')
    try {
      const res = isRegistrationCandidate
        ? await api.registrationSurvey.delete(selectedAccountId, selectedId)
        : await api.surveys.delete(selectedId)
      if (!res.success) {
        setError(res.error)
        return
      }
      const listRes = await refreshList()
      await refreshRegistrationCandidates()
      const next = listRes.success ? listRes.data.find((survey) => survey.form.id !== selectedId) : null
      if (registrationSurveyId) {
        await loadSelected(registrationSurveyId, registrationSurveyId)
      } else if (next) {
        applySettings(next)
      } else {
        setSelectedId('')
        setName('')
        setDescription('')
        setQuestions([])
      }
      setNotice('削除しました')
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <Header
        title="アンケート"
        description="LINEトーク内のボタン式アンケート"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!isRegistrationSelected && selectedId && (
              <button
                type="button"
                onClick={deleteSelected}
                disabled={deleting || saving || loading}
                className="px-3 py-2 min-h-[44px] text-sm font-medium text-red-600 bg-red-50 rounded-lg disabled:opacity-50"
              >
                削除
              </button>
            )}
            <button
              type="button"
              onClick={createSurvey}
              disabled={creating || loading}
              className="px-3 py-2 min-h-[44px] text-sm font-medium text-green-700 bg-green-50 rounded-lg disabled:opacity-50"
            >
              通常アンケートを追加
            </button>
            <button
              type="button"
              onClick={createRegistrationSurvey}
              disabled={creating || loading || !selectedAccountId}
              className="px-3 py-2 min-h-[44px] text-sm font-medium text-green-700 bg-green-50 rounded-lg disabled:opacity-50"
            >
              {creating ? '作成中...' : '登録時用を追加'}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading || loadingSelected || !selectedId}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-lg border border-gray-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6">
          <aside className="bg-white border border-gray-200 rounded-lg p-3 h-fit">
            <div className="space-y-1">
              {surveyList.map((survey) => {
                const active = survey.form.id === selectedId
                const registrationCandidate = registrationSurveyIds.includes(survey.form.id)
                const selectedRegistration = survey.form.id === registrationSurveyId
                return (
                  <button
                    key={survey.form.id}
                    type="button"
                    onClick={() => loadSelected(survey.form.id)}
                    className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? 'bg-green-50 text-green-800' : 'hover:bg-gray-50 text-gray-700'}`}
                  >
                    <span className="block font-medium truncate">{survey.form.name}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      <span>{survey.questions.length}問</span>
                      {registrationCandidate ? (
                        <span className={`inline-flex items-center gap-1 ${selectedRegistration && registrationDeliveryActive ? 'text-green-700' : 'text-gray-500'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${selectedRegistration && registrationDeliveryActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {selectedRegistration
                            ? registrationDeliveryActive ? '配信中' : '選択中・停止'
                            : '登録時用'}
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 ${survey.form.isActive ? 'text-green-700' : 'text-gray-500'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${survey.form.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {survey.form.isActive ? '有効' : '無効'}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
              {surveyList.length === 0 && (
                <div className="px-3 py-6 text-sm text-gray-500">アンケートがありません</div>
              )}
            </div>
          </aside>

          {selectedId ? (
            <div className="space-y-6 opacity-100">
              <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">アンケート名</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="例: 登録時アンケート"
                    />
                  </div>
                  <div className="lg:border-l lg:border-gray-200 lg:pl-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-gray-600">現在の状態</p>
                        <p className={`mt-1 inline-flex items-center gap-2 text-sm font-semibold ${isRegistrationCandidate && !isRegistrationSelected ? 'text-gray-600' : savedIsActive ? 'text-green-700' : 'text-gray-600'}`}>
                          <span className={`h-2 w-2 rounded-full ${isRegistrationCandidate && !isRegistrationSelected ? 'bg-gray-400' : savedIsActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {isRegistrationCandidate && !isRegistrationSelected
                            ? '登録時用の候補'
                            : savedIsActive ? '有効' : '無効'}
                        </p>
                      </div>
                      {isRegistrationCandidate && !isRegistrationSelected ? (
                        <button
                          type="button"
                          onClick={selectRegistrationSurvey}
                          disabled={saving || loadingSelected}
                          className="px-3 py-2 min-h-[40px] text-sm font-medium text-green-700 bg-green-50 rounded-lg disabled:opacity-50"
                        >
                          登録時に使用
                        </button>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isActive}
                          aria-label={isActive ? 'アンケートを無効にする' : 'アンケートを有効にする'}
                          title={isActive ? 'クリックして無効にする' : 'クリックして有効にする'}
                          onClick={() => setIsActive((current) => !current)}
                          disabled={saving || loadingSelected}
                          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${
                            isActive ? 'bg-green-500' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                              isActive ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      {isRegistrationCandidate && !isRegistrationSelected
                        ? '登録時アンケートとして保存されています。使用する場合は右のボタンで切り替えます。'
                        : savedIsActive
                        ? isRegistrationSelected
                          ? '友だち追加・ブロック解除後に、挨拶とアンケートを送信します。'
                          : '回答を受け付けています。'
                        : isRegistrationSelected
                          ? '友だち追加・ブロック解除後は挨拶だけを送信します。アンケートは送信せず、回答も受け付けません。'
                          : '回答を受け付けていません。'}
                    </p>
                    {!(isRegistrationCandidate && !isRegistrationSelected) && isActive !== savedIsActive ? (
                      <p className="mt-2 text-xs font-medium text-amber-700">
                        未保存です。右上の「保存」を押すと{isActive ? '有効' : '無効'}になります。
                      </p>
                    ) : !(isRegistrationCandidate && !isRegistrationSelected) ? (
                      <p className="mt-2 text-xs text-gray-400">切り替え後、右上の「保存」で反映されます。</p>
                    ) : null}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="管理用メモ"
                  />
                </div>
                {isRegistrationSelected && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>{friendAddScenarioName || selectedSurvey?.form.name || 'friend_add シナリオ'}</span>
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      あいさつ配信は有効
                    </span>
                  </div>
                )}
              </section>

              {isRegistrationSelected && (
                <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-gray-900">最初の挨拶メッセージ</h2>
                    <MessageVariableButton
                      targetRef={greetingMessageRef}
                      value={greetingMessageContent}
                      onChange={setGreetingMessageContent}
                    />
                  </div>
                  <textarea
                    ref={greetingMessageRef}
                    value={greetingMessageContent}
                    onChange={(e) => setGreetingMessageContent(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                    placeholder="友だち追加ありがとうございます！"
                  />
                </section>
              )}

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">質問</h2>
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100"
                  >
                    <PlusIcon />
                    質問を追加
                  </button>
                </div>

                {questions.map((question, questionIndex) => (
                  <div key={questionIndex} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold flex items-center justify-center">
                        {questionIndex + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <input
                          value={question.label}
                          onChange={(e) => updateQuestion(questionIndex, { label: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="例: 今1番目指している試験はどれですか？"
                        />
                      </div>
                      <IconButton label="上へ" disabled={questionIndex === 0} onClick={() => moveQuestion(questionIndex, -1)}>
                        <ArrowUpIcon />
                      </IconButton>
                      <IconButton label="下へ" disabled={questionIndex === questions.length - 1} onClick={() => moveQuestion(questionIndex, 1)}>
                        <ArrowDownIcon />
                      </IconButton>
                      <IconButton label="削除" disabled={questions.length <= 1} onClick={() => removeQuestion(questionIndex)}>
                        <TrashIcon />
                      </IconButton>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">メタデータキー</label>
                      <input
                        value={question.name}
                        onChange={(e) => updateQuestion(questionIndex, { name: e.target.value })}
                        className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="例: 目標試験"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {question.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-2">
                          <input
                            value={option}
                            onChange={(e) => updateOption(questionIndex, optionIndex, e.target.value)}
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            placeholder={`選択肢 ${optionIndex + 1}`}
                          />
                          <IconButton
                            label="選択肢を削除"
                            disabled={question.options.length <= 2}
                            onClick={() => removeOption(questionIndex, optionIndex)}
                          >
                            <TrashIcon />
                          </IconButton>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => addOption(questionIndex)}
                      className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                      <PlusIcon />
                      選択肢を追加
                    </button>
                  </div>
                ))}
              </section>

              <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-900">回答完了後</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">付与タグ</label>
                    <select
                      value={onSubmitTagId}
                      onChange={(e) => setOnSubmitTagId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">なし</option>
                      {tags.map((tag) => (
                        <option key={tag.id} value={tag.id}>{tag.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">続けて流すシナリオ</label>
                    <select
                      value={onSubmitScenarioId}
                      onChange={(e) => setOnSubmitScenarioId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">なし</option>
                      {manualScenarios.map((scenario) => (
                        <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-xs font-medium text-gray-600">完了メッセージ</label>
                    <MessageVariableButton
                      targetRef={completionMessageRef}
                      value={onSubmitMessageContent}
                      onChange={setOnSubmitMessageContent}
                    />
                  </div>
                  <textarea
                    ref={completionMessageRef}
                    value={onSubmitMessageContent}
                    onChange={(e) => setOnSubmitMessageContent(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                    placeholder="ご回答ありがとうございました！"
                  />
                </div>
              </section>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-10 text-sm text-gray-500">
              アンケートを選択してください
            </div>
          )}
        </div>
      )}
    </div>
  )
}
