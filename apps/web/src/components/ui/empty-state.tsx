'use client'

import React from 'react'

/**
 * EmptyState — 「まだ何もない」「該当なし」の共通表示。
 *
 * ## 使い方
 * ```tsx
 * <EmptyState
 *   iconPath="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
 *   title="イベントが作成されていません"
 *   description="友だちに告知する勉強会・説明会などをここから作成します。"
 *   action={<Link href="/events/new" className="…">最初のイベントを作成</Link>}
 * />
 * ```
 * 一覧内の「該当0件」は `size="sm"` で余白を詰める。
 * `icon` に任意の ReactNode を渡すと `iconPath` より優先される。
 */

export interface EmptyStateProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** heroicons 系の outline パス (d 属性)。丸背景付きで描画する。 */
  iconPath?: string
  /** 任意のアイコン要素。iconPath より優先。 */
  icon?: React.ReactNode
  /** CTA ボタン / リンク。 */
  action?: React.ReactNode
  /** 'sm' は一覧内の「0件」表示向け。既定 'md'。 */
  size?: 'sm' | 'md'
  className?: string
}

export default function EmptyState({
  title,
  description,
  iconPath,
  icon,
  action,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  const rendered = icon ?? (iconPath ? (
    <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 text-gray-400">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={iconPath} />
      </svg>
    </span>
  ) : null)

  return (
    <div
      className={`text-center px-5 ${size === 'sm' ? 'py-10' : 'py-14'} ${className}`}
    >
      {rendered && <div className="mb-3 flex justify-center">{rendered}</div>}
      <p className={`font-medium text-gray-700 ${size === 'sm' ? 'text-sm' : 'text-base'}`}>{title}</p>
      {description && (
        <p className="mt-1.5 text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">{description}</p>
      )}
      {action && (
        <div className="mt-4 flex justify-center [&>*]:min-h-11 [&>*]:inline-flex [&>*]:items-center [&>*]:justify-center">
          {action}
        </div>
      )}
    </div>
  )
}
