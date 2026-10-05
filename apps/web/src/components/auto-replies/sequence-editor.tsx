'use client'

import { useMemo, useRef } from 'react'
import MessageVariableButton from '@/components/message-variable-button'
import FlexContentEditor from './flex-content-editor'
import {
  changeSequenceMessageType,
  defaultSequenceMessage,
  getDeliveryMode,
  parseSequenceDocument,
  setDeliveryMode,
  stringifySequenceDocument,
  type AutoReplyMessageType,
  type EditableSequenceMessage,
} from './auto-reply-editor-utils'

interface Props {
  value: string
  onChange: (nextValue: string) => void
}

const messageTypeLabels: Record<AutoReplyMessageType, string> = {
  text: 'テキスト',
  flex: 'カード型メッセージ',
  image: '画像',
}

function TextMessageEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (nextValue: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-gray-600">送信する文章</label>
        <MessageVariableButton targetRef={ref} value={value} onChange={onChange} />
      </div>
      <textarea
        ref={ref}
        rows={8}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  )
}

function ImageMessageEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (nextValue: string) => void
}) {
  let image: { originalContentUrl?: string; previewImageUrl?: string } = {}
  try {
    image = JSON.parse(value)
  } catch {
    // 入力欄から修復できるよう空値として扱う。
  }
  const update = (next: typeof image) => onChange(JSON.stringify(next))
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">画像URL</label>
        <input
          type="url"
          value={image.originalContentUrl ?? ''}
          onChange={(event) => update({ ...image, originalContentUrl: event.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">プレビュー画像URL</label>
        <input
          type="url"
          value={image.previewImageUrl ?? ''}
          onChange={(event) => update({ ...image, previewImageUrl: event.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>
    </div>
  )
}

function TimingEditor({
  message,
  onChange,
}: {
  message: EditableSequenceMessage
  onChange: (nextMessage: EditableSequenceMessage) => void
}) {
  const mode = getDeliveryMode(message)
  return (
    <div className="space-y-3 border-t border-gray-200 pt-4">
      <div>
        <p className="mb-2 text-xs font-medium text-gray-600">送信タイミング</p>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-gray-100 p-1">
          {([
            { value: 'immediate', label: 'すぐ送る' },
            { value: 'delay', label: '時間を空ける' },
            { value: 'clock', label: '指定時刻' },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(setDeliveryMode(message, option.value))}
              className={`min-h-[40px] rounded px-2 text-xs font-medium ${
                mode === option.value ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'delay' && (
        <div className="max-w-xs">
          <label className="mb-1 block text-xs font-medium text-gray-600">何分後に送るか</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.02"
              max="1440"
              step="0.5"
              value={(message.delaySeconds ?? 60) / 60}
              onChange={(event) => onChange({
                ...message,
                delaySeconds: Math.max(1, Math.min(86_400, Math.round(Number(event.target.value) * 60))),
              })}
              className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <span className="text-sm text-gray-600">分後</span>
          </div>
        </div>
      )}

      {mode === 'clock' && (
        <div className="space-y-3 rounded-md bg-green-50 p-3">
          <p className="text-xs leading-5 text-green-900">
            締切時刻までに反応した人には当日、それより後の人には翌日の指定時刻に送ります。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">当日配信の締切</label>
              <input
                type="time"
                value={message.sameDayCutoffTimeJst ?? '18:00'}
                onChange={(event) => onChange({ ...message, sameDayCutoffTimeJst: event.target.value })}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">送信時刻</label>
              <input
                type="time"
                value={message.deliveryTimeJst ?? '20:00'}
                onChange={(event) => onChange({ ...message, deliveryTimeJst: event.target.value })}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <p className="text-xs font-medium text-green-800">
            現在の設定：{message.sameDayCutoffTimeJst ?? '18:00'}までなら当日{message.deliveryTimeJst ?? '20:00'}、それ以降なら翌日{message.deliveryTimeJst ?? '20:00'}
          </p>
        </div>
      )}
    </div>
  )
}

export default function SequenceEditor({ value, onChange }: Props) {
  const parsed = useMemo(() => {
    try {
      return { document: parseSequenceDocument(value), error: '' }
    } catch (error) {
      return {
        document: null,
        error: error instanceof Error ? error.message : '複数メッセージを読み込めません',
      }
    }
  }, [value])

  if (!parsed.document) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">{parsed.error}</p>
        <p className="text-xs text-gray-500">下のデータを修正すると、通常の編集画面へ戻ります。</p>
        <textarea
          rows={14}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-md border border-red-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </div>
    )
  }

  const document = parsed.document
  const commitMessages = (messages: EditableSequenceMessage[]) => {
    onChange(stringifySequenceDocument({ ...document, messages }))
  }
  const updateMessage = (index: number, nextMessage: EditableSequenceMessage) => {
    commitMessages(document.messages.map((message, current) => current === index ? nextMessage : message))
  }
  const moveMessage = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= document.messages.length) return
    const messages = [...document.messages]
    ;[messages[index], messages[target]] = [messages[target], messages[index]]
    commitMessages(messages)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">送信するメッセージ</p>
          <p className="mt-0.5 text-xs text-gray-500">上から順番に送信されます。最大5通です。</p>
        </div>
        <button
          type="button"
          onClick={() => commitMessages([...document.messages, defaultSequenceMessage()])}
          disabled={document.messages.length >= 5}
          className="min-h-[40px] rounded-md border border-green-300 px-3 text-xs font-medium text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          メッセージを追加
        </button>
      </div>

      <div className="divide-y divide-gray-300 rounded-md border border-gray-300">
        {document.messages.map((message, index) => (
          <section key={index} className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <select
                  value={message.messageType}
                  onChange={(event) => updateMessage(index, changeSequenceMessageType(
                    message,
                    event.target.value as AutoReplyMessageType,
                  ))}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-500"
                  aria-label={`${index + 1}通目の種類`}
                >
                  {Object.entries(messageTypeLabels).map(([type, label]) => (
                    <option key={type} value={type}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveMessage(index, -1)}
                  disabled={index === 0}
                  title="上へ移動"
                  className="h-10 w-10 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveMessage(index, 1)}
                  disabled={index === document.messages.length - 1}
                  title="下へ移動"
                  className="h-10 w-10 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => commitMessages(document.messages.filter((_, current) => current !== index))}
                  disabled={document.messages.length === 1}
                  className="min-h-[40px] rounded-md px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-30"
                >
                  削除
                </button>
              </div>
            </div>

            {message.messageType === 'text' && (
              <TextMessageEditor
                value={message.messageContent}
                onChange={(messageContent) => updateMessage(index, { ...message, messageContent })}
              />
            )}
            {message.messageType === 'flex' && (
              <FlexContentEditor
                value={message.messageContent}
                onChange={(messageContent) => updateMessage(index, { ...message, messageContent })}
              />
            )}
            {message.messageType === 'image' && (
              <ImageMessageEditor
                value={message.messageContent}
                onChange={(messageContent) => updateMessage(index, { ...message, messageContent })}
              />
            )}

            <TimingEditor message={message} onChange={(nextMessage) => updateMessage(index, nextMessage)} />
          </section>
        ))}
      </div>

      <details>
        <summary className="min-h-[40px] cursor-pointer text-xs font-medium text-gray-400">保存データを確認する</summary>
        <p className="mb-2 text-xs text-gray-500">通常は編集する必要はありません。</p>
        <textarea
          rows={10}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </details>
    </div>
  )
}
