'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { api } from '@/lib/api'
import MessageVariableButton from '@/components/message-variable-button'
import FlexContentEditor from './flex-content-editor'
import SequenceEditor from './sequence-editor'
import { defaultSequenceMessage, stringifySequenceDocument } from './auto-reply-editor-utils'

export interface AutoReplyDraft {
  id?: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
}

interface Props {
  draft: AutoReplyDraft
  templates: Array<{ id: string; name: string; messageType: string; messageContent: string }>
  onClose: () => void
  onSaved: () => void
}

type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image' | 'inline-sequence'

function detectMode(d: AutoReplyDraft): ResponseMode {
  if (d.responseType === 'silent') return 'silent'
  if (d.templateId) return 'template'
  if (d.responseType === 'sequence') return 'inline-sequence'
  if (d.responseType === 'flex') return 'inline-flex'
  if (d.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

export default function EditDialog({ draft, templates, onClose, onSaved }: Props) {
  const [keyword, setKeyword] = useState(draft.keyword)
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(draft.matchType)
  const [mode, setMode] = useState<ResponseMode>(detectMode(draft))
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId)
  const [responseContent, setResponseContent] = useState(draft.responseContent)
  const [isActive, setIsActive] = useState(draft.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const responseContentRef = useRef<HTMLTextAreaElement | null>(null)

  const flexTemplates = templates.filter((t) => t.messageType === 'flex')
  const textTemplates = templates.filter((t) => t.messageType === 'text')
  const imageTemplates = templates.filter((t) => t.messageType === 'image')

  const handleModeChange = (nextMode: ResponseMode) => {
    if (nextMode === mode) return
    if (nextMode === 'inline-sequence') {
      const first = defaultSequenceMessage('text')
      if (mode === 'inline-text' && responseContent.trim()) first.messageContent = responseContent
      setResponseContent(stringifySequenceDocument({ messages: [first] }))
    } else if (nextMode === 'inline-flex') {
      setResponseContent(JSON.stringify({
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: 'lg',
          contents: [{
            type: 'text',
            text: mode === 'inline-text' ? responseContent : '',
            size: 'md',
            color: '#111827',
            wrap: true,
          }],
        },
      }))
    } else if (nextMode === 'inline-image') {
      setResponseContent(JSON.stringify({ originalContentUrl: '', previewImageUrl: '' }))
    } else if (nextMode === 'inline-text' && mode !== 'inline-text') {
      setResponseContent('')
    }
    setMode(nextMode)
  }

  const imageContent = (() => {
    try {
      return JSON.parse(responseContent) as { originalContentUrl?: string; previewImageUrl?: string }
    } catch {
      return {}
    }
  })()

  const handleSave = async () => {
    if (!keyword.trim()) { setError('受信する言葉を入力してください'); return }
    if (mode === 'template' && !templateId) { setError('使用するテンプレートを選んでください'); return }
    if ((mode === 'inline-text' || mode === 'inline-flex' || mode === 'inline-image' || mode === 'inline-sequence') && !responseContent.trim()) {
      setError('内容を入力してください'); return
    }
    setError('')
    setSaving(true)
    try {
      const body: {
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
      } = {
        keyword,
        matchType,
        responseType:
          mode === 'silent' ? 'silent'
          : mode === 'inline-sequence' ? 'sequence'
          : mode === 'inline-flex' ? 'flex'
          : mode === 'inline-image' ? 'image'
          : mode === 'template' ? 'text' /* placeholder, override below if template found */
          : 'text',
        // template mode でも response_content / response_type を残す。template が
        // 削除された (ON DELETE SET NULL) ときの inline fallback として機能する。
        responseContent: mode === 'silent' ? '' : responseContent,
        templateId: mode === 'template' ? templateId : null,
        lineAccountId: draft.lineAccountId,
        isActive,
      }
      if (mode === 'template' && templateId) {
        const tpl = templates.find((t) => t.id === templateId)
        if (tpl) {
          body.responseType = tpl.messageType
          // template が削除された (ON DELETE SET NULL) ときの inline fallback として
          // 現時点の template content をスナップショット保存する。これがないと
          // template 削除後に webhook が空メッセージ送信になる。
          body.responseContent = tpl.messageContent
        }
      }
      if (draft.id) {
        await api.autoReplies.update(draft.id, body)
      } else {
        await api.autoReplies.create(body)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
    setSaving(false)
  }

  return (
    // モバイルはボトムシート、sm 以上は従来どおり中央のダイアログ
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className={`bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-h-[92vh] sm:max-h-[90vh] flex flex-col ${mode === 'inline-sequence' || mode === 'inline-flex' ? 'sm:max-w-6xl' : 'sm:max-w-lg'}`}>
        <div className="shrink-0 px-4 sm:px-5 py-4 border-b">
          <h3 className="text-base font-semibold">{draft.id ? '自動返信を編集' : '自動返信を作成'}</h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">受信する言葉</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例：解説速報を受け取る"
            />
            <p className="mt-1 text-xs text-gray-500">友だちがこの言葉を送ると、自動返信が始まります。</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">言葉の判定方法</label>
            <div className="flex gap-2">
              {(['exact', 'contains'] as const).map((mt) => (
                <button
                  key={mt}
                  type="button"
                  onClick={() => setMatchType(mt)}
                  className={`px-4 py-1.5 min-h-[44px] text-xs rounded-md ${matchType === mt ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  style={matchType === mt ? { backgroundColor: '#06C755' } : undefined}
                >
                  {mt === 'exact' ? '同じ言葉だけ' : '文章に含まれていれば反応'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">返信内容の作り方</label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'silent', label: '返信しない' },
                { key: 'template', label: 'テンプレートを使う' },
                { key: 'inline-text', label: 'テキスト' },
                { key: 'inline-flex', label: 'ボタン付きメッセージ' },
                { key: 'inline-image', label: '画像' },
                { key: 'inline-sequence', label: '複数メッセージ' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleModeChange(key)}
                  className={`px-4 py-1.5 min-h-[44px] text-xs rounded-md ${mode === key ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  style={mode === key ? { backgroundColor: '#06C755' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'template' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">使用するテンプレート</label>
              <select
                value={templateId ?? ''}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">選択してください</option>
                {flexTemplates.length > 0 && (
                  <optgroup label="ボタン付きメッセージ">
                    {flexTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {textTemplates.length > 0 && (
                  <optgroup label="テキスト">
                    {textTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {imageTemplates.length > 0 && (
                  <optgroup label="画像">
                    {imageTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {templates.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  テンプレートがありません。<Link href="/templates" className="underline">テンプレートの画面</Link>で作成してください。
                </p>
              )}
            </div>
          )}
          {mode === 'inline-text' && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-gray-600">送信する文章</label>
                <MessageVariableButton
                  targetRef={responseContentRef}
                  value={responseContent}
                  onChange={setResponseContent}
                />
              </div>
              <textarea
                ref={responseContentRef}
                rows={7}
                value={responseContent}
                onChange={(e) => setResponseContent(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-green-500 resize-y min-h-[160px]"
              />
            </div>
          )}
          {mode === 'inline-flex' && (
            <FlexContentEditor value={responseContent} onChange={setResponseContent} />
          )}
          {mode === 'inline-image' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">画像URL</label>
                <input
                  type="url"
                  value={imageContent.originalContentUrl ?? ''}
                  onChange={(event) => setResponseContent(JSON.stringify({
                    ...imageContent,
                    originalContentUrl: event.target.value,
                  }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">プレビュー画像URL</label>
                <input
                  type="url"
                  value={imageContent.previewImageUrl ?? ''}
                  onChange={(event) => setResponseContent(JSON.stringify({
                    ...imageContent,
                    previewImageUrl: event.target.value,
                  }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
          )}
          {mode === 'inline-sequence' && (
            <SequenceEditor value={responseContent} onChange={setResponseContent} />
          )}
          <label className={`flex min-h-[52px] cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 ${isActive ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
            <span>
              <span className={`block text-sm font-medium ${isActive ? 'text-green-800' : 'text-gray-700'}`}>
                {isActive ? 'この自動返信は有効です' : 'この自動返信は停止中です'}
              </span>
              <span className="block text-xs text-gray-500">
                {isActive ? '条件に一致すると自動で返信します。' : '保存しても自動返信は行われません。'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="shrink-0 px-4 sm:px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="flex-1 sm:flex-none px-3 py-1.5 min-h-[44px] text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 sm:flex-none px-3 py-1.5 min-h-[44px] text-xs font-medium text-white rounded-md disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
