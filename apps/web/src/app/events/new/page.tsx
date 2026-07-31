'use client'

import EventForm from '@/components/events/event-form'
import { useAccount } from '@/contexts/account-context'

export default function NewEventPage() {
  const { selectedAccountId } = useAccount()
  if (!selectedAccountId) {
    return <div className="text-gray-500">アカウントを選択してください。</div>
  }
  // 見出しは EventForm 側の PageHeader が出す (二重見出しにしない)。
  return <EventForm accountId={selectedAccountId} eventId={null} />
}
