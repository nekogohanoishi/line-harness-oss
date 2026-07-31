'use client'

import React from 'react'
import Link from 'next/link'

/**
 * PageHeader — ページ見出し + 主要アクションの共通ヘッダ。
 *
 * 既存の `flex justify-between items-center` 版は、モバイルで
 * 「タイトルが長い → ボタンが潰れる / 画面外にはみ出す」ことがあった。
 * ここでは 375px でも必ずボタンが読めるよう、狭い画面では
 * タイトル → アクションの縦積み (ボタンは全幅) にする。
 *
 * ## 使い方
 * ```tsx
 * <PageHeader
 *   breadcrumbs={[{ label: 'イベント一覧', href: '/events' }, { label: '予約管理' }]}
 *   title={event?.name ?? 'イベント予約管理'}
 *   description="予約の承認・キャンセル・出欠管理"
 *   badge={<span className="…">公開中</span>}
 *   actions={<Link href="/events/new" className="…">＋ 新しいイベント</Link>}
 * />
 * ```
 * `actions` に渡す要素はモバイルで全幅になるため、`inline-block` より
 * `block text-center` 系のクラスを付けておくと収まりが良い。
 */

export interface Breadcrumb {
  label: string
  /** 省略すると現在地 (リンクなし) として描画。 */
  href?: string
}

export interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** タイトル横に添えるバッジなど。 */
  badge?: React.ReactNode
  /** 主要アクション。モバイルではタイトル下に全幅で並ぶ。 */
  actions?: React.ReactNode
  breadcrumbs?: Breadcrumb[]
  /** 下マージン。既定 'md'。 */
  spacing?: 'sm' | 'md'
  className?: string
}

export default function PageHeader({
  title,
  description,
  badge,
  actions,
  breadcrumbs,
  spacing = 'md',
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`${spacing === 'sm' ? 'mb-4' : 'mb-5 sm:mb-6'} ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2 flex items-center gap-1.5 text-[13px] overflow-x-auto lh-no-scrollbar">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={`${b.label}-${i}`}>
              {i > 0 && <span className="text-gray-300 shrink-0">/</span>}
              {b.href ? (
                <Link href={b.href} className="text-blue-600 hover:underline whitespace-nowrap shrink-0">
                  {b.label}
                </Link>
              ) : (
                <span className="text-gray-600 whitespace-nowrap shrink-0">{b.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight break-words min-w-0">
              {title}
            </h1>
            {badge}
          </div>
          {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
        </div>

        {actions && (
          <div className="flex flex-wrap gap-2 shrink-0 [&>*]:flex-1 [&>*]:min-h-11 [&>*]:inline-flex [&>*]:items-center [&>*]:justify-center sm:[&>*]:flex-none">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
