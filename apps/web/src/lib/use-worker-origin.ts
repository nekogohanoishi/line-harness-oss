'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from './api'

/**
 * Worker の絶対オリジンを返す。
 *
 * 用途は「画面に表示してコピーさせる URL」「新しいタブで開く URL」。
 * Webhook URL、友だち追加リンク (/r/:ref)、プール公開URL など、相対パスでは
 * 意味を成さないものに使う。
 *
 * 同一オリジン運用では NEXT_PUBLIC_API_URL が空なので window.location.origin
 * を使う。ただし `output: 'export'` のプリレンダー時は window が無いため、
 * 初回レンダーは API_BASE（＝空文字）を返し、マウント後に実オリジンへ
 * 差し替える。こうしないとハイドレーション不一致になる。
 */
export function useWorkerOrigin(): string {
  const [origin, setOrigin] = useState(API_BASE)

  useEffect(() => {
    if (API_BASE) return
    setOrigin(window.location.origin)
  }, [])

  return origin
}
