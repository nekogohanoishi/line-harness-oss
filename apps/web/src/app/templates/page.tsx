'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import TemplateMessageEditor, { validateTemplateMessage } from '@/components/templates/template-message-editor'
import TemplatePreview, { isFlexLikeType } from '@/components/templates/template-preview'
import { EmptyState, ConfirmSheet } from '@/components/ui'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  usageCount: number
  createdAt: string
  updatedAt: string
}

interface TemplateDetail {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  usedBy: {
    autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>
    automations: Array<{ id: string; name: string; eventType: string }>
  }
  createdAt: string
  updatedAt: string
}

type TypeFilter = 'all' | 'text' | 'flex' | 'image' | 'unused'

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'カード型',
  carousel: 'カルーセル',
}

const typeBadgeColor: Record<string, string> = {
  text: 'bg-gray-100 text-gray-700',
  flex: 'bg-purple-100 text-purple-700',
  image: 'bg-blue-100 text-blue-700',
  carousel: 'bg-amber-100 text-amber-700',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function templateDeleteErrorMessage(message: string): string {
  if (message.includes('automation rule')) {
    return 'このテンプレートはオートメーションで使用中のため削除できません。先に使用しているオートメーションから外してください。'
  }
  return message
}

// 自動化の「きっかけ」の種類 (AutomationEventType) に合わせる
const automationEventLabels: Record<string, string> = {
  friend_add: '友だち追加時',
  tag_change: 'タグ変更時',
  score_threshold: 'スコア到達時',
  cv_fire: 'コンバージョン発生時',
  message_received: 'メッセージ受信時',
  calendar_booked: 'カレンダー予約時',
  webinar_opened: 'ウェビナーページを開いた時',
  webinar_started: 'ウェビナー動画の再生時',
  webinar_completed: 'ウェビナーを最後まで視聴した時',
  webinar_cta_clicked: 'ウェビナーの案内ボタンを押した時',
  webinar_abandoned: 'ウェビナー途中離脱時',
}

// カテゴリの初期値 general は内部の名前なので、画面では「一般」と表示する
const categoryLabel = (category: string) => (category === 'general' ? '一般' : category)

const editEmptyNote = (type: string) =>
  type === 'image' ? '画像のURLを入力すると、ここに表示されます' : '本文を入力すると、ここに表示されます'

const ccPrompts = [
  {
    title: 'テンプレート作成',
    prompt: `新しいメッセージテンプレートの作成をサポートしてください。
1. 用途別（挨拶、キャンペーン、通知、フォローアップ）のテンプレート文例を提案
2. テキスト・Flexメッセージそれぞれの効果的な使い方
3. カテゴリ分類と命名規則のベストプラクティス
手順を示してください。`,
  },
]

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${typeBadgeColor[type] ?? 'bg-gray-100 text-gray-700'}`}>
      {messageTypeLabels[type] ?? 'その他'}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
      {categoryLabel(category)}
    </span>
  )
}

/** 一覧の1行。名前と操作の下に、友だちのトーク画面での見え方 (吹き出し) を置き、行の区切りは線で付ける */
function TemplateRow({
  template,
  selected,
  onOpen,
  onDelete,
}: {
  template: Template
  selected: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    // 開いている行は、ページの左の余白に出す緑線で示す (行の中身の位置をずらさないため)
    <li
      className={`relative border-b border-gray-300 py-4 ${
        selected ? "before:absolute before:-left-3 before:bottom-0 before:top-0 before:w-[3px] before:rounded-full before:bg-green-500 before:content-['']" : ''
      }`}
    >
      {/* 名前と操作は、見た目の行の高さを増やさず、押せる範囲だけ44pxにする (上下の負の余白)。下の行と重なっても押せるよう relative にする */}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="relative -my-2.5 flex min-w-0 flex-1 items-start rounded-md py-2.5 text-left hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span className="min-w-0 break-words text-[15px] font-semibold leading-6 text-gray-900">{template.name}</span>
        </button>
        <div className="relative -my-2.5 flex shrink-0 items-center">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${template.name}を編集`}
            className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-green-700 hover:bg-green-50"
          >
            編集
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${template.name}を削除`}
            className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            削除
          </button>
        </div>
      </div>
      <p className="mb-3 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-gray-600">
        <TypeBadge type={template.messageType} />
        <CategoryBadge category={template.category} />
        <span className={template.usageCount === 0 ? 'text-gray-500' : 'font-medium text-gray-800'}>
          {template.usageCount === 0 ? '未使用' : `${template.usageCount}箇所で使用`}
        </span>
        <span>更新 {formatDate(template.updatedAt)}</span>
      </p>
      <TemplatePreview type={template.messageType} content={template.messageContent} compact />
    </li>
  )
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [form, setForm] = useState({ name: '', category: 'general', messageType: 'text', messageContent: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Drawer
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [drawerData, setDrawerData] = useState<TemplateDetail | null>(null)
  const [scenarioStepUsages, setScenarioStepUsages] = useState<Array<{
    scenarioId: string
    scenarioName: string
    stepId: string
    stepOrder: number
  }>>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string | null>(null)
  const [editName, setEditName] = useState<string | null>(null)
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const createContentRef = useRef<HTMLTextAreaElement | null>(null)
  const editContentRef = useRef<HTMLTextAreaElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.templates.list()
      if (res.success) {
        setTemplates(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('テンプレートの読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Drawer fetch
  useEffect(() => {
    if (!drawerId) { setDrawerData(null); setDrawerError(null); setScenarioStepUsages([]); return }
    let cancelled = false
    setDrawerLoading(true)
    setDrawerError(null)
    setDrawerData(null)
    setScenarioStepUsages([])
    Promise.all([
      api.templates.get(drawerId),
      api.templates.usages(drawerId).catch(() => null),
    ]).then(([detailRes, usagesRes]) => {
      if (cancelled) return
      if (detailRes.success && detailRes.data) {
        setDrawerData(detailRes.data)
      } else {
        setDrawerError((detailRes as { error?: string }).error ?? '読み込みに失敗しました')
      }
      if (usagesRes && usagesRes.success) {
        setScenarioStepUsages(usagesRes.data.scenarioSteps)
      }
    }).catch((err) => {
      if (cancelled) return
      setDrawerError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (!cancelled) setDrawerLoading(false)
    })
    return () => { cancelled = true }
  }, [drawerId])

  // reset edits when drawer changes
  useEffect(() => { setEditContent(null); setEditName(null); setEditError('') }, [drawerId])

  const filteredTemplates = templates.filter((t) => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'unused') return t.usageCount === 0
    return t.messageType === typeFilter
  })

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError('テンプレート名を入力してください'); return }
    const contentError = validateTemplateMessage(form.messageType, form.messageContent)
    if (contentError) { setFormError(contentError); return }
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      const res = await api.templates.create(form)
      if (res.success) {
        setShowCreate(false)
        setForm({ name: '', category: 'general', messageType: 'text', messageContent: '' })
        setNotice('テンプレートを作成しました。')
        load()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!drawerData) return
    if (editContent !== null) {
      const contentError = validateTemplateMessage(drawerData.messageType, editContent)
      if (contentError) {
        setEditError(contentError)
        return
      }
    }
    if (editContent !== null && !editContent.trim()) {
      setEditError('内容を空にはできません')
      return
    }
    if (editName !== null && !editName.trim()) {
      setEditError('名前を空にはできません')
      return
    }
    setSavingEdit(true)
    setEditError('')
    setNotice('')
    try {
      const updates: Record<string, string> = {}
      if (editContent !== null) updates.messageContent = editContent
      if (editName !== null) updates.name = editName
      const updateRes = await api.templates.update(drawerData.id, updates)
      if (!updateRes.success) throw new Error(updateRes.error)
      const r = await api.templates.get(drawerData.id)
      if (r.success && r.data) setDrawerData(r.data)
      setEditContent(null)
      setEditName(null)
      setNotice('変更を保存しました。')
      load()
    } catch (updateError) {
      setEditError(updateError instanceof Error ? updateError.message : '更新に失敗しました')
    }
    setSavingEdit(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError('')
    setNotice('')
    try {
      const res = await api.templates.delete(deleteTarget.id)
      if (!res.success) throw new Error(templateDeleteErrorMessage(res.error))
      if (drawerId === deleteTarget.id) setDrawerId(null)
      setDeleteTarget(null)
      setNotice('テンプレートを削除しました。')
      await load()
    } catch (deleteRequestError) {
      setDeleteError(deleteRequestError instanceof Error ? deleteRequestError.message : '削除に失敗しました')
    } finally {
      setDeleteBusy(false)
    }
  }

  // Flex の編集欄は画面幅で左右2列になるため、細い引き出しだと入力欄が潰れる。読み込み前は一覧の情報で幅を決める
  const drawerType = drawerData?.messageType ?? templates.find((t) => t.id === drawerId)?.messageType ?? ''
  const drawerWide = isFlexLikeType(drawerType)
  const usageTotal = drawerData
    ? drawerData.usedBy.autoReplies.length + drawerData.usedBy.automations.length + scenarioStepUsages.length
    : 0

  return (
    // 右下の「CCに依頼」ボタンに、最後の行が隠れないよう下に余白を取る
    <div className="pb-16">
      <Header
        title="テンプレート管理"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規テンプレート
          </button>
        }
      />

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

      {/* Type filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          { key: 'all', label: '全て' },
          { key: 'text', label: 'テキスト' },
          { key: 'flex', label: 'カード型' },
          { key: 'image', label: '画像' },
          { key: 'unused', label: '未使用' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key)}
            className={`px-4 py-1.5 min-h-[44px] text-xs font-medium rounded-full transition-colors ${
              typeFilter === key ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={typeFilter === key ? { backgroundColor: '#06C755' } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Create form: 箱で囲まず、上の太線と見出しで区切る */}
      {showCreate && (
        <section className="mb-8 border-t-2 border-gray-900 pt-3" aria-labelledby="template-create-heading">
          <h2 id="template-create-heading" className="text-lg font-bold text-gray-900">新規テンプレートを作成</h2>
          {/* Flex の編集欄は左右2列になるので、広めに取る */}
          <div className={`mt-4 space-y-4 ${isFlexLikeType(form.messageType) ? 'max-w-3xl' : 'max-w-lg'}`}>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">名前 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full min-h-[44px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 申し込み案内のカード"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ</label>
              <input
                type="text"
                className="w-full min-h-[44px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 挨拶、返信、案内"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">タイプ</label>
              <select
                className="w-full min-h-[44px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={form.messageType}
                onChange={(e) => setForm({ ...form, messageType: e.target.value, messageContent: '' })}
              >
                <option value="text">テキスト</option>
                <option value="flex">カード型</option>
                <option value="image">画像</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-gray-600">
                メッセージ内容 <span className="text-red-500">*</span>
              </div>
              <TemplateMessageEditor
                messageType={form.messageType}
                value={form.messageContent}
                onChange={(nextValue) => setForm({ ...form, messageContent: nextValue })}
                textRef={createContentRef}
              />
              {/* Flex の編集欄はプレビューを中に持つので、ここでは出さない (2か所になる)。
                  テキストと画像は入力欄の下に置く。上に置くと、入力で吹き出しが伸びるたびに入力欄が下へ動く */}
              {!isFlexLikeType(form.messageType) && (
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-medium text-gray-600">友だちの画面での見え方</h3>
                  <TemplatePreview type={form.messageType} content={form.messageContent} emptyNote={editEmptyNote(form.messageType)} />
                </div>
              )}
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex flex-col sm:flex-row gap-2 sticky bottom-0 bg-gray-50 pt-2 pb-1 -mx-4 px-4 sm:static sm:mx-0 sm:px-0 sm:pt-0 sm:pb-0">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setFormError('') }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </section>
      )}

      {/* List: 1通ごとに吹き出しで見せ、行の間は線で区切る */}
      {loading ? (
        <div role="status" aria-label="テンプレートを読み込み中" className="max-w-3xl border-t border-gray-300">
          {[...Array(3)].map((_, i) => (
            <div key={i} aria-hidden className="animate-pulse border-b border-gray-300 py-4">
              <div className="h-4 w-48 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-40 rounded bg-gray-100" />
              <div className="mt-3 h-20 max-w-2xl rounded-xl bg-[#E8EEF6]" />
            </div>
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <EmptyState size="sm" title="該当するテンプレートがありません" />
      ) : (
        <ul className="max-w-3xl border-t border-gray-300">
          {filteredTemplates.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              selected={drawerId === t.id}
              onOpen={() => setDrawerId(t.id)}
              onDelete={() => {
                setDeleteTarget(t)
                setDeleteError('')
              }}
            />
          ))}
        </ul>
      )}

      {/* Drawer: スマホでは画面いっぱい (上のメニューバーも覆う)。入力欄とプレビューを細い2列にしないため、Flex のときは広げる */}
      {drawerId && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-30 lg:hidden"
            onClick={() => setDrawerId(null)}
          />
          <aside
            aria-label="テンプレートの内容と編集"
            className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-gray-200 bg-white shadow-xl ${drawerWide ? 'lg:w-[760px]' : 'lg:w-[480px]'}`}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white pl-4 pr-1">
              <div className="min-w-0 flex-1">
                {editName !== null ? (
                  <input
                    type="text"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="テンプレートの名前"
                    className="my-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                ) : (
                  <h3 className="min-w-0 text-sm font-semibold">
                    <button
                      type="button"
                      disabled={!drawerData}
                      onClick={() => setEditName(drawerData?.name ?? '')}
                      title="クリックで名前を変更"
                      className="flex min-h-[52px] w-full items-center gap-2 text-left"
                    >
                      <span className="min-w-0 truncate">{drawerData?.name ?? '読み込み中...'}</span>
                      {drawerData && <span className="shrink-0 text-xs font-medium text-blue-700">名前を変更</span>}
                    </button>
                  </h3>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDrawerId(null)}
                aria-label="閉じる"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {drawerLoading ? (
                <p role="status" className="p-6 text-sm text-gray-500">読み込み中...</p>
              ) : drawerError ? (
                <div className="p-6">
                  <p className="text-sm text-red-600 mb-2">読み込みに失敗しました</p>
                  <p className="text-xs text-gray-500">{drawerError}</p>
                </div>
              ) : !drawerData ? null : (
                // 下は、右下の「CCに依頼」ボタンに使用箇所が隠れないための余白
                <div className="space-y-6 p-4 pb-24">
                  <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={drawerData.messageType} />
                    <CategoryBadge category={drawerData.category} />
                    <span className="text-xs text-gray-500">
                      更新: {formatDate(drawerData.updatedAt)}
                    </span>
                  </div>

                  <section>
                    <h4 className="mb-2 text-sm font-semibold text-gray-900">メッセージ内容</h4>
                    <TemplateMessageEditor
                      messageType={drawerData.messageType}
                      value={editContent ?? drawerData.messageContent}
                      onChange={setEditContent}
                      textRef={editContentRef}
                    />
                    {/* Flex の編集欄はプレビューを中に持つので、ここでは出さない (2か所になる)。
                        テキストと画像は入力欄の下に置く。上に置くと、入力で吹き出しが伸びるたびに入力欄が下へ動く */}
                    {!isFlexLikeType(drawerData.messageType) && (
                      <div className="mt-5">
                        <h5 className="mb-2 text-xs font-medium text-gray-600">友だちの画面での見え方</h5>
                        <TemplatePreview
                          type={drawerData.messageType}
                          content={editContent ?? drawerData.messageContent}
                          emptyNote={editEmptyNote(drawerData.messageType)}
                        />
                      </div>
                    )}
                  </section>

                  {/* Used by */}
                  <section>
                    <h4 className="mb-1 text-sm font-semibold text-gray-900">使用箇所（{usageTotal}）</h4>
                    {usageTotal === 0 ? (
                      <p className="text-sm text-gray-500">どこからも使用されていません</p>
                    ) : (
                      <>
                        <p className="mb-2 text-xs leading-5 text-amber-800">
                          このテンプレートを修正すると、下記すべてに反映されます
                        </p>
                        <ul className="divide-y divide-gray-200 border-y border-gray-200 text-sm">
                          {drawerData.usedBy.autoReplies.map((ar) => (
                            <li key={`ar-${ar.id}`}>
                              <Link href="/auto-replies" className="flex min-h-[44px] items-center py-2 text-blue-700 hover:underline">
                                <span className="min-w-0 break-words">
                                  自動返信：{ar.keyword} <span className="text-gray-500">（{ar.matchType === 'exact' ? '完全一致' : '部分一致'}）</span>
                                </span>
                              </Link>
                            </li>
                          ))}
                          {drawerData.usedBy.automations.map((au) => (
                            <li key={`au-${au.id}`}>
                              <Link href="/automations" className="flex min-h-[44px] items-center py-2 text-blue-700 hover:underline">
                                <span className="min-w-0 break-words">
                                  オートメーション：{au.name} <span className="text-gray-500">（{automationEventLabels[au.eventType] ?? 'その他の条件'}）</span>
                                </span>
                              </Link>
                            </li>
                          ))}
                          {scenarioStepUsages.map((ss) => (
                            <li key={`ss-${ss.stepId}`}>
                              <Link href={`/scenarios/detail?id=${ss.scenarioId}`} className="flex min-h-[44px] items-center py-2 text-blue-700 hover:underline">
                                <span className="min-w-0 break-words">
                                  シナリオ：{ss.scenarioName} <span className="text-gray-500">（{ss.stepOrder}番目）</span>
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                </div>
              )}
            </div>

            {/* 変更があるときだけ、保存の操作を画面の下に固定する。右の余白は「CCに依頼」ボタンを避けるため */}
            {drawerData && (editContent !== null || editName !== null) && (
              <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 pr-20 sm:pr-4">
                {editError && (
                  <p role="alert" className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {editError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className="min-h-[44px] flex-1 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50 sm:flex-none"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {savingEdit ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={() => { setEditContent(null); setEditName(null); setEditError('') }}
                    className="min-h-[44px] flex-1 rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 sm:flex-none"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </aside>
        </>
      )}

      {/* 右下のボタンは、削除の確認シートより前に置く (同じ z-50 で、後ろに置くと確認ボタンに重なる) */}
      <CcPromptButton prompts={ccPrompts} />

      <ConfirmSheet
        open={Boolean(deleteTarget)}
        title="テンプレートを削除しますか？"
        message={deleteTarget?.usageCount
          ? `「${deleteTarget.name}」は${deleteTarget.usageCount}箇所で使用されています。自動返信やシナリオでは参照が外れますが、オートメーションで使用中の場合は削除できません。`
          : `「${deleteTarget?.name ?? ''}」を削除します。この操作は元に戻せません。`}
        confirmLabel="削除する"
        tone="danger"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={handleDelete}
        onClose={() => {
          if (deleteBusy) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      />
    </div>
  )
}
