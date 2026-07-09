'use client'

import { useMemo, useState } from 'react'
import type { FlexBuilderState, FlexBuilderBubbleState } from '@line-crm/shared'
import {
  buildFlexJson,
  parseBuilderFlex,
  buildFlexAltTextPreview,
  emptyFlexBuilderBubble,
  emptyFlexBuilderState,
  FLEX_BUILDER_MAX_CAROUSEL_BUBBLES,
} from '@line-crm/shared'
import FlexPreviewComponent from '@/components/flex-preview'
import BubbleCard from './bubble-card'

interface FlexBuilderProps {
  /** ステップの messageContent (Flex JSON 文字列) */
  value: string
  onChange: (nextJson: string) => void
}

function toPrettyJson(state: FlexBuilderState): string {
  return JSON.stringify(buildFlexJson(state), null, 2)
}

/** 空文字 (新規ステップ) は簡単モードで開始できる扱いにする */
function canUseSimpleMode(raw: string): boolean {
  if (!raw.trim()) return true
  return Boolean(parseBuilderFlex(raw))
}

const tabActiveCls = 'bg-white text-green-700 shadow-sm'
const tabInactiveCls = 'text-gray-500 hover:text-gray-700'

/**
 * Flex メッセージ「かんたんビルダー」
 *
 * 完全制御コンポーネント: 構造化された編集状態は持たず、常に親の `value` (messageContent
 * の JSON 文字列) から都度導出する (ScheduleInput 等、このコードベースの既存パターンに合わせている)。
 * ローカル state は「今どちらのタブを表示しているか」という UI 上の選択だけ。
 */
export default function FlexBuilder({ value, onChange }: FlexBuilderProps) {
  const [tab, setTab] = useState<'simple' | 'json'>(() => (canUseSimpleMode(value) ? 'simple' : 'json'))

  const simpleModeAvailable = useMemo(() => canUseSimpleMode(value), [value])

  const state: FlexBuilderState = useMemo(() => {
    if (!value.trim()) return emptyFlexBuilderState()
    return parseBuilderFlex(value) ?? emptyFlexBuilderState()
  }, [value])

  const previewContent = useMemo(() => (value.trim() ? value : toPrettyJson(state)), [value, state])

  const altTextPreview = useMemo(() => buildFlexAltTextPreview(state), [state])

  const jsonSyntaxError = useMemo(() => {
    if (!value.trim()) return ''
    try {
      JSON.parse(value)
      return ''
    } catch {
      return 'JSON構文エラーがあります'
    }
  }, [value])

  function commit(next: FlexBuilderState) {
    onChange(toPrettyJson(next))
  }

  function handleAddBubble() {
    if (state.bubbles.length >= FLEX_BUILDER_MAX_CAROUSEL_BUBBLES) return
    const nextBubbles = [...state.bubbles, emptyFlexBuilderBubble()]
    commit({ mode: nextBubbles.length > 1 ? 'carousel' : 'single', bubbles: nextBubbles })
  }

  function handleDuplicateBubble(index: number) {
    if (state.bubbles.length >= FLEX_BUILDER_MAX_CAROUSEL_BUBBLES) return
    const source = state.bubbles[index]
    const clone: FlexBuilderBubbleState = { ...source, buttons: source.buttons.map((b) => ({ ...b })) }
    const nextBubbles = [...state.bubbles.slice(0, index + 1), clone, ...state.bubbles.slice(index + 1)]
    commit({ mode: 'carousel', bubbles: nextBubbles })
  }

  function handleRemoveBubble(index: number) {
    if (state.bubbles.length <= 1) return
    const nextBubbles = state.bubbles.filter((_, i) => i !== index)
    commit({ mode: nextBubbles.length > 1 ? 'carousel' : 'single', bubbles: nextBubbles })
  }

  function handleMoveBubble(index: number, direction: 'left' | 'right') {
    const swapWith = direction === 'left' ? index - 1 : index + 1
    if (swapWith < 0 || swapWith >= state.bubbles.length) return
    const nextBubbles = [...state.bubbles]
    ;[nextBubbles[index], nextBubbles[swapWith]] = [nextBubbles[swapWith], nextBubbles[index]]
    commit({ ...state, bubbles: nextBubbles })
  }

  function updateBubble(index: number, next: FlexBuilderBubbleState) {
    commit({ ...state, bubbles: state.bubbles.map((b, i) => (i === index ? next : b)) })
  }

  function handleSwitchToSimple() {
    // simpleModeAvailable が false の間はボタン自体を disabled にしているため、
    // ここに到達する時点で必ず simpleModeAvailable === true
    setTab('simple')
  }

  function handleSwitchToJson() {
    setTab('json')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={handleSwitchToSimple}
          disabled={!simpleModeAvailable}
          title={simpleModeAvailable ? undefined : 'この内容は簡単モードでは表現できません'}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tab === 'simple' ? tabActiveCls : tabInactiveCls}`}
        >
          簡単モード
        </button>
        <button
          type="button"
          onClick={handleSwitchToJson}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === 'json' ? tabActiveCls : tabInactiveCls}`}
        >
          JSONモード（上級者向け）
        </button>
      </div>

      {!simpleModeAvailable && (
        <p className="text-xs text-amber-700">
          ⓘ このFlexは簡単モードでは編集できません（複雑な構造のため、JSON編集のみ可能です）
        </p>
      )}

      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:flex-1 min-w-0 space-y-3">
          {tab === 'simple' ? (
            <div className="space-y-3">
              {state.bubbles.map((bubble, i) => (
                <BubbleCard
                  key={i}
                  bubble={bubble}
                  index={i}
                  total={state.bubbles.length}
                  onChange={(next) => updateBubble(i, next)}
                  onDuplicate={() => handleDuplicateBubble(i)}
                  onRemove={() => handleRemoveBubble(i)}
                  onMove={(dir) => handleMoveBubble(i, dir)}
                />
              ))}
              <button
                type="button"
                onClick={handleAddBubble}
                disabled={state.bubbles.length >= FLEX_BUILDER_MAX_CAROUSEL_BUBBLES}
                className="w-full text-xs font-medium text-green-700 border border-dashed border-green-300 rounded-lg py-2 hover:bg-green-50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                + バブルを追加{state.bubbles.length === 1 ? '（カルーセルにする）' : ''}
              </button>
            </div>
          ) : (
            <div>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={16}
                placeholder="Flex Message JSON を直接入力..."
                value={value}
                onChange={(e) => onChange(e.target.value)}
              />
              {jsonSyntaxError && <p className="text-xs text-red-600 mt-1">{jsonSyntaxError}</p>}
            </div>
          )}
        </div>

        <div className="md:w-72 shrink-0 space-y-2">
          <p className="text-xs font-medium text-gray-500">プレビュー</p>
          <div className="rounded-lg border border-gray-200 bg-white p-3 overflow-x-auto">
            <FlexPreviewComponent content={previewContent} maxWidth={260} />
          </div>
          {altTextPreview && (
            <p className="text-xs text-gray-400">
              ⓘ 通知欄には「{altTextPreview}」のように表示されます（自動生成・編集不可）
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
