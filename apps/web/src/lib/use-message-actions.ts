'use client'

import { useEffect, useState } from 'react'
import { api, type MessageAction } from '@/lib/api'

// ボタンの動きの一覧は、ボタンの編集欄やクイックリプライ欄がいくつ並んでも
// 1回だけ読み込むよう、ページ内で共有する。
let cached: Promise<MessageAction[]> | null = null

export function useMessageActions(): { actions: MessageAction[]; origin: string } {
  const [actions, setActions] = useState<MessageAction[]>([])
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
    cached ??= api.messageActions.list()
      .then((res) => (res.success ? res.data : []))
      .catch(() => [])
    let alive = true
    void cached.then((list) => { if (alive) setActions(list) })
    return () => { alive = false }
  }, [])
  return { actions, origin }
}
