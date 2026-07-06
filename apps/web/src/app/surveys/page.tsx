'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Header from '@/components/layout/header'
import MessageVariableButton from '@/components/message-variable-button'
import { api, type RegistrationSurveySettings, type SurveyQuestion, type SurveySettings } from '@/lib/api'
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
  const [surveyList, setSurveyList] = useState<SurveySettings[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [registrationSurveyId, setRegistrationSurveyId] = useState('')
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
    setIsActive(settings.form.isActive)
    if (isRegistrationSettings(settings)) {
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

  const loadSelected = async (id: string, registrationId = registrationSurveyId) => {
    setLoadingSelected(true)
    setError('')
    try {
      const res = id === registrationId
        ? await api.registrationSurvey.get()
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
    setLoading(true)
    setError('')
    try {
      const [surveysRes, registrationRes, tagsRes, scenariosRes] = await Promise.all([
        api.surveys.list(),
        api.registrationSurvey.get(),
        api.tags.list(),
        api.scenarios.list(),
      ])
      if (surveysRes.success) setSurveyList(surveysRes.data)
      if (tagsRes.success) setTags(tagsRes.data)
      if (scenariosRes.success) setScenarios(scenariosRes.data)

      if (registrationRes.success) {
        setRegistrationSurveyId(registrationRes.data.form.id)
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
    load()
  }, [])

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
      setNotice('保存しました')
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

  const deleteSelected = async () => {
    if (!selectedId || isRegistrationSelected) return
    setDeleting(true)
    setError('')
    setNotice('')
    try {
      const res = await api.surveys.delete(selectedId)
      if (!res.success) {
        setError(res.error)
        return
      }
      const listRes = await refreshList()
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
          <div className="flex items-center gap-2">
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
              {creating ? '作成中...' : '新規'}
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
                const registration = survey.form.id === registrationSurveyId
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
                      {registration && <span className="rounded bg-gray-100 px-1.5 py-0.5">友だち追加</span>}
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
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px] gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">アンケート名</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={isRegistrationSelected}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50"
                      placeholder="例: 登録時アンケート"
                    />
                  </div>
                  <label className="inline-flex items-end gap-3 pb-2">
                    <span className="text-sm text-gray-700">有効</span>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                  </label>
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
                  <p className="text-xs text-gray-500">{friendAddScenarioName || selectedSurvey?.form.name || 'friend_add シナリオ'}</p>
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
