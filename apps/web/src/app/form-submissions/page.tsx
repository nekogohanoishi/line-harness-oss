'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import { countryFlag } from '@/lib/country-flag'
import Header from '@/components/layout/header'

interface UsedByAccount {
  id: string
  name: string
  country: string | null
  displayOrder: number
  count: number
}

interface Form {
  id: string
  name: string
  description: string | null
  submitCount?: number
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
}

interface FormDetail extends Form {
  fields: Array<{ name: string; label: string; type?: string }>
}

interface Submission {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown>
  createdAt: string
}

const PAGE_SIZE = 20

function formatRelative(iso: string | null): string {
  if (!iso) return '未回答'
  const d = new Date(iso)
  const now = Date.now()
  const diffMin = Math.floor((now - d.getTime()) / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}日前`
  return d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function FormSubmissionsPage() {
  const [forms, setForms] = useState<Form[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [detailSubmission, setDetailSubmission] = useState<Submission | null>(null)

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Form[] }>('/api/forms')
      if (res.success) setForms(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadForms() }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setPage(1)
    setDetailSubmission(null)
    try {
      const formRes = await fetchApi<{ success: boolean; data: FormDetail | { fields: string | FormDetail['fields'] } }>(`/api/forms/${formId}`)
      const subRes = await fetchApi<{ success: boolean; data: Submission[] }>(`/api/forms/${formId}/submissions`)

      // Race-guard: only apply if user hasn't switched away
      setSelectedFormId((current) => {
        if (current !== formId) return current
        if (formRes.success) {
          const rawFields = (formRes.data as { fields: unknown }).fields
          const fields = typeof rawFields === 'string'
            ? (JSON.parse(rawFields) as Array<{ name: string; label: string }>)
            : (rawFields as Array<{ name: string; label: string }>)
          const labels: Record<string, string> = {}
          for (const f of fields ?? []) labels[f.name] = f.label
          setFieldLabels(labels)
        }
        if (subRes.success) {
          setSubmissions(
            subRes.data.map((s) => ({
              ...s,
              data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
              friendName: s.friendName ?? null,
            })),
          )
        }
        return current
      })
    } catch { /* silent */ }
    setSelectedFormId((current) => {
      if (current === formId) setSubLoading(false)
      return current
    })
  }, [])

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    loadSubmissions(formId)
  }

  const selectedForm = useMemo(
    () => forms.find((f) => f.id === selectedFormId) ?? null,
    [forms, selectedFormId],
  )

  const totalPages = Math.max(1, Math.ceil(submissions.length / PAGE_SIZE))
  const paged = submissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const fieldKeys = useMemo(
    () =>
      submissions.length > 0
        ? [...new Set(submissions.flatMap((s) => Object.keys(s.data)))]
        : [],
    [submissions],
  )

  return (
    <div>
      <Header title="フォーム回答" description="送信されたフォームを件数・配信アカウント・回答内容まで一覧で確認" />

      {/* Form cards */}
      <section className="mb-6">
        {loading ? (
          <div className="text-sm text-gray-400">読み込み中...</div>
        ) : forms.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
            フォームがまだありません
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {forms.map((form) => {
              const isSelected = selectedFormId === form.id
              const totalCount = form.usedByAccounts.reduce((sum, a) => sum + a.count, 0)
              const displayCount = form.submitCount ?? totalCount
              return (
                <button
                  key={form.id}
                  onClick={() => handleSelectForm(form.id)}
                  className={`group text-left rounded-xl border p-4 transition-all ${
                    isSelected
                      ? 'border-[#06C755] bg-[#F1FBF5] shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className={`text-sm font-semibold leading-snug ${isSelected ? 'text-[#06C755]' : 'text-gray-900'}`}>
                      {form.name}
                    </h3>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">
                      {formatRelative(form.lastSubmittedAt)}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-2xl font-bold text-gray-900 tabular-nums">{displayCount}</span>
                    <span className="text-xs text-gray-400">件の回答</span>
                  </div>

                  {form.usedByAccounts.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {form.usedByAccounts.map((acc) => {
                        const flag = countryFlag(acc.country)
                        return (
                          <span
                            key={acc.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-[11px] text-gray-700"
                            title={`${acc.name}: ${acc.count}件`}
                          >
                            {flag && <span>{flag}</span>}
                            <span className="font-medium">{acc.name}</span>
                            <span className="text-gray-400 tabular-nums">{acc.count}</span>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-300">配信中アカウントなし</div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Submissions table */}
      {selectedForm && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="min-w-0 truncate text-base font-semibold text-gray-900">{selectedForm.name}</h2>
              <span className="flex-shrink-0 text-xs text-gray-400">
                {subLoading ? '読み込み中...' : `${submissions.length}件`}
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedFormId(null)
                setSubmissions([])
                setDetailSubmission(null)
              }}
              className="-mr-2 flex min-h-11 flex-shrink-0 items-center px-2 text-xs text-gray-400 hover:text-gray-600 sm:min-h-0"
            >
              閉じる ✕
            </button>
          </div>

          {subLoading ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">読み込み中...</div>
          ) : submissions.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">回答がありません</div>
          ) : (
            <>
              {/* モバイル: 横スクロールの表ではなく1件1カードで縦に積む */}
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white lg:hidden">
                {paged.map((sub) => (
                  <li key={sub.id}>
                    <button
                      type="button"
                      onClick={() => setDetailSubmission(sub)}
                      className="w-full px-4 py-3.5 text-left active:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                          {sub.friendName || '不明'}
                        </span>
                        <span className="flex-shrink-0 text-[11px] text-gray-400">
                          {new Date(sub.createdAt).toLocaleString('ja-JP', {
                            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {fieldKeys.length > 0 && (
                        <dl className="mt-2 space-y-1">
                          {fieldKeys.slice(0, 3).map((key) => (
                            <div key={key} className="flex gap-2 text-xs">
                              <dt className="w-24 flex-shrink-0 truncate text-gray-400">{fieldLabels[key] || key}</dt>
                              <dd className="min-w-0 flex-1 truncate text-gray-700">{formatValue(sub.data[key])}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {fieldKeys.length > 3 && (
                        <p className="mt-1.5 text-[11px] text-gray-400">他 {fieldKeys.length - 3} 項目</p>
                      )}
                    </button>
                    {sub.friendId && (
                      <div className="px-4 pb-3">
                        <Link
                          href={`/chats?friend=${encodeURIComponent(sub.friendId)}`}
                          className="inline-flex min-h-9 items-center text-xs font-medium text-[#06C755] hover:underline"
                        >
                          チャットを開く
                        </Link>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div className="hidden bg-white rounded-lg border border-gray-200 overflow-x-auto lg:block">
                <table className="w-full min-w-[700px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">名前</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                      {fieldKeys.slice(0, 4).map((key) => (
                        <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                          {fieldLabels[key] || key}
                        </th>
                      ))}
                      {fieldKeys.length > 4 && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">…</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paged.map((sub) => (
                      <tr
                        key={sub.id}
                        onClick={() => setDetailSubmission(sub)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                          {sub.friendId ? (
                            <Link
                              href={`/chats?friend=${encodeURIComponent(sub.friendId)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[#06C755] hover:underline"
                            >
                              {sub.friendName || '不明'}
                            </Link>
                          ) : (
                            <span>{sub.friendName || '不明'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(sub.createdAt).toLocaleString('ja-JP', {
                            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        {fieldKeys.slice(0, 4).map((key) => (
                          <td key={key} className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">
                            {formatValue(sub.data[key])}
                          </td>
                        ))}
                        {fieldKeys.length > 4 && (
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">他 {fieldKeys.length - 4} 項目</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex flex-col gap-2 mt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-gray-400">
                    {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="min-h-[44px] flex-1 px-4 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 sm:flex-none sm:min-h-0 sm:py-1.5"
                    >
                      前へ
                    </button>
                    <span className="px-2 text-sm text-gray-500 whitespace-nowrap">{page} / {totalPages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="min-h-[44px] flex-1 px-4 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 sm:flex-none sm:min-h-0 sm:py-1.5"
                    >
                      次へ
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Detail panel — 狭幅ではボトムシート、sm 以上は従来どおり右からのドロワー */}
      {detailSubmission && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-stretch sm:justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setDetailSubmission(null)}
            aria-hidden
          />
          <aside className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">回答詳細</h3>
              <button
                onClick={() => setDetailSubmission(null)}
                className="-mr-2 flex h-11 w-11 items-center justify-center text-gray-400 hover:text-gray-600 text-xl leading-none"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">回答者</div>
                {detailSubmission.friendId ? (
                  <Link
                    href={`/chats?friend=${encodeURIComponent(detailSubmission.friendId)}`}
                    className="inline-flex items-center gap-2 text-sm text-[#06C755] hover:underline"
                  >
                    <span className="font-medium">{detailSubmission.friendName || '不明'}</span>
                    <span className="text-[11px] text-gray-400">→ チャットを開く</span>
                  </Link>
                ) : (
                  <span className="text-sm text-gray-700">{detailSubmission.friendName || '不明'}</span>
                )}
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">送信日時</div>
                <div className="text-sm text-gray-700">{formatDateTime(detailSubmission.createdAt)}</div>
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">回答内容</div>
                <dl className="space-y-3">
                  {fieldKeys.length === 0 ? (
                    <div className="text-sm text-gray-400">項目なし</div>
                  ) : (
                    fieldKeys.map((key) => (
                      <div key={key} className="grid grid-cols-1 gap-1">
                        <dt className="text-[11px] text-gray-500">{fieldLabels[key] || key}</dt>
                        <dd className="text-sm text-gray-900 break-words whitespace-pre-wrap">
                          {formatValue(detailSubmission.data[key])}
                        </dd>
                      </div>
                    ))
                  )}
                </dl>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
