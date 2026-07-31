'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import EventForm from '@/components/events/event-form'
import { useAccount } from '@/contexts/account-context'

function EditEventInner() {
  const params = useSearchParams()
  const id = params.get('id')
  const { selectedAccountId } = useAccount()
  if (!id) {
    return <div className="text-red-700">id クエリが必要です</div>
  }
  if (!selectedAccountId) {
    return <div className="text-gray-500">アカウントを選択してください。</div>
  }
  // 見出しは EventForm 側の PageHeader が出す (二重見出しにしない)。
  return <EventForm accountId={selectedAccountId} eventId={id} />
}

export default function EditEventPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">読み込み中...</div>}>
      <EditEventInner />
    </Suspense>
  )
}
