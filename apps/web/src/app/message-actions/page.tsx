'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Scenario, Tag } from '@line-crm/shared'
import { api, type MessageAction, type MessageActionInput, type MessageActionStep } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { ConfirmSheet, PageHeader, Sheet, SheetButton } from '@/components/ui'

type TemplateItem = { id: string; name: string; messageType: string }

const stepLabels: Record<MessageActionStep['type'], string> = {
  add_tag: 'タグを付ける',
  remove_tag: 'タグを外す',
  start_scenario: 'シナリオを始める',
  set_metadata: '友だち情報に書き込む',
  reply_text: '返信する（文を書く）',
  reply_template: '返信する（テンプレート）',
}

function emptyStep(type: MessageActionStep['type']): MessageActionStep {
  switch (type) {
    case 'add_tag':
    case 'remove_tag':
      return { type, tagId: '' }
    case 'start_scenario':
      return { type, scenarioId: '' }
    case 'set_metadata':
      return { type, key: '', value: '' }
    case 'reply_text':
      return { type, text: '' }
    case 'reply_template':
      return { type, templateId: '' }
  }
}

function emptyInput(lineAccountId: string | null): MessageActionInput {
  return {
    name: '',
    kind: 'postback',
    lineAccountId,
    steps: [{ type: 'add_tag', tagId: '' }],
    linkUrl: null,
    oncePerFriend: false,
    repeatReply: null,
    deadlineAt: null,
    expiredReply: null,
    expiredUrl: null,
    isActive: true,
  }
}

function formatDeadline(value: string): string {
  return `${value.slice(5, 7)}/${value.slice(8, 10)} ${value.slice(11, 16)}`
}

function isPast(deadlineAt: string | null): boolean {
  if (!deadlineAt) return false
  return Date.now() >= Date.parse(`${deadlineAt.slice(0, 16)}:00+09:00`)
}

