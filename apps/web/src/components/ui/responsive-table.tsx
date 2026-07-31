'use client'

import React from 'react'

/**
 * ResponsiveTable — デスクトップは通常の表、モバイル (sm 未満) は
 * 1 行 = 1 カードの縦積みで表示する共通ラッパ。
 *
 * 管理画面の一覧は横スクロールの表が多く、iPhone (375px) では
 * 「指で横に振らないと状態も操作ボタンも見えない」状態だった。
 * 列定義を 1 つ渡すだけで両方のレイアウトを賄えるようにする。
 *
 * ## 使い方
 * ```tsx
 * <ResponsiveTable
 *   rows={items}
 *   rowKey={(b) => b.id}
 *   columns={[
 *     // primary: モバイルではカード見出し (ラベルなし・大きめ文字)
 *     { key: 'name', label: '友だち', priority: 'primary', render: (b) => b.name },
 *     // secondary: モバイルでは「ラベル ─ 値」の行
 *     { key: 'slot', label: '予約枠', render: (b) => fmt(b.slot_starts_at) },
 *     // meta: モバイルではカード右上に小さく添える (ステータスバッジ向き)
 *     { key: 'status', label: '状態', priority: 'meta', render: (b) => <Badge /> },
 *     // hidden: デスクトップのみ表示 (モバイルでは出さない)
 *     { key: 'id', label: 'ID', priority: 'hidden', render: (b) => b.id },
 *   ]}
 *   actions={(b) => <button>承認</button>}
 *   empty={<EmptyState title="該当する予約はありません" />}
 * />
 * ```
 *
 * ## 実装メモ
 * 表とカードは同じ DOM を CSS で切り替えるのではなく、両方を描画して
 * `hidden` / `sm:hidden` で出し分けている。`display:none` は
 * タブ順からも外れるため操作が二重に拾われることはない。
 * Next.js の static export ではビルド時に HTML が固定されるので、
 * 画面幅を JS で見る方式にすると hydration 不一致とちらつきが出る。
 */

export type ColumnPriority =
  /** モバイルではカード見出し。複数指定すると縦に並ぶ。 */
  | 'primary'
  /** モバイルでは「ラベル ─ 値」行。既定値。 */
  | 'secondary'
  /** モバイルではカード右上の補助情報 (ステータスバッジ等)。 */
  | 'meta'
  /** モバイルでは非表示 (デスクトップの表にだけ出す)。 */
  | 'hidden'

export interface ResponsiveTableColumn<T> {
  /** React の key と列の識別子。 */
  key: string
  /** 表のヘッダ文言。モバイルでは secondary 行のラベルになる。 */
  label: string
  /** セルの中身。 */
  render: (row: T, index: number) => React.ReactNode
  /** モバイルでの扱い。既定は 'secondary'。 */
  priority?: ColumnPriority
  /** デスクトップの表での寄せ。既定は 'left'。 */
  align?: 'left' | 'right' | 'center'
  /** デスクトップのセルに足すクラス (幅指定など)。 */
  className?: string
}

export interface ResponsiveTableProps<T> {
  rows: T[]
  columns: Array<ResponsiveTableColumn<T>>
  /** 行の React key。 */
  rowKey: (row: T, index: number) => string
  /** 行ごとの操作ボタン群。モバイルではカード下部に全幅で並ぶ。 */
  actions?: (row: T, index: number) => React.ReactNode
  /** 行そのものをタップ可能にする。actions 内のタップは伝播しない。 */
  onRowClick?: (row: T, index: number) => void
  /** rows が空のときに表示する内容 (EmptyState など)。 */
  empty?: React.ReactNode
  /** 読み込み中に表示する内容。指定時は rows より優先。 */
  loading?: boolean
  loadingLabel?: string
  /** 外枠 (border + 角丸 + 白背景) を描画するか。既定 true。 */
  bordered?: boolean
  className?: string
}

const alignClass = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const

export default function ResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  actions,
  onRowClick,
  empty,
  loading = false,
  loadingLabel = '読み込み中...',
  bordered = true,
  className = '',
}: ResponsiveTableProps<T>) {
  const shell = bordered
    ? 'bg-white border border-gray-200 rounded-lg overflow-hidden'
    : ''

  if (loading) {
    return (
      <div className={`${shell} ${className}`}>
        <div className="py-12 text-center text-sm text-gray-500">{loadingLabel}</div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className={`${shell} ${className}`}>
        {empty ?? <div className="py-12 text-center text-sm text-gray-500">データがありません</div>}
      </div>
    )
  }

  const primary = columns.filter((c) => c.priority === 'primary')
  const meta = columns.filter((c) => c.priority === 'meta')
  const secondary = columns.filter(
    (c) => c.priority !== 'primary' && c.priority !== 'meta' && c.priority !== 'hidden',
  )
  // primary 未指定なら先頭列を見出しに昇格させる (カードが無題にならないように)。
  const headCols = primary.length > 0 ? primary : columns.slice(0, 1)
  const bodyCols =
    primary.length > 0 ? secondary : secondary.filter((c) => c.key !== columns[0]?.key)

  return (
    <div className={`${shell} ${className}`}>
      {/* ── デスクトップ: 通常の表 ── */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-2 font-medium whitespace-nowrap ${alignClass[c.align ?? 'left']}`}
                >
                  {c.label}
                </th>
              ))}
              {actions && <th className="px-4 py-2 font-medium text-right">操作</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={`border-t border-gray-100 ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : 'hover:bg-gray-50'}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 align-middle ${alignClass[c.align ?? 'left']} ${c.className ?? ''}`}
                  >
                    {c.render(row, i)}
                  </td>
                ))}
                {actions && (
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex flex-wrap gap-1.5 justify-end">{actions(row, i)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── モバイル: 1 行 = 1 カード ── */}
      <ul className="sm:hidden divide-y divide-gray-100">
        {rows.map((row, i) => (
          <li
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row, i) : undefined}
            className={`px-4 py-3.5 ${onRowClick ? 'active:bg-gray-50' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                {headCols.map((c) => (
                  <div key={c.key} className="text-[15px] font-semibold text-gray-900 break-words">
                    {c.render(row, i)}
                  </div>
                ))}
              </div>
              {meta.length > 0 && (
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {meta.map((c) => (
                    <div key={c.key}>{c.render(row, i)}</div>
                  ))}
                </div>
              )}
            </div>

            {bodyCols.length > 0 && (
              <dl className="mt-2 space-y-1">
                {bodyCols.map((c) => (
                  <div key={c.key} className="flex items-baseline gap-3 text-[13px]">
                    <dt className="shrink-0 text-gray-500 min-w-[5.5rem]">{c.label}</dt>
                    <dd className="min-w-0 flex-1 text-gray-800 break-words">{c.render(row, i)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {actions && (
              <div
                className="mt-3 flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:min-h-11"
                onClick={(e) => e.stopPropagation()}
              >
                {actions(row, i)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
