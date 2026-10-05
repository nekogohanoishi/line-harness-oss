'use client'

import type { Area } from './canvas-editor'

type PageOption = { id: string; name: string }

type Props = {
  area: Area
  pages: PageOption[]
  onUpdate: (patch: Partial<Area>) => void
  onDelete: () => void
}

function defaultActionData(type: Area['actionType']): Record<string, unknown> {
  switch (type) {
    case 'uri':
      return { uri: '' }
    case 'message':
      return { text: '' }
    case 'postback':
      return { data: '', displayText: '' }
    case 'richmenuswitch':
      return { targetPageId: '' }
  }
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
      />
    </label>
  )
}

export function AreaProperties({ area, pages, onUpdate, onDelete }: Props) {
  const data = (area.actionData ?? {}) as Record<string, unknown>

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700">選択中エリア</h3>
        <button
          onClick={onDelete}
          className="text-xs text-red-600 hover:underline"
        >
          削除
        </button>
      </div>

      <details className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-600">位置とサイズを数値で調整</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumField label="左からの位置" value={area.boundsX} onChange={(v) => onUpdate({ boundsX: v })} />
          <NumField label="上からの位置" value={area.boundsY} onChange={(v) => onUpdate({ boundsY: v })} />
          <NumField
            label="幅"
            value={area.boundsWidth}
            onChange={(v) => onUpdate({ boundsWidth: v })}
          />
          <NumField
            label="高さ"
            value={area.boundsHeight}
            onChange={(v) => onUpdate({ boundsHeight: v })}
          />
        </div>
      </details>

      <label className="block">
        <span className="text-xs text-gray-500">押したときの動作</span>
        <select
          value={area.actionType}
          onChange={(e) => {
            const next = e.target.value as Area['actionType']
            onUpdate({ actionType: next, actionData: defaultActionData(next) })
          }}
          className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="uri">Webページを開く</option>
          <option value="message">メッセージを送信する</option>
          <option value="richmenuswitch">別のページへ切り替える</option>
          <option value="postback">画面表示なしで処理を実行する</option>
        </select>
      </label>

      {area.actionType === 'uri' && (
        <label className="block">
          <span className="text-xs text-gray-500">URL</span>
          <input
            type="url"
            value={(data.uri as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, uri: e.target.value } })}
            placeholder="https://..."
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            クリック数を計測する場合は、計測リンクを指定してください。
          </p>
        </label>
      )}

      {area.actionType === 'message' && (
        <label className="block">
          <span className="text-xs text-gray-500">送信テキスト</span>
          <input
            value={(data.text as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, text: e.target.value } })}
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
      )}

      {area.actionType === 'postback' && (
        <>
          <label className="block">
            <span className="text-xs text-gray-500">実行する処理のデータ</span>
            <input
              value={(data.data as string) ?? ''}
              onChange={(e) => onUpdate({ actionData: { ...data, data: e.target.value } })}
              className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">トーク画面に表示する文言（任意）</span>
            <input
              value={(data.displayText as string) ?? ''}
              onChange={(e) =>
                onUpdate({ actionData: { ...data, displayText: e.target.value } })
              }
              className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
        </>
      )}

      {area.actionType === 'richmenuswitch' && (
        <label className="block">
          <span className="text-xs text-gray-500">遷移先ページ</span>
          <select
            value={(data.targetPageId as string) ?? ''}
            onChange={(e) =>
              onUpdate({ actionData: { ...data, targetPageId: e.target.value } })
            }
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">選択...</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {pages.length < 2 && (
            <p className="mt-1 text-xs text-amber-600">
              タブ切替には複数ページが必要です。先にページを追加してください。
            </p>
          )}
        </label>
      )}
    </div>
  )
}
