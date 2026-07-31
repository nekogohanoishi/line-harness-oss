'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import EditDialog, { type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'
import { ResponsiveTable, EmptyState } from '@/components/ui'

interface EffectiveAccount {
  accountId: string
  accountName: string
  status: 'reply' | 'silent' | 'not_applicable'
  via: 'inline' | 'automation' | null
}

interface AutoReply {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  createdAt: string
  effectiveAccounts?: EffectiveAccount[]
}

interface TemplateLite {
  id: string
  name: string
  messageType: string
  messageContent: string
}

const matchTypeLabel: Record<'exact' | 'contains', string> = { exact: '完全一致', contains: '包含' }

/** 適用アカウントバッジの凡例 (モバイルは折りたたみ / デスクトップは常時表示で使い回す) */
const legend = (
  <>
    <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ アカ名</span> 返信あり (inline) / <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ アカ名 ⚙</span> automation 経由</p>
    <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">⚠ アカ名</span> silent rule のみ — match するが返信しない (同 keyword の automation rule 未登録)</p>
    <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-50 text-gray-300 line-through">アカ名</span> 適用外 (line_account_id が別アカに固定)</p>
  </>
)

export default function AutoRepliesPage() {
  const { selectedAccountId, accounts } = useAccount()
  const [items, setItems] = useState<AutoReply[]>([])
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AutoReplyDraft | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [arRes, tplRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(),
      ])
      if (arRes.success) setItems(arRes.data)
      if (tplRes.success) setTemplates(tplRes.data.map((t) => ({
        id: t.id,
        name: t.name,
        messageType: t.messageType,
        messageContent: t.messageContent,
      })))
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const templateById = new Map(templates.map((t) => [t.id, t]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const renderEffectiveCell = (r: AutoReply) => {
    if (!r.effectiveAccounts || r.effectiveAccounts.length === 0) {
      // 古い shape の fallback (effectiveAccounts 計算前)
      if (!r.lineAccountId) return <span className="text-gray-400 italic">全アカウント</span>
      const acc = accountById.get(r.lineAccountId)
      return <span className="text-gray-700">{acc?.displayName ?? acc?.name ?? r.lineAccountId.slice(0, 8)}</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {r.effectiveAccounts.map((ea) => {
          const acc = accountById.get(ea.accountId)
          const label = acc?.displayName ?? acc?.name ?? ea.accountName
          if (ea.status === 'not_applicable') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-50 text-gray-300 line-through"
                title={`${label}: 適用外 (line_account_id 別アカ固定)`}
              >
                {label}
              </span>
            )
          }
          if (ea.status === 'reply') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-medium"
                title={`${label}: 返信あり (${ea.via === 'automation' ? 'automation 経由' : 'inline'})`}
              >
                ✓ {label}{ea.via === 'automation' && <span className="text-green-500">⚙</span>}
              </span>
            )
          }
          // silent
          return (
            <span
              key={ea.accountId}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700"
              title={`${label}: silent (match するが返信なし — automation rule 未登録)`}
            >
              ⚠ {label}
            </span>
          )
        })}
      </div>
    )
  }

  const renderResponseCell = (r: AutoReply) => {
    if (r.responseType === 'silent') return <span className="text-gray-400 text-xs">silent</span>
    if (r.responseType === 'flex') return <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-medium">📋 flex</span>
    if (r.responseType === 'image') return <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">🖼️ image</span>
    return <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-medium">📝 text</span>
  }

  const renderTemplateCell = (r: AutoReply) => {
    if (!r.templateId) return <span className="text-[11px] text-gray-400 italic">(inline)</span>
    const tpl = templateById.get(r.templateId)
    return (
      <Link href="/templates" className="text-blue-600 hover:underline text-xs">
        🔗 {tpl?.name ?? `(未知 ${r.templateId.slice(0, 6)})`}
      </Link>
    )
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    try {
      await api.autoReplies.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="自動返信ルール"
        action={
          <button
            onClick={() => setEditing({
              keyword: '',
              matchType: 'exact',
              responseType: 'text',
              responseContent: '',
              templateId: null,
              lineAccountId: selectedAccountId,
              isActive: true,
            })}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規ルール
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 凡例。モバイルでは縦に長くなるため折りたたみ、sm 以上は従来どおり開いたまま表示する */}
      <details className="mb-4 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-800 sm:hidden">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center px-3 font-medium">
          バッジの見かた
        </summary>
        <div className="space-y-1 px-3 pb-3">{legend}</div>
      </details>
      <div className="mb-4 hidden rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 sm:block">
        <div className="space-y-1">{legend}</div>
      </div>

      <ResponsiveTable
        rows={items}
        loading={loading}
        rowKey={(r) => r.id}
        className="shadow-sm"
        empty={<EmptyState size="sm" title="自動返信ルールがありません" />}
        columns={[
          {
            key: 'keyword',
            label: 'keyword',
            priority: 'primary',
            render: (r) => <span className="text-sm font-medium text-gray-900 break-words">{r.keyword}</span>,
          },
          {
            key: 'isActive',
            label: '状態',
            priority: 'meta',
            render: (r) => (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${r.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {r.isActive ? '有効' : '無効'}
              </span>
            ),
          },
          { key: 'matchType', label: 'match', render: (r) => matchTypeLabel[r.matchType] },
          { key: 'response', label: 'response', render: renderResponseCell },
          { key: 'template', label: 'template', render: renderTemplateCell },
          { key: 'effective', label: '適用アカウント', render: renderEffectiveCell },
        ]}
        actions={(r) => (
          <>
            <button
              onClick={() => setEditing({
                id: r.id,
                keyword: r.keyword,
                matchType: r.matchType,
                responseType: r.responseType,
                responseContent: r.responseContent,
                templateId: r.templateId,
                lineAccountId: r.lineAccountId,
                isActive: r.isActive,
              })}
              className="px-2.5 py-1 min-h-[44px] sm:min-h-0 text-xs font-medium text-blue-600 bg-blue-50 sm:bg-transparent hover:bg-blue-50 rounded-md"
            >
              編集
            </button>
            <button
              onClick={() => handleDelete(r.id)}
              className="px-2.5 py-1 min-h-[44px] sm:min-h-0 text-xs font-medium text-red-500 bg-red-50 sm:bg-transparent hover:bg-red-50 rounded-md"
            >
              削除
            </button>
          </>
        )}
      />


      {editing && (
        <EditDialog
          draft={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
