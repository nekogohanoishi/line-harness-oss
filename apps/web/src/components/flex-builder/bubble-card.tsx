'use client'

import { useRef } from 'react'
import type { FlexBuilderBubbleState, FlexBuilderButton, FlexActionKind, FlexHeaderColor } from '@line-crm/shared'
import { emptyFlexBuilderButton, FLEX_BUILDER_HEADER_COLORS, FLEX_BUILDER_MAX_BUTTONS } from '@line-crm/shared'
import MessageVariableButton from '@/components/message-variable-button'

const headerColorOptions: { value: FlexHeaderColor; label: string }[] = [
  { value: 'green', label: '緑' },
  { value: 'blue', label: '青' },
  { value: 'gray', label: 'グレー' },
]

const actionTypeOptions: { value: FlexActionKind; label: string }[] = [
  { value: 'uri', label: 'URLを開く' },
  { value: 'message', label: 'テキストを送信させる' },
  { value: 'postback', label: 'ポストバック（上級者向け）' },
]

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

function actionValueField(button: FlexBuilderButton) {
  if (button.actionType === 'uri') return { label: 'URL', placeholder: 'https://example.com', type: 'url' }
  if (button.actionType === 'message') return { label: '送信させるテキスト', placeholder: '例: はい', type: 'text' }
  return { label: 'postback data（上級者向け）', placeholder: '例: lh:custom:action1', type: 'text' }
}

interface ButtonRowProps {
  button: FlexBuilderButton
  index: number
  canRemove: boolean
  onChange: (next: FlexBuilderButton) => void
  onRemove: () => void
}

function ButtonRow({ button, index, canRemove, onChange, onRemove }: ButtonRowProps) {
  const valueField = actionValueField(button)
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">ボタン {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-30 disabled:hover:text-red-500"
        >
          削除
        </button>
      </div>
      <div>
        <label className={labelCls}>
          ラベル <span className="text-red-500">*</span>
          <span className="text-gray-400 font-normal"> ({button.label.length}/20字)</span>
        </label>
        <input
          type="text"
          maxLength={20}
          className={inputCls}
          placeholder="例: 詳細を見る"
          value={button.label}
          onChange={(e) => onChange({ ...button, label: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>アクション種別</label>
          <select
            className={inputCls + ' bg-white'}
            value={button.actionType}
            onChange={(e) => onChange({ ...button, actionType: e.target.value as FlexActionKind })}
          >
            {actionTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>スタイル</label>
          <select
            className={inputCls + ' bg-white'}
            value={button.style}
            onChange={(e) => onChange({ ...button, style: e.target.value as FlexBuilderButton['style'] })}
          >
            <option value="primary">緑（primary）</option>
            <option value="secondary">グレー（secondary）</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>{valueField.label} <span className="text-red-500">*</span></label>
        <input
          type={valueField.type}
          className={inputCls}
          placeholder={valueField.placeholder}
          value={button.actionValue}
          onChange={(e) => onChange({ ...button, actionValue: e.target.value })}
        />
      </div>
    </div>
  )
}

interface BubbleCardProps {
  bubble: FlexBuilderBubbleState
  index: number
  total: number
  onChange: (next: FlexBuilderBubbleState) => void
  onDuplicate: () => void
  onRemove: () => void
  onMove: (direction: 'left' | 'right') => void
}

export default function BubbleCard({ bubble, index, total, onChange, onDuplicate, onRemove, onMove }: BubbleCardProps) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const isCarousel = total > 1

  function updateButton(i: number, next: FlexBuilderButton) {
    onChange({ ...bubble, buttons: bubble.buttons.map((b, bi) => (bi === i ? next : b)) })
  }

  function addButton() {
    if (bubble.buttons.length >= FLEX_BUILDER_MAX_BUTTONS) return
    onChange({ ...bubble, buttons: [...bubble.buttons, emptyFlexBuilderButton()] })
  }

  function removeButton(i: number) {
    if (bubble.buttons.length <= 1) return
    onChange({ ...bubble, buttons: bubble.buttons.filter((_, bi) => bi !== i) })
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      {isCarousel && (
        <div className="flex items-center justify-between border-b border-gray-200 pb-2">
          <span className="text-xs font-semibold text-gray-700">バブル {index + 1} / {total}</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onMove('left')}
              disabled={index === 0}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30"
              aria-label="左へ移動"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => onMove('right')}
              disabled={index === total - 1}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30"
              aria-label="右へ移動"
            >
              →
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-200"
            >
              複製
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
            >
              このバブルを削除
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 items-end">
        <div className="col-span-2">
          <label className={labelCls}>ヘッダーテキスト（任意）</label>
          <input
            type="text"
            className={inputCls}
            placeholder="例: アンケート 1/4"
            value={bubble.headerText}
            onChange={(e) => onChange({ ...bubble, headerText: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls}>ヘッダー色</label>
          <select
            className={inputCls + ' bg-white'}
            value={bubble.headerColor}
            onChange={(e) => onChange({ ...bubble, headerColor: e.target.value as FlexHeaderColor })}
          >
            {headerColorOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-1">
        {headerColorOptions.map((opt) => (
          <span
            key={opt.value}
            className={`inline-block w-4 h-4 rounded-full border ${bubble.headerColor === opt.value ? 'border-gray-700' : 'border-transparent'}`}
            style={{ backgroundColor: FLEX_BUILDER_HEADER_COLORS[opt.value] }}
            title={opt.label}
          />
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className={labelCls + ' mb-0'}>
            本文テキスト <span className="text-red-500">*</span>
          </label>
          <MessageVariableButton
            targetRef={bodyRef}
            value={bubble.bodyText}
            onChange={(next) => onChange({ ...bubble, bodyText: next })}
          />
        </div>
        <textarea
          ref={bodyRef}
          className={inputCls + ' resize-none'}
          rows={3}
          placeholder="本文（複数行可）"
          value={bubble.bodyText}
          onChange={(e) => onChange({ ...bubble, bodyText: e.target.value })}
        />
        {!bubble.bodyText.trim() && <p className="text-xs text-red-500 mt-0.5">本文テキストを入力してください</p>}
      </div>

      <div>
        <label className={labelCls}>画像 URL（任意・hero画像として上部に表示）</label>
        <input
          type="url"
          className={inputCls}
          placeholder="https://example.com/image.png"
          value={bubble.imageUrl}
          onChange={(e) => onChange({ ...bubble, imageUrl: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700">ボタン（1〜4個）</label>
          <button
            type="button"
            onClick={addButton}
            disabled={bubble.buttons.length >= FLEX_BUILDER_MAX_BUTTONS}
            className="text-xs font-medium text-green-700 hover:text-green-800 disabled:opacity-30 disabled:hover:text-green-700"
          >
            + ボタンを追加
          </button>
        </div>
        {bubble.buttons.map((button, i) => (
          <ButtonRow
            key={i}
            button={button}
            index={i}
            canRemove={bubble.buttons.length > 1}
            onChange={(next) => updateButton(i, next)}
            onRemove={() => removeButton(i)}
          />
        ))}
      </div>
    </div>
  )
}