export default function MessageActionsPage() {
  const { selectedAccountId } = useAccount()
  const [actions, setActions] = useState<MessageAction[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ id: string | null; input: MessageActionInput } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<MessageAction | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // 静的書き出しの事前表示では window がないので、開いたあとに Worker の URL を決める
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [actionRes, tagRes, scenarioRes, templateRes] = await Promise.all([
        api.messageActions.list(selectedAccountId || undefined),
        api.tags.list(),
        api.scenarios.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(),
      ])
      if (actionRes.success) setActions(actionRes.data)
      else setError(actionRes.error)
      if (tagRes.success) setTags(tagRes.data)
      if (scenarioRes.success) setScenarios(scenarioRes.data)
      if (templateRes.success) setTemplates(templateRes.data)
    } catch {
      setError('読み込みに失敗しました。右上の更新か、ページの再読み込みをお試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const tagName = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])
  const scenarioName = useMemo(() => new Map(scenarios.map((s) => [s.id, s.name])), [scenarios])
  const templateName = useMemo(() => new Map(templates.map((t) => [t.id, t.name])), [templates])

  const describeStep = (step: MessageActionStep): string => {
    switch (step.type) {
      case 'add_tag': return `タグ「${tagName.get(step.tagId) ?? '削除されたタグ'}」を付ける`
      case 'remove_tag': return `タグ「${tagName.get(step.tagId) ?? '削除されたタグ'}」を外す`
      case 'start_scenario': return `シナリオ「${scenarioName.get(step.scenarioId) ?? '削除されたシナリオ'}」を始める`
      case 'set_metadata': return `友だち情報「${step.key}」に「${step.value}」を書き込む`
      case 'reply_text': return '返信する'
      case 'reply_template': return `テンプレート「${templateName.get(step.templateId) ?? '削除されたテンプレート'}」で返信する`
    }
  }

  const openNew = () => {
    setSaveError('')
    setEditing({ id: null, input: emptyInput(selectedAccountId || null) })
  }
  const openEdit = (action: MessageAction) => {
    setSaveError('')
    const { id, postbackData: _p, linkPath: _l, stats: _s, createdAt: _c, updatedAt: _u, ...input } = action
    setEditing({ id, input: { ...input, steps: input.steps.length > 0 ? input.steps : [emptyStep('add_tag')] } })
  }
  const patch = (next: Partial<MessageActionInput>) => setEditing((cur) => (cur ? { ...cur, input: { ...cur.input, ...next } } : cur))
  const patchStep = (index: number, next: MessageActionStep) =>
    setEditing((cur) => (cur ? { ...cur, input: { ...cur.input, steps: cur.input.steps.map((s, i) => (i === index ? next : s)) } } : cur))

  const save = async () => {
    if (!editing) return
    setSaving(true)
    setSaveError('')
    const input: MessageActionInput = {
      ...editing.input,
      steps: editing.input.kind === 'postback' ? editing.input.steps : [],
    }
    try {
      const res = editing.id ? await api.messageActions.update(editing.id, input) : await api.messageActions.create(input)
      if (!res.success) {
        setSaveError(res.error)
        return
      }
      setEditing(null)
      await load()
    } catch {
      setSaveError('保存できませんでした。通信状況を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await api.messageActions.delete(deleteTarget.id)
      setDeleteTarget(null)
      setEditing(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const copyLink = async (action: MessageAction) => {
    if (!action.linkPath) return
    try {
      await navigator.clipboard.writeText(`${origin}${action.linkPath}`)
      setCopiedId(action.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // クリップボードが使えない環境では何もしない (URL は画面に出ている)
    }
  }

  const input = editing?.input
  const fieldClass = 'mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div className="pb-10">
      <PageHeader
        title="ボタンの動き"
        description="メッセージのボタンやクイックリプライを押したときに、Harness が行うことを決めます。"
        actions={
          <button type="button" onClick={openNew} className="min-h-[44px] rounded-lg px-4 text-sm font-medium text-white" style={{ backgroundColor: '#06C755' }}>
            ＋ 新しく作る
          </button>
        }
      />
      <div className="mb-6 space-y-1 border-l-2 border-gray-300 pl-3 text-sm leading-6 text-gray-700">
        <p><span className="font-semibold">押した人に動きを付ける</span>：タグを付ける、シナリオを始める、返信するなど。押した人だけを次の案内へ進められます。</p>
        <p><span className="font-semibold">締切つきリンク</span>：締切までは申込ページなどを開き、締切後は別の案内に切り替えます。</p>
        <p className="text-gray-600">作った動きは、テンプレートのカード型メッセージのボタンや、クイックリプライで選べます。</p>
      </div>

      {error && <p role="alert" className="mb-4 border-l-2 border-red-500 pl-3 text-sm text-red-700">{error}</p>}
      {loading && <p role="status" className="text-sm text-gray-600">読み込み中...</p>}
      {!loading && !error && actions.length === 0 && (
        <p className="border-t border-gray-300 py-6 text-sm text-gray-600">まだありません。「＋ 新しく作る」から、最初の動きを作ってください。</p>
      )}

      {actions.length > 0 && (
        <ul className="border-t-2 border-gray-900">
          {actions.map((action) => {
            const past = isPast(action.deadlineAt)
            return (
              <li key={action.id} className="flex flex-col gap-2 border-b border-gray-300 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-gray-900 break-words">{action.name}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                      {action.kind === 'link' ? '締切つきリンク' : '押した人に動きを付ける'}
                    </span>
                    {!action.isActive && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">停止中</span>}
                    {action.oncePerFriend && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800">1人1回だけ</span>}
                    {action.deadlineAt && (
                      <span className={`rounded px-1.5 py-0.5 text-xs ${past ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                        {past ? `締切済み（${formatDeadline(action.deadlineAt)}）` : `締切 ${formatDeadline(action.deadlineAt)}`}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-700 break-words">
                    {action.kind === 'link'
                      ? `開くページ: ${action.linkUrl}`
                      : action.steps.map(describeStep).join(' → ')}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">
                    {action.kind === 'link'
                      ? `開かれた回数 ${action.stats.openedCount}回`
                      : `押した人 ${action.stats.doneFriends}人`}
                    {action.stats.expiredCount > 0 && `　締切後に押された回数 ${action.stats.expiredCount}回`}
                  </p>
                  {action.kind === 'link' && action.linkPath && (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="break-all text-gray-700">ボタンに入れるURL: {origin}{action.linkPath}</span>
                      <button type="button" onClick={() => void copyLink(action)} className="min-h-[36px] rounded border border-gray-300 px-2 text-sm text-gray-700 hover:bg-gray-50">
                        {copiedId === action.id ? 'コピーしました' : 'コピー'}
                      </button>
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => openEdit(action)} className="min-h-[44px] shrink-0 self-start rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50">
                  編集
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Sheet
        open={Boolean(editing)}
        onClose={() => { if (!saving) setEditing(null) }}
        title={editing?.id ? 'ボタンの動きを編集' : '新しいボタンの動き'}
        size="lg"
        busy={saving}
        footer={
          <>
            {editing?.id && (
              <SheetButton variant="danger" onClick={() => setDeleteTarget(actions.find((a) => a.id === editing.id) ?? null)}>削除</SheetButton>
            )}
            <SheetButton onClick={() => setEditing(null)}>キャンセル</SheetButton>
            <SheetButton variant="primary" onClick={() => void save()} busy={saving} busyLabel="保存中...">保存</SheetButton>
          </>
        }
      >
        {input && (
          <div className="space-y-6">
            <label className="block">
              <span className="text-sm font-medium text-gray-800">名前（管理用。友だちには見えません）</span>
              <input value={input.name} onChange={(e) => patch({ name: e.target.value })} maxLength={50} placeholder="例: 作成会・詳しく知りたい" className={fieldClass} />
            </label>

            <fieldset>
              <legend className="text-sm font-medium text-gray-800">種類</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([['postback', '押した人に動きを付ける', 'タグ・シナリオ・返信など'], ['link', '締切つきリンク', '締切後は別の案内へ']] as const).map(([value, label, hint]) => (
                  <label key={value} className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 ${input.kind === value ? 'border-green-600 bg-green-50' : 'border-gray-300'}`}>
                    <input type="radio" name="kind" checked={input.kind === value} onChange={() => patch({ kind: value })} className="mt-1" />
                    <span><span className="block text-sm font-medium text-gray-900">{label}</span><span className="block text-xs text-gray-600">{hint}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>

            {input.kind === 'postback' ? (
              <section>
                <h3 className="text-sm font-medium text-gray-800">押したときの動き（上から順に行います）</h3>
                <ol className="mt-2 space-y-3">
                  {input.steps.map((step, index) => (
                    <li key={index} className="border-l-2 border-green-600 pl-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">{index + 1}.</span>
                        <select
                          value={step.type}
                          onChange={(e) => patchStep(index, emptyStep(e.target.value as MessageActionStep['type']))}
                          className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm"
                          aria-label={`${index + 1}番目の動きの種類`}
                        >
                          {Object.entries(stepLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => patch({ steps: input.steps.filter((_, i) => i !== index) })}
                          disabled={input.steps.length <= 1}
                          className="min-h-[44px] shrink-0 rounded-lg px-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-30"
                          aria-label={`${index + 1}番目の動きを消す`}
                        >
                          消す
                        </button>
                      </div>
                      <div className="mt-2">
                        {(step.type === 'add_tag' || step.type === 'remove_tag') && (
                          <select value={step.tagId} onChange={(e) => patchStep(index, { ...step, tagId: e.target.value })} className={fieldClass} aria-label="タグ">
                            <option value="">タグを選んでください</option>
                            {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                          </select>
                        )}
                        {step.type === 'start_scenario' && (
                          <select value={step.scenarioId} onChange={(e) => patchStep(index, { ...step, scenarioId: e.target.value })} className={fieldClass} aria-label="シナリオ">
                            <option value="">シナリオを選んでください</option>
                            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isActive ? '' : '（停止中）'}</option>)}
                          </select>
                        )}
                        {step.type === 'set_metadata' && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <input value={step.key} onChange={(e) => patchStep(index, { ...step, key: e.target.value })} maxLength={50} placeholder="項目名（例: 作成会の関心）" className={fieldClass} />
                            <input value={step.value} onChange={(e) => patchStep(index, { ...step, value: e.target.value })} maxLength={500} placeholder="書き込む値（例: 詳しく知りたい）" className={fieldClass} />
                          </div>
                        )}
                        {step.type === 'reply_text' && (
                          <textarea value={step.text} onChange={(e) => patchStep(index, { ...step, text: e.target.value })} maxLength={2000} rows={4} placeholder={'例: {{name}}さん、ありがとうございます。詳しいご案内をお送りします。'} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6" />
                        )}
                        {step.type === 'reply_template' && (
                          <select value={step.templateId} onChange={(e) => patchStep(index, { ...step, templateId: e.target.value })} className={fieldClass} aria-label="テンプレート">
                            <option value="">テンプレートを選んでください</option>
                            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                {input.steps.length < 10 && (
                  <button type="button" onClick={() => patch({ steps: [...input.steps, emptyStep('reply_text')] })} className="mt-3 min-h-[44px] text-sm font-medium text-blue-700 hover:underline">
                    ＋ 動きを足す
                  </button>
                )}

                <label className="mt-4 flex min-h-[44px] items-center gap-2">
                  <input type="checkbox" checked={input.oncePerFriend} onChange={(e) => patch({ oncePerFriend: e.target.checked })} />
                  <span className="text-sm text-gray-800">1人1回だけ動かす（2回目以降は上の動きを行わない）</span>
                </label>
                {input.oncePerFriend && (
                  <label className="block">
                    <span className="text-sm text-gray-700">2回目以降に押したときの返信（空なら何も返しません）</span>
                    <textarea value={input.repeatReply ?? ''} onChange={(e) => patch({ repeatReply: e.target.value || null })} maxLength={2000} rows={2} placeholder="例: すでに受け付けています。" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6" />
                  </label>
                )}
              </section>
            ) : (
              <label className="block">
                <span className="text-sm font-medium text-gray-800">開くページのURL</span>
                <input value={input.linkUrl ?? ''} onChange={(e) => patch({ linkUrl: e.target.value || null })} inputMode="url" placeholder="https://" className={fieldClass} />
              </label>
            )}

            <section className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-medium text-gray-800">締切（なくてもかまいません）</h3>
              <input
                type="datetime-local"
                value={input.deadlineAt ?? ''}
                onChange={(e) => patch({ deadlineAt: e.target.value || null })}
                className={fieldClass}
                aria-label="締切の日時（日本時間）"
              />
              {input.deadlineAt && (
                <div className="mt-3 space-y-3">
                  {input.kind === 'link' && (
                    <label className="block">
                      <span className="text-sm text-gray-700">締切後に開くページ（空なら下の文を表示します）</span>
                      <input value={input.expiredUrl ?? ''} onChange={(e) => patch({ expiredUrl: e.target.value || null })} inputMode="url" placeholder="https://" className={fieldClass} />
                    </label>
                  )}
                  <label className="block">
                    <span className="text-sm text-gray-700">{input.kind === 'link' ? '締切後に表示する文' : '締切後に押されたときの返信'}</span>
                    <textarea value={input.expiredReply ?? ''} onChange={(e) => patch({ expiredReply: e.target.value || null })} maxLength={2000} rows={2} placeholder="受付は終了しました。" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6" />
                  </label>
                </div>
              )}
            </section>

            <label className="flex min-h-[44px] items-center gap-2 border-t border-gray-200 pt-4">
              <input type="checkbox" checked={input.isActive} onChange={(e) => patch({ isActive: e.target.checked })} />
              <span className="text-sm text-gray-800">この動きを使う（外すと、押しても何も起きません）</span>
            </label>

            {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : '削除しますか？'}
        message="送信済みのメッセージのボタンは、押しても何も起きなくなります。一時的に止めたいだけなら、編集画面の「この動きを使う」を外してください。"
        confirmLabel="削除する"
        tone="danger"
        busy={saving}
        onClose={() => { if (!saving) setDeleteTarget(null) }}
        onConfirm={() => void remove()}
      />
    </div>
  )
}
