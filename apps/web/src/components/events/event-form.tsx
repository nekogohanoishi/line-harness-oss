'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { eventsApi, type EventDetail, type EventSlot } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { formatJstDateTime, formatJstTime } from '@line-crm/shared'
import { generateBulkSlots, type BulkSlotInput } from './bulk-slot-generator'
import WebinarSettingsTab from '@/components/webinar/webinar-settings-tab'
import Sheet, { SheetButton, ConfirmSheet } from '@/components/ui/sheet'
import PageHeader from '@/components/ui/page-header'
import EmptyState from '@/components/ui/empty-state'

// ----------------------------------------------------------------
// フォーム共通の小物。長いフォームを見出し付きのまとまりに割り、
// スマホでどこまでが 1 設定なのかを分かるようにする。
// ----------------------------------------------------------------

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-gray-200 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  )
}

/** ラベル + 入力。ラベルは常に入力の上に置く (狭い画面での横並びを避ける)。 */
function Field({
  label,
  required,
  hint,
  suffix,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  /** ラベル行の右端に出す補助表示 (文字数カウンタなど)。 */
  suffix?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-sm font-medium text-gray-700 mb-1.5">
        <span>
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {suffix}
      </span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  )
}

// 入力欄の共通クラス。min-h-11 で iOS のタップ領域を確保する。
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 min-h-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const selectClass = `${inputClass} bg-white`

type Tab = 'overview' | 'slots' | 'publish' | 'webinar'

type TabDef = { key: Tab; label: string; saveLabel: string; sub: string }

// Webinar Launch (migration 041): kind='webinar' のときのみ「ウェビナー設定」
// タブを差し込む。順序は「概要 → 予約枠 → ウェビナー設定 → 公開設定」とし、
// 既存 standard イベントの並び (概要→予約枠→公開設定) を温存する。
function buildTabs(kind: 'standard' | 'webinar'): TabDef[] {
  const base: TabDef[] = [
    { key: 'overview', label: '1. 概要', saveLabel: '概要を保存', sub: 'イベント名・場所・詳細を入力' },
    { key: 'slots', label: '2. 予約枠', saveLabel: '', sub: '友だちが選べる日時を追加' },
  ]
  if (kind === 'webinar') {
    base.push({ key: 'webinar', label: '3. ウェビナー設定', saveLabel: '', sub: '動画・CTA・視聴統計' })
    base.push({ key: 'publish', label: '4. 公開設定', saveLabel: '公開設定を保存', sub: '承認制・リマインダ・公開' })
  } else {
    base.push({ key: 'publish', label: '3. 公開設定', saveLabel: '公開設定を保存', sub: '承認制・リマインダ・公開' })
  }
  return base
}

const DEFAULT_DRAFT: EventDetail = {
  id: '',
  name: '',
  venue_name: null,
  venue_url: null,
  image_url: null,
  description: null,
  description_centered: 0,
  max_bookings_per_friend: null,
  requires_approval: 0,
  cancel_deadline_hours_before: null,
  reminder_day_before_enabled: 1,
  reminder_hours_before: null,
  is_published: 0,
  sort_order: 0,
  // Webinar Launch (migration 041) のデフォルト。
  // 新規作成時にユーザーが「ウェビナー」を選ぶと kind='webinar' に切替わる。
  kind: 'standard',
  replay_window_minutes: 1440,
  attendance_threshold_seconds: null,
  archive_url: null,
}

export interface EventFormProps {
  accountId: string
  eventId: string | null
}

function jstNow(): Date {
  return new Date(Date.now())
}

