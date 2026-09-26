import React from 'react'

interface HeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export default function Header({ title, description, action }: HeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
        </div>
        {action && <div className="w-full sm:ml-4 sm:w-auto sm:shrink-0">{action}</div>}
      </div>
    </div>
  )
}
