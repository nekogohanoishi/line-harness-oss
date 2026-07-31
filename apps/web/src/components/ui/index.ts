// 管理画面の共通 UI プリミティブ。
// スマホ (375px 基準) とデスクトップの両方で成立する形を 1 か所に集約している。
//
//   import { ResponsiveTable, Sheet, ConfirmSheet, SheetButton, PageHeader, EmptyState } from '@/components/ui'
//
// 個別 import (`@/components/ui/sheet` 等) でも同じものが取れる。

export { default as ResponsiveTable } from './responsive-table'
export type { ResponsiveTableProps, ResponsiveTableColumn, ColumnPriority } from './responsive-table'

export { default as Sheet, SheetButton, ConfirmSheet } from './sheet'
export type { SheetProps, SheetButtonProps, ConfirmSheetProps } from './sheet'

export { default as PageHeader } from './page-header'
export type { PageHeaderProps, Breadcrumb } from './page-header'

export { default as EmptyState } from './empty-state'
export type { EmptyStateProps } from './empty-state'