export default function EventForm({ accountId, eventId }: EventFormProps) {
  const router = useRouter()
  const { selectedAccount, accounts } = useAccount()
  const [tab, setTab] = useState<Tab>('overview')
  const [draft, setDraft] = useState<EventDetail>(DEFAULT_DRAFT)
  const [slots, setSlots] = useState<EventSlot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedValue, setCopiedValue] = useState<string | null>(null)

  async function copyValue(v: string) {
    try {
      await navigator.clipboard.writeText(v)
      setCopiedValue(v)
      setTimeout(() => setCopiedValue(null), 2000)
    } catch {
      window.prompt('コピーしてください:', v)
    }
  }

  const liffId = selectedAccount?.liffId ?? null
  const liffUrl = eventId && liffId
    ? `https://liff.line.me/${liffId}/?page=event&id=${eventId}`
    : null

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!eventId) {
        setLoading(false)
        return
      }
      try {
        const [ev, slotsRes] = await Promise.all([
          eventsApi.getEvent(accountId, eventId),
          eventsApi.listSlots(accountId, eventId),
        ])
        if (cancelled) return
        setDraft(ev)
        setSlots(slotsRes.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [accountId, eventId])

  function update<K extends keyof EventDetail>(key: K, value: EventDetail[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function flashToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  async function save(nextTab?: Tab) {
    setSaving(true)
    setError(null)
    try {
      if (!draft.name.trim()) throw new Error('イベント名は必須です')
      if (draft.name.length > 255) throw new Error('イベント名は255字以内で入力してください')
      if (draft.description && draft.description.length > 20000) {
        throw new Error('詳細は20000字以内で入力してください')
      }
      const targetType = draft.target_type ?? 'single'
      let accountIdsArr: string[] = Array.isArray(draft.account_ids)
        ? draft.account_ids
        : typeof draft.account_ids === 'string'
          ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
          : []
      // 現在ログイン中のアカウントは常に含める。保存後 redirect 先 (この
      // accountId scope) で 404 にならないための保証。チェックボックス側でも
      // 外せないが、stale draft 等の保険として save 時にも強制注入する。
      if (targetType === 'multi-account-dedup' && accountId && !accountIdsArr.includes(accountId)) {
        accountIdsArr = [accountId, ...accountIdsArr]
      }
      if (targetType === 'multi-account-dedup' && accountIdsArr.length === 0) {
        throw new Error('複数アカウント横断の場合は対象アカを 1 件以上選択してください')
      }
      const payload: Partial<EventDetail> = {
        name: draft.name,
        venue_name: draft.venue_name,
        venue_url: draft.venue_url,
        image_url: draft.image_url,
        description: draft.description,
        description_centered: draft.description_centered,
        max_bookings_per_friend: draft.max_bookings_per_friend,
        requires_approval: draft.requires_approval,
        cancel_deadline_hours_before: draft.cancel_deadline_hours_before,
        reminder_day_before_enabled: draft.reminder_day_before_enabled,
        reminder_hours_before: draft.reminder_hours_before,
        is_published: draft.is_published,
        sort_order: draft.sort_order,
        target_type: targetType,
        // Worker は account_ids を配列で受け取って内部で JSON.stringify するので、
        // ここでは配列のまま送る (Partial<EventDetail> の union 型を許容)
        account_ids: targetType === 'multi-account-dedup'
          ? (accountIdsArr as unknown as EventDetail['account_ids'])
          : null,
        // Webinar Launch (migration 041): webinar 用パラメータ。
        // kind は create-only。create 時のみ payload に含めて送る (PUT 側は
        // worker の updatable から除外されているので含めても無視される)。
        replay_window_minutes: draft.kind === 'webinar' ? (draft.replay_window_minutes ?? null) : null,
        attendance_threshold_seconds: draft.kind === 'webinar' ? (draft.attendance_threshold_seconds ?? null) : null,
        archive_url: draft.kind === 'webinar' ? (draft.archive_url ?? null) : null,
      }
      if (!eventId) {
        // 新規作成時のみ kind を送る (default 'standard')
        payload.kind = draft.kind ?? 'standard'
      }
      if (eventId) {
        const updated = await eventsApi.updateEvent(accountId, eventId, payload)
        setDraft(updated)
        flashToast('保存しました')
        if (nextTab) setTab(nextTab)
      } else {
        const created = await eventsApi.createEvent(accountId, payload)
        flashToast('イベントを作成しました。続けて予約枠を追加してください。')
        router.replace(`/events/edit?id=${created.id}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function copyLiffUrl() {
    if (!liffUrl) return
    try {
      await navigator.clipboard.writeText(liffUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('コピーしてください:', liffUrl)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
          読み込み中...
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        breadcrumbs={[
          { label: 'イベント一覧', href: '/events' },
          { label: eventId ? draft.name || 'イベント編集' : '新規イベント' },
        ]}
        title={eventId ? draft.name || 'イベント編集' : '新規イベント作成'}
        description={eventId ? 'タブで各項目を編集できます' : 'まず「概要」を保存するとイベントが作成されます'}
        actions={
          eventId ? (
            <Link
              href={`/events/bookings?id=${eventId}`}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
            >
              予約を確認
            </Link>
          ) : undefined
        }
      />

      {/* toast */}
      {toast && (
        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* LIFF URL box(es) */}
      {eventId && draft.is_published === 1 && (() => {
        const targetType = draft.target_type ?? 'single'
        const accountIdsArr: string[] = Array.isArray(draft.account_ids)
          ? draft.account_ids
          : typeof draft.account_ids === 'string'
            ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
            : []

        if (targetType === 'multi-account-dedup') {
          const templateUrl = `https://liff.line.me/{{liff_id}}/?page=event&id=${eventId}`
          const targetAccounts = accounts.filter((a) => accountIdsArr.includes(a.id))
          return (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 space-y-4">
              <div>
                <div className="text-sm font-medium text-blue-900 mb-2">broadcast 用テンプレ URL</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    readOnly
                    value={templateUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 border border-blue-200 rounded-lg px-3 py-2 min-h-11 text-xs bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => copyValue(templateUrl)}
                    className="shrink-0 px-4 min-h-11 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {copiedValue === templateUrl ? 'コピー済' : 'コピー'}
                  </button>
                </div>
                <p className="text-xs text-blue-700 mt-2">
                  broadcast 編集で「リンクするイベント」から選ぶと自動挿入。
                  {'{{liff_id}}'} は配信時に各友だちのアカに対応した値に置換されます。
                </p>
              </div>
              <div>
                <div className="text-sm font-medium text-blue-900 mb-2">各アカ固定 URL (QR・LP 直貼り用)</div>
                <div className="space-y-1.5">
                  {targetAccounts.length === 0 && (
                    <div className="text-xs text-amber-700">対象アカが選択されていません</div>
                  )}
                  {targetAccounts.map((a) => {
                    const acct = a as unknown as { liffId?: string | null; name: string; country: string | null }
                    if (!acct.liffId) {
                      return (
                        <div key={a.id} className="text-xs text-amber-700">
                          {acct.country ? acct.country + ' ' : ''}{acct.name}: LIFF ID 未設定
                        </div>
                      )
                    }
                    const url = `https://liff.line.me/${acct.liffId}/?page=event&id=${eventId}`
                    return (
                      <div key={a.id} className="rounded-lg bg-white/60 p-2">
                        <div className="text-xs text-gray-600 mb-1 truncate">
                          {acct.country ? acct.country + ' ' : ''}{acct.name}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            value={url}
                            onFocus={(e) => e.currentTarget.select()}
                            className="min-w-0 flex-1 border border-blue-200 rounded-lg px-2 py-1 min-h-11 text-xs bg-white font-mono"
                          />
                          <button
                            onClick={() => copyValue(url)}
                            className="shrink-0 px-3 min-h-11 text-xs bg-blue-600 text-white rounded-lg"
                          >
                            {copiedValue === url ? '✓' : 'コピー'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        }

        // single 用 (既存と同じ表示)
        if (liffUrl) {
          return (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="text-sm font-medium text-blue-900 mb-2">予約 URL（友だちに案内する）</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  readOnly
                  value={liffUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 border border-blue-200 rounded-lg px-3 py-2 min-h-11 text-xs bg-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => copyValue(liffUrl)}
                  className="shrink-0 px-4 min-h-11 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {copiedValue === liffUrl ? 'コピー済' : 'コピー'}
                </button>
              </div>
              <p className="text-xs text-blue-700 mt-2">
                この URL をブロードキャストやシナリオで友だちに送ると LINE 内で予約画面が開きます。
              </p>
            </div>
          )
        }
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
            LIFF ID が未設定のため予約 URL を生成できません。LINE アカウント設定で LIFF ID を登録してください。
          </div>
        )
      })()}
      {eventId && draft.is_published === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
          現在「下書き」状態です。公開設定タブで「公開する」を ON にすると友だち向けの予約 URL が表示されます。
        </div>
      )}

      {/* main card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* tab nav: 375px では 4 タブ x 2 行のラベルが潰れるので、
            補助文はデスクトップだけに出し、狭い画面は横スクロールにする。 */}
        <div className="flex border-b border-gray-200 overflow-x-auto lh-no-scrollbar">
          {(() => {
            // タブセットは draft.kind に応じて動的に変える。
            // PUT で kind は変更不可なので、create 時の選択値がそのまま使われる。
            const tabs = buildTabs(draft.kind === 'webinar' ? 'webinar' : 'standard')
            return tabs.map((t) => {
              const active = tab === t.key
              const disabled = t.key !== 'overview' && !eventId
              return (
                <button
                  key={t.key}
                  disabled={disabled}
                  onClick={() => !disabled && setTab(t.key)}
                  title={disabled ? 'まず「概要」を保存してください' : undefined}
                  className={`shrink-0 sm:flex-1 px-4 min-h-12 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                    active
                      ? 'border-blue-600 text-blue-600 bg-blue-50'
                      : disabled
                      ? 'border-transparent text-gray-300 cursor-not-allowed'
                      : 'border-transparent text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <div>{t.label}</div>
                  <div className="hidden sm:block text-xs font-normal mt-0.5 opacity-80">{t.sub}</div>
                </button>
              )
            })
          })()}
        </div>

        {/* tab body */}
        <div className="p-4 sm:p-6">
          {tab === 'overview' && <OverviewTab draft={draft} update={update} accounts={accounts} currentAccountId={accountId} isCreate={!eventId} />}
          {tab === 'slots' && (
            <SlotsTab
              accountId={accountId}
              eventId={eventId}
              slots={slots}
              setSlots={setSlots}
            />
          )}
          {tab === 'webinar' && eventId && (
            <WebinarSettingsTab accountId={accountId} eventId={eventId} event={draft} setEvent={setDraft} />
          )}
          {tab === 'publish' && <PublishTab draft={draft} update={update} />}
        </div>

        {/* tab footer */}
        {tab !== 'slots' && tab !== 'webinar' && (
          <div className="px-4 sm:px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-gray-500">
              {tab === 'overview' && !eventId && '保存するとイベントが作成され、予約枠タブに進みます'}
              {tab === 'overview' && eventId && '変更を「概要を保存」で確定します'}
              {tab === 'publish' && '「公開する」ON で友だちに予約 URL を案内できます'}
            </div>
            <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
              {tab === 'overview' && eventId && (
                <button
                  onClick={() => save('slots')}
                  disabled={saving}
                  className="px-4 min-h-11 py-2 text-sm font-medium border border-gray-300 bg-white rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  保存して次へ →
                </button>
              )}
              <button
                onClick={() => save()}
                disabled={saving}
                className="px-5 min-h-11 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {(() => {
                  if (saving) return '保存中...'
                  if (tab === 'overview' && !eventId) return 'イベントを作成'
                  const tabs = buildTabs(draft.kind === 'webinar' ? 'webinar' : 'standard')
                  return tabs.find((x) => x.key === tab)?.saveLabel ?? '保存'
                })()}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// Tab 1: Overview
// ----------------------------------------------------------------

function OverviewTab({
  draft,
  update,
  accounts,
  currentAccountId,
  isCreate,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
  accounts: Array<{ id: string; name: string; country: string | null; isActive: boolean }>
  currentAccountId: string
  isCreate: boolean
}) {
  const descLen = (draft.description ?? '').length
  const targetType = draft.target_type ?? 'single'
  const accountIds: string[] = Array.isArray(draft.account_ids)
    ? draft.account_ids
    : typeof draft.account_ids === 'string'
      ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
      : []
  const activeAccounts = accounts.filter((a) => a.isActive)
  const kind = draft.kind === 'webinar' ? 'webinar' : 'standard'
  return (
    <div className="space-y-6">
      {/* Webinar Launch (migration 041): イベント種別。create 時のみ切替可能。
          編集後の kind 変更は worker の updatable から除外されているので
          表示専用にする (PUT で送られても無視される)。 */}
      {isCreate ? (
        <FormSection title="イベント種別" description="作成後は変更できません">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => update('kind', 'standard')}
              className={`p-3 border-2 rounded-lg text-left ${
                kind === 'standard' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-bold">通常イベント</div>
              <div className="text-xs text-gray-600">個別面談・対面セミナーなど予約枠ベース</div>
            </button>
            <button
              type="button"
              onClick={() => update('kind', 'webinar')}
              className={`p-3 border-2 rounded-lg text-left ${
                kind === 'webinar' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-bold">ウェビナー</div>
              <div className="text-xs text-gray-600">録画動画の擬似ライブ配信 + CTA 自動表示</div>
            </button>
          </div>
        </FormSection>
      ) : (
        <div className="text-xs text-gray-500">
          種別: <span className="font-medium text-gray-700">{kind === 'webinar' ? 'ウェビナー' : '通常イベント'}</span>
          <span className="ml-2 text-gray-400">(作成後の変更は不可)</span>
        </div>
      )}

      <FormSection title="基本情報" description="友だちの予約画面に表示される内容">
        <Field label="イベント名" required>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            maxLength={255}
            placeholder="例: 第1回 AAA 説明会"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="開催場所">
            <input
              type="text"
              value={draft.venue_name ?? ''}
              onChange={(e) => update('venue_name', e.target.value || null)}
              placeholder="例: 渋谷ベース 3F"
              className={inputClass}
            />
          </Field>
          <Field label="会場 URL">
            <input
              type="url"
              inputMode="url"
              value={draft.venue_url ?? ''}
              onChange={(e) => update('venue_url', e.target.value || null)}
              placeholder="https://..."
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="イベント画像 URL">
          <input
            type="url"
            inputMode="url"
            value={draft.image_url ?? ''}
            onChange={(e) => update('image_url', e.target.value || null)}
            placeholder="https://... (R2 / 外部 CDN)"
            className={inputClass}
          />
        </Field>
        {draft.image_url && (
          <img src={draft.image_url} alt="" className="max-h-40 rounded-lg border border-gray-200" />
        )}

        <Field
          label="イベント詳細"
          suffix={
            <span className={`text-xs font-normal ${descLen > 20000 ? 'text-red-600' : 'text-gray-500'}`}>
              {descLen.toLocaleString()} / 20,000
            </span>
          }
        >
          <textarea
            value={draft.description ?? ''}
            onChange={(e) => update('description', e.target.value || null)}
            rows={8}
            placeholder="開催趣旨、注意事項、持ち物などを記載..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
        <label className="flex items-center gap-2 min-h-11 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={draft.description_centered === 1}
            onChange={(e) => update('description_centered', e.target.checked ? 1 : 0)}
            className="w-5 h-5 rounded border-gray-300"
          />
          詳細を中央揃えで表示
        </label>
      </FormSection>

      <FormSection title="予約ルール">
        <Field label="1 人あたり予約回数">
          <select
            value={draft.max_bookings_per_friend ?? 'unlimited'}
            onChange={(e) =>
              update(
                'max_bookings_per_friend',
                e.target.value === 'unlimited' ? null : Number(e.target.value),
              )
            }
            className={selectClass}
          >
            <option value="unlimited">制限なし</option>
            <option value="1">1 回まで</option>
            <option value="2">2 回まで</option>
            <option value="3">3 回まで</option>
            <option value="5">5 回まで</option>
          </select>
        </Field>
      </FormSection>

      <FormSection title="公開対象">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => update('target_type', 'single')}
            className={`p-3 border-2 rounded-lg text-left ${
              targetType === 'single' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-bold">単一アカウント</div>
            <div className="text-xs text-gray-600">1 つの LINE アカで運用</div>
          </button>
          <button
            type="button"
            onClick={() => {
              update('target_type', 'multi-account-dedup')
              // single → multi 切替時: 編集中の admin account を account_ids[0]
              // sentinel として自動セット。active 一覧の先頭ではなく実際に
              // 編集している admin の account にしないと、保存後にその admin
              // が自分のイベントを見られなくなる (404)。
              if (accountIds.length === 0) {
                const seed = currentAccountId || activeAccounts[0]?.id || ''
                if (seed) {
                  update('account_ids', [seed] as unknown as EventDetail['account_ids'])
                }
              }
            }}
            className={`p-3 border-2 rounded-lg text-left ${
              targetType === 'multi-account-dedup' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-bold">複数アカウント横断</div>
            <div className="text-xs text-gray-600">重複なし配信に対応</div>
          </button>
        </div>

        {targetType === 'multi-account-dedup' && (
          <div className="space-y-1.5">
            <div className="text-xs text-gray-600">対象アカ（重複なし配信）</div>
            {activeAccounts.length === 0 && (
              <div className="text-sm text-gray-500 italic p-2">アクティブなアカウントがありません</div>
            )}
            {activeAccounts.map((a) => {
              // 現在ログイン中のアカウントは外せない (外すと保存後 redirect が
              // 即 404 になる)。target_type 切替時に sentinel seed されている
              // ことの保護も兼ねる。
              const isCurrent = a.id === currentAccountId
              const checked = accountIds.includes(a.id) || isCurrent
              return (
                <label
                  key={a.id}
                  className={`flex items-center gap-2 p-2 min-h-11 border border-gray-200 rounded-lg ${isCurrent ? 'opacity-90 bg-gray-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                  title={isCurrent ? '現在ログイン中のアカウントは必須です' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isCurrent}
                    onChange={(e) => {
                      if (isCurrent) return
                      const next = e.target.checked
                        ? [...accountIds, a.id]
                        : accountIds.filter((x) => x !== a.id)
                      update('account_ids', next as unknown as EventDetail['account_ids'])
                    }}
                    className="w-5 h-5 rounded border-gray-300"
                  />
                  <span className="text-sm">
                    {a.country ? a.country + ' ' : ''}{a.name}
                    {isCurrent && <span className="ml-1 text-[10px] text-gray-500">(現アカ・必須)</span>}
                  </span>
                </label>
              )
            })}
            <div className="text-xs text-gray-500 mt-1">{accountIds.length} 件選択中</div>
          </div>
        )}
      </FormSection>

      {/* Webinar Launch (migration 041): kind='webinar' のときのみ動画関連
          パラメータを overview タブで設定可能にする (新規作成時に reasonable
          default を入れてもらうため。動画本体のアップロードは「ウェビナー
          設定」タブで行う)。これらは PUT でも更新できるので edit 後も表示。 */}
      {kind === 'webinar' && (
        <FormSection title="ウェビナー基本設定">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="リプレイ視聴可能期間（分）"
              hint="動画終了後に視聴を許可する分数。0/空欄 → リプレイ不可。"
            >
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.replay_window_minutes ?? ''}
                onChange={(e) =>
                  update('replay_window_minutes', e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder="1440 (=24時間)"
                className={inputClass}
              />
            </Field>
            <Field
              label="完視聴判定の閾値秒数"
              hint="この秒数到達で完視聴扱い。空欄なら duration の 80%。"
            >
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.attendance_threshold_seconds ?? ''}
                onChange={(e) =>
                  update('attendance_threshold_seconds', e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder="空欄 → 動画の 80% に自動設定"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="アーカイブ URL（公開期間切れ後のリダイレクト先）">
            <input
              type="url"
              inputMode="url"
              value={draft.archive_url ?? ''}
              onChange={(e) => update('archive_url', e.target.value || null)}
              placeholder="https://... (アーカイブ販売 LP など)"
              className={inputClass}
            />
          </Field>
        </FormSection>
      )}
    </div>
  )
}

// ----------------------------------------------------------------
// Tab 2: Slots
// ----------------------------------------------------------------

// 予約枠を JST の日付ごとにまとめる。1 日に複数枠を作る運用が多く、
// フラットな表だと「どの日が何枠あるか」がスマホで読み取れない。
function groupSlotsByJstDate(slots: EventSlot[]): Array<{ key: string; label: string; items: EventSlot[] }> {
  const buckets = new Map<string, EventSlot[]>()
  for (const s of slots) {
    // formatJstDateTime は「2026/7/30(木) 21:00」形式。時刻を落として日付キーにする。
    const key = formatJstDateTime(s.starts_at, { withYear: true }).split(' ')[0]
    const list = buckets.get(key)
    if (list) list.push(s)
    else buckets.set(key, [s])
  }
  return Array.from(buckets.entries())
    .map(([key, items]) => ({
      key,
      label: key,
      items: items.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    }))
    // API の並び順に依存せず、必ず日付の昇順で並べる。
    // starts_at は UTC ISO なので文字列比較で時系列順になる。
    .sort((a, b) => a.items[0].starts_at.localeCompare(b.items[0].starts_at))
}

function SlotsTab({
  accountId,
  eventId,
  slots,
  setSlots,
}: {
  accountId: string
  eventId: string | null
  slots: EventSlot[]
  setSlots: (s: EventSlot[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EventSlot | null>(null)
  const [bulkPreview, setBulkPreview] = useState<
    { input: BulkSlotInput; generated: Array<{ starts_at: string; ends_at: string; capacity: number | null }> } | null
  >(null)

  if (!eventId) {
    return (
      <EmptyState
        size="sm"
        title="まず「概要」タブで保存してください"
        description="イベントを作成すると、ここで予約枠を追加できます。"
      />
    )
  }

  async function refresh() {
    if (!eventId) return
    const res = await eventsApi.listSlots(accountId, eventId)
    setSlots(res.items)
  }

  async function runDelete() {
    if (!eventId || !deleteTarget) return
    setBusy(true)
    setErr(null)
    try {
      await eventsApi.deleteSlot(accountId, eventId, deleteTarget.id)
      setDeleteTarget(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setDeleteTarget(null)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(s: EventSlot) {
    if (!eventId) return
    setBusy(true)
    try {
      await eventsApi.updateSlot(accountId, eventId, s.id, { is_active: s.is_active === 1 ? 0 : 1 })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function runBulkCreate() {
    if (!eventId || !bulkPreview) return
    setBusy(true)
    setErr(null)
    try {
      await eventsApi.createSlots(accountId, eventId, bulkPreview.generated)
      setBulkPreview(null)
      setShowBulk(false)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const groups = groupSlotsByJstDate(slots)

  return (
    <div>
      <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-600">{slots.length} 件の予約枠</div>
        <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 min-h-11 py-2 text-sm border border-gray-300 bg-white rounded-lg hover:bg-gray-50"
          >
            ＋ 枠を追加
          </button>
          <button
            onClick={() => setShowBulk(true)}
            className="px-3 min-h-11 py-2 text-sm border border-gray-300 bg-white rounded-lg hover:bg-gray-50"
          >
            📅 一括追加
          </button>
        </div>
      </div>
      {err && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3 text-sm">{err}</div>}
      {slots.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-lg">
          <EmptyState
            size="sm"
            title="予約枠がありません"
            description="「＋ 枠を追加」または「📅 一括追加」から作成してください。"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key}>
              <h3 className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm py-1.5 text-sm font-bold text-gray-900 border-b border-gray-200">
                {g.label}
                <span className="ml-2 text-xs font-normal text-gray-500">{g.items.length} 枠</span>
              </h3>
              <ul className="divide-y divide-gray-100">
                {g.items.map((s) => {
                  const booked = s.active_count ?? 0
                  const full = s.capacity != null && booked >= s.capacity
                  return (
                    <li key={s.id} className="py-2.5 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 tabular-nums">
                          {formatJstTime(s.starts_at)} 〜 {formatJstTime(s.ends_at)}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          予約 {booked}
                          {s.capacity != null ? ` / ${s.capacity}` : ' (定員なし)'}
                          {full && <span className="ml-1.5 text-amber-700 font-medium">満席</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleActive(s)}
                        disabled={busy}
                        className={`shrink-0 min-h-11 px-3 text-xs rounded-full font-medium disabled:opacity-50 ${
                          s.is_active === 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {s.is_active === 1 ? '有効' : '停止'}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(s)}
                        disabled={busy || booked > 0}
                        title={booked > 0 ? '既存予約があるため削除できません' : '削除'}
                        aria-label="この枠を削除"
                        className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-25 disabled:hover:bg-transparent"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <AddSlotDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={async (s) => {
          await eventsApi.createSlots(accountId, eventId, [s])
          await refresh()
          setShowAdd(false)
        }}
      />
      <BulkSlotDialog
        open={showBulk}
        onClose={() => setShowBulk(false)}
        onSubmit={async (input) => {
          const generated = generateBulkSlots(input)
          if (generated.length === 0) {
            throw new Error('生成される枠が0件でした。条件を確認してください。')
          }
          // 何十枠も一度に作るので、件数を見せてから確定させる。
          setBulkPreview({ input, generated })
        }}
      />

      <ConfirmSheet
        open={bulkPreview !== null}
        title={`${bulkPreview?.generated.length ?? 0} 件の枠を作成しますか？`}
        message="条件に一致する日時すべてに枠を作ります。"
        confirmLabel="作成する"
        busy={busy}
        onConfirm={() => void runBulkCreate()}
        onClose={() => setBulkPreview(null)}
      />

      <ConfirmSheet
        open={deleteTarget !== null}
        title="この予約枠を削除しますか？"
        message={
          deleteTarget
            ? `${formatJstDateTime(deleteTarget.starts_at, { withYear: true })} 〜 ${formatJstTime(deleteTarget.ends_at)} の枠を削除します。`
            : undefined
        }
        confirmLabel="削除する"
        tone="danger"
        busy={busy}
        onConfirm={() => void runDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function AddSlotDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (s: { starts_at: string; ends_at: string; capacity: number | null }) => Promise<void>
}) {
  const todayJst = new Date(jstNow().getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const [date, setDate] = useState(todayJst)
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('12:00')
  const [capacity, setCapacity] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const s = jstHHMMToUtcIso(date, startTime)
      const e = jstHHMMToUtcIso(date, endTime)
      if (s >= e) throw new Error('開始時刻 < 終了時刻')
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) throw new Error('定員は1以上の整数')
      await onSubmit({ starts_at: s, ends_at: e, capacity: cap })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="予約枠を追加"
      description="日時はすべて JST で入力します"
      busy={busy}
      footer={
        <>
          <SheetButton onClick={onClose} disabled={busy}>キャンセル</SheetButton>
          <SheetButton variant="primary" onClick={submit} busy={busy} busyLabel="追加中...">追加</SheetButton>
        </>
      }
    >
      {err && <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg mb-3 text-sm">{err}</div>}
      <div className="space-y-4">
        <Field label="日付（JST）">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        {/* 開始と終了は横並びのままで良いが、狭い画面でも 44px を割らないよう
            time 入力に min-h-11 を効かせる。 */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="終了">
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="定員" hint="空欄で無制限">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
    </Sheet>
  )
}

function BulkSlotDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: BulkSlotInput) => Promise<void>
}) {
  const todayJst = new Date(jstNow().getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const [start, setStart] = useState(todayJst)
  const [end, setEnd] = useState(todayJst)
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [patterns, setPatterns] = useState([{ start: '10:00', end: '11:00' }])
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function toggleWeekday(d: number) {
    setWeekdays((ws) => (ws.includes(d) ? ws.filter((x) => x !== d) : [...ws, d]))
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) throw new Error('定員は1以上の整数')
      await onSubmit({
        start_date: start,
        end_date: end,
        weekdays,
        time_patterns: patterns.filter((p) => p.start && p.end && p.start < p.end),
        capacity: cap,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="予約枠の一括追加"
      description="期間・曜日・時刻の組み合わせで枠をまとめて作ります"
      size="lg"
      busy={busy}
      footer={
        <>
          <SheetButton onClick={onClose} disabled={busy}>キャンセル</SheetButton>
          <SheetButton variant="primary" onClick={submit} busy={busy} busyLabel="生成中...">生成</SheetButton>
        </>
      }
    >
      {err && <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg mb-3 text-sm">{err}</div>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始日">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </Field>
          <Field label="終了日">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div>
          <span className="text-sm font-medium text-gray-700 block mb-1.5">曜日</span>
          <div className="flex gap-1.5">
            {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(i)}
                className={`flex-1 min-h-11 px-1 text-sm border rounded-lg ${
                  weekdays.includes(i)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-sm font-medium text-gray-700 block mb-1.5">時刻パターン</span>
          {patterns.map((p, i) => (
            <div key={i} className="flex gap-2 mb-2 items-center">
              <input
                type="time"
                value={p.start}
                onChange={(e) => setPatterns((ps) => ps.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                className={`flex-1 ${inputClass}`}
              />
              <span className="text-gray-500 shrink-0">〜</span>
              <input
                type="time"
                value={p.end}
                onChange={(e) => setPatterns((ps) => ps.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                className={`flex-1 ${inputClass}`}
              />
              {patterns.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPatterns((ps) => ps.filter((_, j) => j !== i))}
                  aria-label="このパターンを削除"
                  className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPatterns((ps) => [...ps, { start: '14:00', end: '15:00' }])}
            className="min-h-11 text-sm text-blue-600 hover:underline"
          >
            ＋ パターン追加
          </button>
        </div>
        <Field label="定員" hint="各枠共通・空欄で無制限">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
    </Sheet>
  )
}

function jstHHMMToUtcIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const totalMin = h * 60 + m - 9 * 60
  const [y, mo, d] = date.split('-').map(Number)
  const t = Date.UTC(y, mo - 1, d) + totalMin * 60_000
  return new Date(t).toISOString()
}

// ----------------------------------------------------------------
// Tab 3: Publish settings
// ----------------------------------------------------------------

function PublishTab({
  draft,
  update,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
}) {
  return (
    <div className="space-y-6">
      <FormSection title="予約の受け方">
        <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={draft.requires_approval === 1}
            onChange={(e) => update('requires_approval', e.target.checked ? 1 : 0)}
            className="mt-0.5 w-5 h-5 rounded border-gray-300"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">承認制</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              ON: 友だちが予約しても運営が「承認」するまで未確定<br />
              OFF: 定員空きがあれば即時確定
            </span>
          </span>
        </label>

        <Field label="キャンセル期限（友だち側）">
          <select
            value={draft.cancel_deadline_hours_before ?? 'disabled'}
            onChange={(e) =>
              update(
                'cancel_deadline_hours_before',
                e.target.value === 'disabled' ? null : Number(e.target.value),
              )
            }
            className={selectClass}
          >
            <option value="disabled">不可（運営に LINE 連絡）</option>
            <option value="0">直前まで可</option>
            <option value="6">6 時間前まで</option>
            <option value="12">12 時間前まで</option>
            <option value="24">24 時間前まで</option>
            <option value="48">48 時間前まで</option>
          </select>
        </Field>
      </FormSection>

      <FormSection title="リマインダ" description="予約した友だちへの自動通知">
        <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={draft.reminder_day_before_enabled === 1}
            onChange={(e) => update('reminder_day_before_enabled', e.target.checked ? 1 : 0)}
            className="mt-0.5 w-5 h-5 rounded border-gray-300"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">前日リマインダ</span>
            <span className="block text-xs text-gray-500 mt-0.5">前日 18:00 JST に LINE で通知</span>
          </span>
        </label>

        <Field label="開始 N 時間前リマインダ">
          <select
            value={draft.reminder_hours_before ?? 'off'}
            onChange={(e) =>
              update('reminder_hours_before', e.target.value === 'off' ? null : Number(e.target.value))
            }
            className={selectClass}
          >
            <option value="off">送信しない</option>
            <option value="1">1 時間前</option>
            <option value="2">2 時間前</option>
            <option value="3">3 時間前</option>
            <option value="6">6 時間前</option>
            <option value="24">24 時間前</option>
          </select>
        </Field>
      </FormSection>

      <FormSection title="公開状態">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => update('is_published', 0)}
            className={`p-3 border-2 rounded-lg text-left transition-colors ${
              draft.is_published === 0
                ? 'border-gray-700 bg-gray-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-bold text-gray-900">下書き</div>
            <div className="text-xs text-gray-600 mt-0.5">友だちには見えない</div>
          </button>
          <button
            type="button"
            onClick={() => update('is_published', 1)}
            className={`p-3 border-2 rounded-lg text-left transition-colors ${
              draft.is_published === 1
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 bg-white hover:border-green-300'
            }`}
          >
            <div className="text-sm font-bold text-gray-900">公開する</div>
            <div className="text-xs text-gray-600 mt-0.5">予約 URL が有効になる</div>
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {draft.is_published === 1
            ? '✓ 保存後、友だちに「予約 URL」を案内できます。'
            : '保存しても友だちには表示されません。'}
        </p>
      </FormSection>
    </div>
  )
}
