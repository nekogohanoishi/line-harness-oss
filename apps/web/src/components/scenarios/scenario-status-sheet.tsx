'use client'

import type { Scenario } from '@line-crm/shared'
import Sheet, { SheetButton } from '@/components/ui/sheet'

type ScenarioWithCount = Scenario & { stepCount?: number }

interface Props {
  open: boolean
  scenario: ScenarioWithCount | null
  conflict?: ScenarioWithCount | null
  busy?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (options?: { alsoDeactivateId?: string }) => void
}

export default function ScenarioStatusSheet({
  open,
  scenario,
  conflict = null,
  busy = false,
  error,
  onClose,
  onConfirm,
}: Props) {
  if (!scenario) return null

  const activating = !scenario.isActive
  const actionLabel = activating ? '有効にする' : '停止する'

  return (
    <Sheet
      open={open}
      onClose={onClose}
      busy={busy}
      size="sm"
      title={`「${scenario.name}」を${actionLabel}`}
      description={activating ? '有効にすると、開始条件を満たした友だちへの配信が始まります。' : '停止後は、このシナリオから新しい配信が始まらなくなります。'}
      footer={
        conflict ? (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <SheetButton onClick={onClose} disabled={busy}>やめる</SheetButton>
            <SheetButton onClick={() => onConfirm()} disabled={busy}>両方を有効にする</SheetButton>
            <SheetButton variant="primary" onClick={() => onConfirm({ alsoDeactivateId: conflict.id })} busy={busy}>
              既存を停止して切り替える
            </SheetButton>
          </div>
        ) : (
          <>
            <SheetButton onClick={onClose} disabled={busy}>やめる</SheetButton>
            <SheetButton variant="primary" onClick={() => onConfirm()} busy={busy}>
              {actionLabel}
            </SheetButton>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm text-gray-600">
        {scenario.lineAccountId === null && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            このシナリオは全アカウント共通です。変更はすべてのLINEアカウントに影響します。
          </p>
        )}
        {activating && (scenario.stepCount ?? 0) === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            ステップが0件のため、有効にしてもメッセージは配信されません。
          </p>
        )}
        {conflict && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
            「{conflict.name}」も友だち追加時に有効です。両方を有効にすると、新規友だちへ2つのシナリオが配信されます。
          </p>
        )}
        {error && <p className="text-red-600">{error}</p>}
      </div>
    </Sheet>
  )
}
