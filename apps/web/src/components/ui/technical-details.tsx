'use client'

import { useState } from 'react'

export interface TechnicalDetailItem {
  label: string
  value: string | number | null | undefined
  copyable?: boolean
}

export interface TechnicalDetailsProps {
  items: TechnicalDetailItem[]
  label?: string
  className?: string
}

export default function TechnicalDetails({
  items,
  label = '技術情報',
  className = '',
}: TechnicalDetailsProps) {
  const [copiedLabel, setCopiedLabel] = useState('')
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== '')

  if (visibleItems.length === 0) return null

  const copy = async (item: TechnicalDetailItem) => {
    if (!item.copyable || item.value === null || item.value === undefined) return
    try {
      await navigator.clipboard.writeText(String(item.value))
      setCopiedLabel(item.label)
      window.setTimeout(() => setCopiedLabel(''), 1500)
    } catch {
      setCopiedLabel('')
    }
  }

  return (
    <details className={`group text-xs text-gray-500 ${className}`}>
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 font-medium text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
        {label}
      </summary>
      <dl className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
        {visibleItems.map((item, index) => (
          <div key={`${item.label}-${index}`} className="grid grid-cols-[minmax(88px,0.35fr)_minmax(0,1fr)_auto] items-start gap-2 py-2">
            <dt className="text-gray-400">{item.label}</dt>
            <dd className="break-all font-mono text-xs leading-5 text-gray-600">{String(item.value)}</dd>
            {item.copyable ? (
              <button
                type="button"
                onClick={() => void copy(item)}
                className="min-h-8 rounded px-2 text-xs font-medium text-blue-600 hover:bg-blue-50"
                aria-label={`${item.label}をコピー`}
              >
                {copiedLabel === item.label ? 'コピー済み' : 'コピー'}
              </button>
            ) : null}
          </div>
        ))}
      </dl>
    </details>
  )
}
