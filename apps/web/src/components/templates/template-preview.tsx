'use client'

// テンプレートの本文を、友だちの LINE トーク画面での見え方に寄せて見せる。
// 一覧と編集画面で同じ見た目にそろえるため、吹き出しの組み立てをここに集めている。

import { useLayoutEffect, useRef, useState } from 'react'
import { MessageBubble, TalkArea, TalkNote } from '@/components/messages/talk-preview'

/** 一覧で Flex を縮めるときの高さ (px)。これより少し高いときだけ切り詰める */
const CROP_HEIGHT = 240

export function isFlexLikeType(type: string): boolean {
  return type === 'flex' || type === 'carousel'
}

/** 本文の {{name}} は友だちの表示名になって届く。画面では仮の表記で見せる (保存する本文は変えない)。 */
export function readableTemplateContent(content: string): string {
  return content.replaceAll('{{name}}', '［友だちの表示名］')
}

/** 本文が何行になりそうか。charsPerLine は1行に入る文字数の目安。 */
function estimateLines(text: string, charsPerLine: number): number {
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
}

/**
 * テンプレートの本文を、トーク画面の背景 (TalkArea) の中の吹き出しで見せる。
 * compact を付けると一覧向けになり、長いテキストは先頭4行、高い Flex は上の部分だけに縮めて、
 * 下に「全文を表示する」を出す。開閉の状態はこの部品の中で持つ。
 */
export default function TemplatePreview({
  type,
  content,
  compact = false,
  emptyNote = '本文がまだありません',
}: {
  type: string
  content: string
  compact?: boolean
  /** 本文が空のときにトーク画面の中へ出す補足 */
  emptyNote?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [tall, setTall] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const isFlex = isFlexLikeType(type)
  const blank = !content.trim()

  // Flex は中身の高さを測り、縮める必要があるときだけ切り詰める。
  // 画像の読み込みで高さが変わるので、大きさの変化も見張る。
  useLayoutEffect(() => {
    const inner = bodyRef.current?.firstElementChild
    if (!compact || !isFlex || blank || !inner) {
      setTall(false)
      return
    }
    const measure = () => setTall(inner.getBoundingClientRect().height > CROP_HEIGHT + 24)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [compact, isFlex, blank, content])

  const crop = compact && isFlex && tall && !expanded
  // テキストは4行を超えそうなときだけ切り替えを出す。広い画面では1行が長いので、収まるなら出さない
  const moreOnPhone = type === 'text' && estimateLines(content, 18) > 4
  const moreOnWide = type === 'text' && estimateLines(content, 34) > 4
  const showToggle = compact && !blank && (isFlex ? tall : moreOnPhone)

  return (
    <>
      <TalkArea>
        {blank ? (
          <TalkNote>{emptyNote}</TalkNote>
        ) : (
          <div ref={bodyRef} className={`pl-2 ${crop ? 'relative overflow-hidden' : ''}`} style={crop ? { maxHeight: CROP_HEIGHT } : undefined}>
            <MessageBubble type={type} content={readableTemplateContent(content)} clamp={compact && !expanded} />
            {crop && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-[linear-gradient(to_top,#E8EEF6,rgba(232,238,246,0))]"
              />
            )}
          </div>
        )}
      </TalkArea>
      {showToggle && (
        // 一覧の行の下余白 (py-4) に収まるよう、44px の押せる高さの分だけ下を詰める
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={`-mb-3 mt-1 min-h-[44px] text-sm font-medium text-blue-700 hover:underline ${!isFlex && !moreOnWide ? 'sm:hidden' : ''}`}
        >
          {expanded ? '短く表示する' : isFlex ? '全体を表示する' : '全文を表示する'}
        </button>
      )}
    </>
  )
}
