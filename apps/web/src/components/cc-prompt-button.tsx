'use client'

import { useState } from 'react'
import PromptModal, { type PromptTemplate } from '@/components/prompt-modal'

interface CcPromptButtonProps {
  prompts: PromptTemplate[]
  variant?: 'floating' | 'inline'
}

export default function CcPromptButton({ prompts, variant = 'floating' }: CcPromptButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  // 'floating' は以前、画面右下に固定表示していたが、一覧の削除ボタンや
  // シートの保存ボタンの上に重なって押せなくなるため、ページの末尾に置く。
  const button = (
    <button
      type="button"
      onClick={() => setIsOpen(true)}
      className={variant === 'inline'
        ? 'inline-flex h-8 flex-shrink-0 items-center whitespace-nowrap rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        : 'inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50'}
    >
      Claude Code への依頼文
    </button>
  )

  return (
    <>
      {variant === 'floating'
        ? <div className="mt-10 flex justify-end border-t border-gray-200 pt-4">{button}</div>
        : button}

      <PromptModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        prompts={prompts}
      />
    </>
  )
}
