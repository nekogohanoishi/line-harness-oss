'use client'

import type { RefObject } from 'react'

type TextControl = HTMLTextAreaElement | HTMLInputElement

interface MessageVariableButtonProps {
  targetRef: RefObject<TextControl | null>
  value: string
  onChange: (nextValue: string) => void
  insertValue?: string
  label?: string
  disabled?: boolean
  compact?: boolean
}

export default function MessageVariableButton({
  targetRef,
  value,
  onChange,
  insertValue = '{{name}}',
  label = 'LINE名を入れる',
  disabled = false,
  compact = false,
}: MessageVariableButtonProps) {
  const handleInsert = () => {
    const target = targetRef.current
    if (!target) {
      onChange(`${value}${insertValue}`)
      return
    }

    const start = target.selectionStart ?? value.length
    const end = target.selectionEnd ?? value.length
    const nextValue = `${value.slice(0, start)}${insertValue}${value.slice(end)}`
    onChange(nextValue)

    requestAnimationFrame(() => {
      target.focus()
      const nextCursor = start + insertValue.length
      target.setSelectionRange(nextCursor, nextCursor)
    })
  }

  return (
    <button
      type="button"
      onClick={handleInsert}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border border-green-200 bg-green-50 text-xs font-medium text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? 'h-8 px-2.5' : 'min-h-[44px] px-3 py-1.5 sm:min-h-[32px]'
      }`}
    >
      {label}
    </button>
  )
}
