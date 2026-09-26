'use client'

import type { RefObject } from 'react'
import FlexContentEditor from '@/components/auto-replies/flex-content-editor'
import MessageVariableButton from '@/components/message-variable-button'
import TechnicalDetails from '@/components/ui/technical-details'

type Props = {
  messageType: string
  value: string
  onChange: (value: string) => void
  textRef?: RefObject<HTMLTextAreaElement | null>
}

type ImageContent = {
  originalContentUrl: string
  previewImageUrl: string
}

function parseImageContent(value: string): { content: ImageContent; error: string } {
  if (!value.trim()) {
    return { content: { originalContentUrl: '', previewImageUrl: '' }, error: '' }
  }
  try {
    const parsed = JSON.parse(value) as Partial<ImageContent>
    return {
      content: {
        originalContentUrl: typeof parsed.originalContentUrl === 'string' ? parsed.originalContentUrl : '',
        previewImageUrl: typeof parsed.previewImageUrl === 'string' ? parsed.previewImageUrl : '',
      },
      error: '',
    }
  } catch {
    return {
      content: { originalContentUrl: '', previewImageUrl: '' },
      error: '保存されている画像情報を読み込めません。URLを入力すると新しい内容に置き換わります。',
    }
  }
}

export function validateTemplateMessage(messageType: string, value: string): string {
  if (!value.trim()) return 'メッセージ内容を入力してください'

  if (messageType === 'image') {
    const parsed = parseImageContent(value)
    if (parsed.error) return parsed.error
    if (!parsed.content.originalContentUrl || !parsed.content.previewImageUrl) {
      return '画像URLとプレビュー画像URLを入力してください'
    }
  }

  if (messageType === 'flex' || messageType === 'carousel') {
    try {
      JSON.parse(value)
    } catch {
      return 'Flexメッセージの内容を確認してください'
    }
  }

  return ''
}

export default function TemplateMessageEditor({ messageType, value, onChange, textRef }: Props) {
  if (messageType === 'flex' || messageType === 'carousel') {
    return <FlexContentEditor value={value} onChange={onChange} />
  }

  if (messageType === 'image') {
    const parsed = parseImageContent(value)
    const update = (patch: Partial<ImageContent>) => {
      onChange(JSON.stringify({ ...parsed.content, ...patch }))
    }

    return (
      <div className="space-y-3">
        {parsed.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {parsed.error}
            <TechnicalDetails
              className="mt-2"
              items={[{ label: '保存されている情報', value, copyable: true }]}
            />
          </div>
        )}
        <label className="block">
          <span className="text-xs font-medium text-gray-600">画像URL</span>
          <input
            type="url"
            value={parsed.content.originalContentUrl}
            onChange={(event) => update({ originalContentUrl: event.target.value })}
            placeholder="https://..."
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">プレビュー画像URL</span>
          <input
            type="url"
            value={parsed.content.previewImageUrl}
            onChange={(event) => update({ previewImageUrl: event.target.value })}
            placeholder="https://..."
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </label>
        <p className="text-xs text-gray-500">トーク画面ではプレビュー画像が表示され、開くと元画像が表示されます。</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-gray-600">本文</label>
        {textRef && (
          <MessageVariableButton targetRef={textRef} value={value} onChange={onChange} />
        )}
      </div>
      <textarea
        ref={textRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={6}
        placeholder="送信するメッセージを入力してください"
        className="min-h-[150px] w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  )
}
