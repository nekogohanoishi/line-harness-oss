'use client'

import { useMemo, useRef, type RefObject } from 'react'
import { parseBuilderFlex } from '@line-crm/shared'
import FlexBuilder from '@/components/flex-builder/flex-builder'
import MessageVariableButton from '@/components/message-variable-button'
import { MessageBubble, TalkArea } from '@/components/messages/talk-preview'
import {
  collectFlexButtonFields,
  collectFlexTextFields,
  updateFlexButton,
  updateJsonAtPath,
  type FlexTextField,
} from './auto-reply-editor-utils'

interface Props {
  value: string
  onChange: (nextValue: string) => void
}

const sectionLabels: Record<FlexTextField['section'], string> = {
  header: '見出し',
  body: '本文',
  footer: 'ボタン周辺',
  other: 'テキスト',
}

function EditableText({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (nextValue: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const multiline = value.includes('\n') || value.length > 55

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-gray-600">{label}</label>
        <MessageVariableButton targetRef={ref} value={value} onChange={onChange} />
      </div>
      {multiline ? (
        <textarea
          ref={ref as RefObject<HTMLTextAreaElement>}
          rows={Math.min(8, Math.max(3, value.split('\n').length + 1))}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      ) : (
        <input
          ref={ref as RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      )}
    </div>
  )
}

export default function FlexContentEditor({ value, onChange }: Props) {
  const builderCompatible = useMemo(() => !value.trim() || Boolean(parseBuilderFlex(value)), [value])
  const parsed = useMemo(() => {
    try {
      return { content: JSON.parse(value) as unknown, error: '' }
    } catch {
      return { content: null, error: 'Flexメッセージのデータを読み込めません' }
    }
  }, [value])

  if (builderCompatible) {
    return <FlexBuilder value={value} onChange={onChange} />
  }

  if (!parsed.content) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600">{parsed.error}</p>
        <textarea
          rows={12}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-md border border-red-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </div>
    )
  }

  const textFields = collectFlexTextFields(parsed.content)
  const buttonFields = collectFlexButtonFields(parsed.content)
  const sectionCounts: Record<FlexTextField['section'], number> = {
    header: 0,
    body: 0,
    footer: 0,
    other: 0,
  }

  const commit = (nextContent: unknown) => onChange(JSON.stringify(nextContent))

  return (
    <div className="space-y-3">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">表示する文章</p>
            <p className="mt-0.5 text-xs text-gray-500">色や配置を保ったまま、文章だけを変更できます。</p>
          </div>
          {textFields.map((field) => {
            sectionCounts[field.section] += 1
            const label = `${sectionLabels[field.section]} ${sectionCounts[field.section]}`
            return (
              <EditableText
                key={field.path.join('.')}
                label={label}
                value={field.text}
                onChange={(nextText) => commit(updateJsonAtPath(parsed.content, field.path, nextText))}
              />
            )
          })}

          {buttonFields.length > 0 && (
            <div className="space-y-3 border-t border-gray-200 pt-4">
              <p className="text-sm font-semibold text-gray-900">ボタン</p>
              {buttonFields.map((field, index) => (
                <div key={field.actionPath.join('.')} className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">ボタン名 {index + 1}</label>
                    <input
                      type="text"
                      value={field.label}
                      onChange={(event) => commit(updateFlexButton(parsed.content, field, { label: event.target.value }))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">押したときの動作</label>
                    <select
                      value={field.actionType}
                      onChange={(event) => commit(updateFlexButton(parsed.content, field, {
                        actionType: event.target.value as typeof field.actionType,
                        actionValue: '',
                      }))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="message">メッセージを送る</option>
                      <option value="uri">ページを開く</option>
                      <option value="postback">画面に出さず処理する</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      {field.actionType === 'uri' ? '開くURL' : field.actionType === 'message' ? '送信する言葉' : '処理データ'}
                    </label>
                    <input
                      type={field.actionType === 'uri' ? 'url' : 'text'}
                      value={field.actionValue}
                      onChange={(event) => commit(updateFlexButton(parsed.content, field, { actionValue: event.target.value }))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium text-gray-500">LINEでの表示</p>
          {/* 名前の差し込みは、表示のときだけ分かりやすい言葉にする (保存する内容は変えない) */}
          <TalkArea>
            <MessageBubble type="flex" content={value.replaceAll('{{name}}', '［友だちの表示名］')} />
          </TalkArea>
        </div>
      </div>

      <details className="border-t border-gray-200 pt-3">
        <summary className="min-h-[40px] cursor-pointer text-xs font-medium text-gray-500">
          デザインの詳細を編集する
        </summary>
        <p className="mb-2 text-xs text-amber-700">通常は開く必要はありません。JSONの知識がある場合だけ編集してください。</p>
        <textarea
          rows={12}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </details>
    </div>
  )
}
