'use client'

// 配信するメッセージを「友だちの LINE トーク画面での見え方」に寄せて表示する部品。
// 1通ごとの境目がひと目で分かるよう、本文は必ず吹き出しの枠に入れ、
// 順番のある配信は番号付きの縦線 (TalkTimeline) でつなぐ。

import type { ReactNode } from 'react'
import FlexPreviewComponent from '@/components/flex-preview'

/** トーク画面に見立てた背景。吹き出しはこの中に置く。 */
export function TalkArea({ children }: { children: ReactNode }) {
  return <div className="max-w-2xl rounded-xl bg-[#E8EEF6] px-3 py-4 sm:px-5 sm:py-5">{children}</div>
}

const bubbleFrame = 'border border-[#CDD8E5] bg-white'

/**
 * 公式アカウントから友だちへ届く1通 (トーク画面の左側・白の吹き出し)。
 * clamp を付けると、テキストを先頭4行だけ見せる (一覧で長文が続くとき用)。
 */
export function MessageBubble({ type, content, clamp = false }: { type: string; content: string; clamp?: boolean }) {
  if (type === 'flex' || type === 'carousel') {
    return (
      <div className="max-w-full overflow-x-auto">
        <FlexPreviewComponent content={content} maxWidth={280} />
      </div>
    )
  }
  if (type === 'image') {
    let url: string | undefined
    try {
      const image = JSON.parse(content) as { previewImageUrl?: string; originalContentUrl?: string }
      url = image.previewImageUrl || image.originalContentUrl
    } catch {
      url = undefined
    }
    return url ? (
      <div className={`inline-block max-w-[85%] overflow-hidden rounded-2xl rounded-tl-md ${bubbleFrame}`}>
        <img src={url} alt="配信する画像" className="block max-h-64 max-w-full object-contain" />
      </div>
    ) : (
      <p className={`inline-block rounded-2xl rounded-tl-md px-4 py-3 text-sm text-red-700 ${bubbleFrame}`}>画像のURLが設定されていません</p>
    )
  }
  if (type !== 'text') {
    return (
      <p className={`inline-block rounded-2xl rounded-tl-md px-4 py-3 text-sm text-gray-600 ${bubbleFrame}`}>
        この形式（{type}）のメッセージは、ここでは中身を表示できません。
      </p>
    )
  }
  // 吹き出しの「しっぽ」は外側の枠に付ける。行数を絞る overflow:hidden は内側にだけ掛け、しっぽを切らない。
  return (
    <div
      className={`relative inline-block max-w-full rounded-2xl rounded-tl-md px-4 py-3 text-[15px] leading-[1.7] text-gray-900 sm:max-w-[34rem] ${bubbleFrame}
        before:absolute before:-left-[7px] before:top-3 before:h-3 before:w-3 before:rotate-45 before:border-b before:border-l before:border-[#CDD8E5] before:bg-white before:content-['']`}
    >
      <div className={`whitespace-pre-wrap break-words ${clamp ? 'line-clamp-4' : ''}`}>{content}</div>
    </div>
  )
}

/** 友だちが送る言葉 (トーク画面の右側・緑の吹き出し)。自動返信のきっかけを示す。 */
export function FriendBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-[#9BE27A] px-4 py-2.5 text-[15px] leading-6 text-gray-900 break-words">
        {children}
      </p>
    </div>
  )
}

/** トーク画面の日付表示のような、中央寄せの補足。 */
export function TalkNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center">
      <p className="rounded-full bg-[#CBD6E3] px-3 py-1 text-center text-xs leading-5 text-gray-800">{children}</p>
    </div>
  )
}

/** 順番のある配信を、番号付きの縦線でつなぐ。中身は TalkStep を並べる。 */
export function TalkTimeline({ children }: { children: ReactNode }) {
  return <ol className="space-y-0">{children}</ol>
}

/**
 * 配信の1通。番号の丸から次の通の丸まで縦線が伸び、
 * 見出し (何通目・いつ届くか・操作)、届く人の条件、吹き出し、補足の順に並べる。
 */
export function TalkStep({
  number,
  title,
  timing,
  condition,
  note,
  actions,
  isLast,
  children,
}: {
  number: number
  /**
   * 太字の見出し。省略すると「N通目」。1通ずつではなく、シナリオごとの次の送信など
   * 「何通目か」が意味を持たない並びでは、いつ何が起きるかをここに書く。
   */
  title?: string
  timing?: string
  condition?: string | null
  note?: ReactNode
  /** 見出しの右端に置く操作 (編集ボタンなど) */
  actions?: ReactNode
  isLast: boolean
  children: ReactNode
}) {
  return (
    <li className={`relative flex gap-3 ${isLast ? '' : 'pb-7'}`}>
      {!isLast && <span aria-hidden className="absolute bottom-0 left-[13px] top-8 w-0.5 rounded bg-[#AFC0D4]" />}
      <span
        aria-hidden
        className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#06C755] text-sm font-bold text-white ring-4 ring-[#E8EEF6]"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-sm leading-6">
            <span className="font-bold text-gray-900">{title ?? `${number}通目`}</span>
            {/* 狭い画面では操作ボタンと並ぶので、タイミングは2行目に回して語の途中で折り返さない */}
            {timing && <span className={`text-gray-700 ${actions ? 'block sm:ml-2 sm:inline' : 'ml-2'}`}>{timing}</span>}
          </p>
          {actions && <div className="-my-2 flex shrink-0 items-center">{actions}</div>}
        </div>
        {condition && (
          <p className="mt-1 text-[13px] leading-5 text-amber-900">
            <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium">条件</span>
            {condition}
          </p>
        )}
        <div className="mt-2 pl-2">{children}</div>
        {note && <div className="mt-1.5 pl-2 text-xs leading-5 text-gray-600">{note}</div>}
      </div>
    </li>
  )
}
