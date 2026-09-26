'use client'

import { useState } from 'react'
import PromptModal, { type PromptTemplate } from '@/components/prompt-modal'

interface CcPromptButtonProps {
  prompts: PromptTemplate[]
  variant?: 'floating' | 'inline'
}

export default function CcPromptButton({ prompts, variant = 'floating' }: CcPromptButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={variant === 'inline'
          ? 'inline-flex h-8 flex-shrink-0 items-center rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          : 'fixed bottom-6 right-6 z-50 flex min-h-[48px] items-center gap-2 rounded-full bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-gray-800'}
        aria-label="CCに依頼"
      >
        {variant === 'floating' && <span className="text-base leading-none">📋</span>}
        <span className={variant === 'floating' ? 'hidden sm:inline' : ''}>CCに依頼</span>
      </button>

      <PromptModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        prompts={prompts}
      />
    </>
  )
}
