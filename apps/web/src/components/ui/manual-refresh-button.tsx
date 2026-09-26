'use client'

interface ManualRefreshButtonProps {
  onClick: () => void | Promise<void>
  loading?: boolean
  label?: string
  iconOnly?: boolean
}

export default function ManualRefreshButton({
  onClick,
  loading = false,
  label = '更新',
  iconOnly = false,
}: ManualRefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={() => { void onClick() }}
      disabled={loading}
      aria-label={loading ? `${label}中` : label}
      title={loading ? `${label}中` : label}
      className={`inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 ${
        iconOnly ? 'h-8 w-8' : 'h-10 gap-2 px-3'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
      >
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M6.1 9a7 7 0 0 1 11.4-2.6L20 9" />
        <path d="m4 15 2.5 2.6A7 7 0 0 0 17.9 15" />
      </svg>
      <span className={iconOnly ? 'sr-only' : undefined}>{loading ? '更新中' : label}</span>
    </button>
  )
}
