'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import { ResponsiveTable, EmptyState, TechnicalDetails, ConfirmSheet } from '@/components/ui'

type RichMenuGroupListItem = {
  id: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  status: 'draft' | 'published'
  isDefaultForAll: boolean
  thumbnailR2Key: string | null
  updatedAt: string
}

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  const cls =
    status === 'published'
      ? 'bg-green-100 text-green-800'
      : 'bg-gray-100 text-gray-700'
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>
      {status === 'published' ? 'LINE 登録済み' : '下書き'}
    </span>
  )
}

type LineMenu = {
  richMenuId: string
  name: string
  chatBarText: string
  size: { width: number; height: number }
  areasCount: number
  isCurrentDefault: boolean
  adminManaged: boolean
  adminInfo: {
    groupId: string
    groupName: string
    pageName: string
    groupStatus: 'draft' | 'published'
  } | null
}

type OperationTarget =
  | { kind: 'delete-group'; group: RichMenuGroupListItem }
  | { kind: 'delete-external'; menu: LineMenu }
  | { kind: 'import'; menu: LineMenu }

export default function RichMenusListPage() {
  const { selectedAccount } = useAccount()
  const [groups, setGroups] = useState<RichMenuGroupListItem[]>([])
  const [external, setExternal] = useState<{
    currentDefault: string | null
    lineMenus: LineMenu[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyTo, setApplyTo] = useState<RichMenuGroupListItem | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [operationTarget, setOperationTarget] = useState<OperationTarget | null>(null)
  const [operationBusy, setOperationBusy] = useState(false)
  const [operationError, setOperationError] = useState('')

  const reload = useCallback(async () => {
    if (!selectedAccount?.id) return
    setLoading(true)
    setError(null)
    setExternalError(null)
    try {
      // 並列に: D1 管理 group の一覧と、LINE 上の現状
      const [groupsRes, externalRes] = await Promise.allSettled([
        api.richMenuGroups.list(selectedAccount.id),
        api.richMenuGroups.external(selectedAccount.id),
      ])
      if (groupsRes.status === 'fulfilled') {
        if (!groupsRes.value.success) throw new Error(groupsRes.value.error ?? '取得失敗')
        setGroups(groupsRes.value.data)
      } else {
        throw groupsRes.reason
      }
      if (externalRes.status === 'fulfilled') {
        const v = externalRes.value
        if (v.success) {
          setExternal(v.data)
        } else {
          setExternalError(v.error ?? 'LINE 上の状態取得に失敗')
          setExternal(null)
        }
      } else {
        setExternalError(
          externalRes.reason instanceof Error
            ? externalRes.reason.message
            : String(externalRes.reason),
        )
        setExternal(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccount?.id])

  useEffect(() => {
    reload()
  }, [reload])

  function handleDelete(group: RichMenuGroupListItem) {
    if (group.status === 'published') {
      setError(`「${group.name}」はLINEに登録されています。編集画面で「LINEから取り下げ」を実行してから削除してください。`)
      return
    }
    setOperationTarget({ kind: 'delete-group', group })
    setOperationError('')
  }

  function handleDeleteExternal(menu: LineMenu) {
    if (!selectedAccount?.id) return
    setOperationTarget({ kind: 'delete-external', menu })
    setOperationError('')
  }

  function handleImport(menu: LineMenu) {
    if (!selectedAccount?.id) return
    setOperationTarget({ kind: 'import', menu })
    setOperationError('')
  }

  async function executeOperation() {
    if (!operationTarget || !selectedAccount?.id) return
    setOperationBusy(true)
    setOperationError('')
    setNotice(null)
    try {
      if (operationTarget.kind === 'delete-group') {
        const res = await api.richMenuGroups.delete(operationTarget.group.id)
        if (!res.success) throw new Error(res.error ?? '削除に失敗しました')
        setNotice('リッチメニューを削除しました。')
      } else if (operationTarget.kind === 'delete-external') {
        const res = await api.richMenuGroups.deleteExternal(operationTarget.menu.richMenuId, selectedAccount.id)
        if (!res.success) throw new Error(res.error ?? '削除に失敗しました')
        setNotice('LINE公式アカウントからリッチメニューを削除しました。')
      } else {
        const res = await api.richMenuGroups.importFromLine(operationTarget.menu.richMenuId, selectedAccount.id)
        if (!res.success) throw new Error(res.error ?? '取り込みに失敗しました')
        setNotice(`「${res.data?.name ?? operationTarget.menu.name}」を管理画面に取り込みました。`)
      }
      setOperationTarget(null)
      await reload()
    } catch (operationRequestError) {
      setOperationError(operationRequestError instanceof Error ? operationRequestError.message : '操作に失敗しました')
    } finally {
      setOperationBusy(false)
    }
  }

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <Header
        title="リッチメニュー"
        description="LINE トーク画面下に表示されるメニュー。タブ切替対応。"
        action={
          <Link
            href="/rich-menus/new"
            className="inline-flex items-center gap-1 px-4 py-2 text-white rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            <span className="text-lg leading-none">+</span> 新規作成
          </Link>
        }
      />

      {!selectedAccount && (
        <div className="text-sm text-gray-500">
          アカウントを選択してください。
        </div>
      )}

      {selectedAccount && loading && (
        <div className="text-sm text-gray-500">読み込み中...</div>
      )}

      {selectedAccount && !loading && error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded mb-4">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 border-l-4 border-green-500 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      {/* LINE 公式アカウントの現状 (admin 管理外の rich menu も含む) */}
      {selectedAccount && !loading && external && (
        <ExternalSection
          accountId={selectedAccount.id}
          accountName={selectedAccount.displayName || selectedAccount.name}
          external={external}
          onDeleteExternal={handleDeleteExternal}
          onImport={handleImport}
        />
      )}
      {selectedAccount && !loading && externalError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded mb-6">
          LINE 公式アカウントの状態取得に失敗しました: {externalError}
        </div>
      )}

      {/* Admin 管理メニュー見出し */}
      {selectedAccount && !loading && !error && (
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          管理画面で作成・編集するメニュー
        </h2>
      )}

      {selectedAccount && !loading && !error && groups.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <EmptyState
            title="まだリッチメニューが作成されていません"
            action={
              <Link
                href="/rich-menus/new"
                className="inline-flex items-center gap-1 px-4 py-2 text-white rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}
              >
                <span className="text-lg leading-none">+</span> 最初のメニューを作る
              </Link>
            }
          />
        </div>
      )}

      {selectedAccount && !loading && !error && groups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <div
              key={g.id}
              className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <Link
                href={`/rich-menus/edit?id=${g.id}`}
                className="flex-1 hover:bg-gray-50 rounded-t-lg overflow-hidden"
              >
                {/* thumbnail */}
                <div
                  className="w-full bg-gray-100 border-b border-gray-100"
                  style={{
                    aspectRatio: g.size === 'large' ? '2500 / 1686' : '2500 / 843',
                  }}
                >
                  {g.thumbnailR2Key ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={api.richMenuGroups.imageUrl(g.thumbnailR2Key)}
                      alt={g.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                      画像未設定
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h2 className="font-semibold text-gray-900 truncate">{g.name}</h2>
                    <StatusBadge status={g.status} />
                  </div>
                  <p className="text-sm text-gray-500 truncate">
                    トーク表示: <span className="text-gray-700">{g.chatBarText}</span>
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                    <span>サイズ: {g.size === 'large' ? '2500×1686' : '2500×843'}</span>
                    {g.isDefaultForAll && (
                      <span className="text-blue-600 font-medium">★ 全員のデフォルト</span>
                    )}
                  </div>
                </div>
              </Link>
              <div className="border-t border-gray-100 px-2 py-1 flex justify-end items-center gap-1 text-xs">
                {g.status === 'published' && (
                  <button
                    onClick={() => setApplyTo(g)}
                    className="inline-flex min-h-[44px] items-center rounded-md px-3 font-medium hover:bg-gray-50 hover:underline"
                    style={{ color: '#06C755' }}
                  >
                    友だちに表示
                  </button>
                )}
                <Link
                  href={`/rich-menus/edit?id=${g.id}`}
                  className="inline-flex min-h-[44px] items-center rounded-md px-3 text-gray-600 hover:bg-gray-50 hover:underline"
                >
                  編集
                </Link>
                <button
                  onClick={() => handleDelete(g)}
                  className="inline-flex min-h-[44px] items-center rounded-md px-3 text-gray-400 hover:bg-gray-50 hover:text-red-600 hover:underline"
                  title={g.status === 'published' ? 'LINE から取り下げてから削除' : '削除'}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {applyTo && (
        <ApplyToTagModal
          groupId={applyTo.id}
          groupName={applyTo.name}
          onClose={() => setApplyTo(null)}
        />
      )}
      <ConfirmSheet
        open={Boolean(operationTarget)}
        title={operationTarget?.kind === 'import'
          ? '管理画面に取り込みますか？'
          : 'リッチメニューを削除しますか？'}
        message={operationTarget?.kind === 'delete-group'
          ? `「${operationTarget.group.name}」を削除します。この操作は元に戻せません。`
          : operationTarget?.kind === 'delete-external'
            ? `LINE公式アカウント上の「${operationTarget.menu.name}」を削除します。管理画面外で作成されたメニューもLINEから消えます。`
            : operationTarget?.kind === 'import'
              ? `「${operationTarget.menu.name}」を取り込み、管理画面から編集・表示設定できるようにします。`
              : ''}
        confirmLabel={operationTarget?.kind === 'import' ? '取り込む' : '削除する'}
        tone={operationTarget?.kind === 'import' ? 'default' : 'danger'}
        busy={operationBusy}
        error={operationError}
        onConfirm={executeOperation}
        onClose={() => {
          if (operationBusy) return
          setOperationTarget(null)
          setOperationError('')
        }}
      />
    </main>
  )
}

function ExternalSection({
  accountId,
  accountName,
  external,
  onDeleteExternal,
  onImport,
}: {
  accountId: string
  accountName: string
  external: { currentDefault: string | null; lineMenus: LineMenu[] }
  onDeleteExternal: (menu: LineMenu) => void
  onImport: (menu: LineMenu) => void
}) {
  const { currentDefault, lineMenus } = external
  const sortedMenus = [...lineMenus].sort((a, b) => {
    // 現在のデフォルトを先頭、次に admin 管理外、最後に admin 管理
    if (a.isCurrentDefault) return -1
    if (b.isCurrentDefault) return 1
    if (a.adminManaged !== b.adminManaged) return a.adminManaged ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  const currentDefaultMenu = lineMenus.find((m) => m.isCurrentDefault) ?? null
  const unmanagedCount = lineMenus.filter((m) => !m.adminManaged).length

  return (
    <section className="mb-8 bg-white border border-gray-200 rounded-lg shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">
          LINE 公式アカウントの現状
        </h2>
        <span className="text-xs text-gray-500 truncate">{accountName}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-700 font-medium mb-0.5">
            現在の「全員のデフォルト」
          </div>
          {currentDefaultMenu ? (
            <div>
              <div className="font-medium text-gray-900 truncate">
                {currentDefaultMenu.name}
              </div>
              {currentDefaultMenu.adminInfo ? (
                <div className="text-xs text-gray-600 truncate">
                  管理画面: {currentDefaultMenu.adminInfo.groupName}
                </div>
              ) : (
                <div className="text-xs text-amber-700">管理画面外で設定</div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 text-xs">設定なし</div>
          )}
          <TechnicalDetails
            className="mt-1"
            items={[{ label: 'LINEリッチメニューID', value: currentDefault, copyable: true }]}
          />
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-700 font-medium mb-0.5">
            LINE 上に登録されているメニュー
          </div>
          <div className="font-medium text-gray-900">{lineMenus.length} 個</div>
          {unmanagedCount > 0 && (
            <div className="text-xs text-amber-700">
              うち {unmanagedCount} 個が管理画面外
            </div>
          )}
        </div>
      </div>

      {lineMenus.length === 0 ? (
        <div className="text-xs text-gray-500 py-3">
          LINE 公式アカウントにはまだ rich menu が登録されていません。
        </div>
      ) : (
        <ResponsiveTable
          rows={sortedMenus}
          rowKey={(m) => m.richMenuId}
          columns={[
            {
              key: 'image',
              label: '画像',
              priority: 'meta',
              className: 'w-[88px]',
              render: (m) => (
                <div
                  className="w-20 bg-gray-100 rounded overflow-hidden"
                  style={{
                    aspectRatio:
                      m.size.width === 2500 && m.size.height === 1686
                        ? '2500 / 1686'
                        : m.size.width === 2500 && m.size.height === 843
                          ? '2500 / 843'
                          : `${m.size.width} / ${m.size.height}`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={api.richMenuGroups.externalImageUrl(m.richMenuId, accountId)}
                    alt={m.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ),
            },
            {
              key: 'name',
              label: '名前',
              priority: 'primary',
              render: (m) => (
                <div className="text-gray-700">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {m.isCurrentDefault && (
                      <span
                        className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded"
                        title="LINE 公式アカウントの全員のデフォルト"
                      >
                        全員に表示中
                      </span>
                    )}
                    <span className="font-medium break-words">{m.name}</span>
                  </div>
                  <div className="text-[11px] font-normal text-gray-500 break-words">
                    {m.chatBarText}
                  </div>
                  <TechnicalDetails
                    items={[{ label: 'LINEリッチメニューID', value: m.richMenuId, copyable: true }]}
                  />
                </div>
              ),
            },
            {
              key: 'size',
              label: 'サイズ',
              render: (m) => (
                <span className="text-xs text-gray-600 whitespace-nowrap">
                  {m.size.width}×{m.size.height}
                  <span className="text-[10px] text-gray-400 ml-1">・{m.areasCount}ボタン</span>
                </span>
              ),
            },
            {
              key: 'managed',
              label: '管理状態',
              render: (m) =>
                m.adminManaged && m.adminInfo ? (
                  <Link
                    href={`/rich-menus/edit?id=${m.adminInfo.groupId}`}
                    className="text-xs text-gray-700 hover:underline break-words"
                  >
                    管理画面 → {m.adminInfo.groupName}
                    <span className="text-gray-400 ml-1">({m.adminInfo.pageName})</span>
                  </Link>
                ) : (
                  <span
                    className="text-xs text-amber-700 font-medium"
                    title="LINE公式アカウント側で作成されたメニューです"
                  >
                    LINE側で作成
                  </span>
                ),
            },
          ]}
          actions={(m) =>
            m.adminManaged ? null : (
              <>
                <button
                  onClick={() => onImport(m)}
                  className="inline-flex min-h-[44px] sm:min-h-0 items-center justify-center rounded-md px-3 text-xs font-medium hover:underline"
                  style={{ color: '#06C755' }}
                  title="管理画面に取り込んで以後 UI で操作可能にする"
                >
                  管理画面に取り込む
                </button>
                <button
                  onClick={() => onDeleteExternal(m)}
                  className="inline-flex min-h-[44px] sm:min-h-0 items-center justify-center rounded-md px-3 text-xs text-gray-400 hover:text-red-600 hover:underline"
                  title="LINE から削除 (管理画面外メニューのみ)"
                >
                  LINE から削除
                </button>
              </>
            )
          }
        />
      )}
    </section>
  )
}
