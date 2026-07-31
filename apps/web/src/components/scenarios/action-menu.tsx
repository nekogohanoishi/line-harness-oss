'use client'

import { useEffect, useRef, useState } from 'react'

export interface ActionMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** 破壊的操作 (削除など) は赤字で表示する */
  tone?: 'default' | 'danger' | 'primary'
}

interface ActionMenuProps {
  items: ActionMenuItem[]
  /** 追加クラス (例: 'md:hidden' でモバイル専用にする) */
  className?: string
  label?: string
}

const toneCls: Record<NonNullable<ActionMenuItem['tone']>, string> = {
  default: 'text-gray-700',
  danger: 'text-red-600',
  primary: 'text-green-700',
}

/**
 * ケバブメニュー (⋮)。
 *
 * モバイルで操作ボタンが横に並びきらない箇所をこれ1つに集約するためのもの。
 * 依存を増やさないよう、外側クリック / Escape での閉じ処理まで自前で持つ。
 */
export default function ActionMenu({ items, className = '', label = '操作' }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`flex w-full items-center px-4 py-3 text-left text-sm transition-colors hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent ${toneCls[item.tone ?? 'default']}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
