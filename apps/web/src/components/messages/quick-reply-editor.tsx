'use client'

// クイックリプライ (メッセージの下に並び、押すと消える選択肢ボタン) の編集欄。
// 1つずつ「表示する文字」と「押したときに何をするか」を決める。値は LINE の
// quickReply の形 (QuickReply) で受け渡しし、保存時に本文へ埋め込むのは呼び出し側。

import { QUICK_REPLY_LABEL_MAX, QUICK_REPLY_MAX_ITEMS, type QuickReply, type QuickReplyItem } from '@line-crm/shared'
import { useMessageActions } from '@/lib/use-message-actions'
import { QuickReplyChips } from '@/components/messages/talk-preview'

type Kind = 'message' | 'harness' | 'uri'
type Row = { label: string; kind: Kind; value: string }

function toRows(quickReply: QuickReply | undefined): Row[] {
  return (quickReply?.items ?? []).map(({ action }) => {
    if (action.type === 'message') return { label: action.label, kind: 'message', value: action.text }
    if (action.type === 'uri') return { label: action.label, kind: 'uri', value: action.uri }
    return { label: action.label, kind: 'harness', value: action.data }
  })
}

/**
 * 保存の直前に1回だけ整える。送る言葉が空なら表示する文字を送る言葉にし、
 * 表示する文字が空の行と、動き・リンクを選んでいない行は落とす。
 */
export function finalizeQuickReply(value: QuickReply | undefined): QuickReply | undefined {
  const items = (value?.items ?? []).flatMap((item): QuickReplyItem[] => {
    const label = item.action.label.trim()
    if (!label) return []
    const { action } = item
    if (action.type === 'message') return [{ type: 'action', action: { type: 'message', label, text: action.text.trim() || label } }]
    if (action.type === 'postback') return action.data ? [{ type: 'action', action: { type: 'postback', label, data: action.data, displayText: label } }] : []
    return /^https?:\/\//.test(action.uri) ? [{ type: 'action', action: { type: 'uri', label, uri: action.uri } }] : []
  })
  return items.length > 0 ? { items } : undefined
}

export default function QuickReplyEditor({
  value,
  onChange,
}: {
  value: QuickReply | undefined
  onChange: (next: QuickReply | undefined) => void
}) {
  const { actions, origin } = useMessageActions()
  const postbackActions = actions.filter((action) => action.kind === 'postback')
  const linkActions = actions.filter((action) => action.kind === 'link')
  const rows = toRows(value)
  const setRows = (next: Row[]) => onChange(toQuickReplyKeepingDrafts(next))
  const setRow = (index: number, patch: Partial<Row>) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const inputCls = 'h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <section>
      <h4 className="text-sm font-semibold text-gray-900">クイックリプライ（なくてもかまいません）</h4>
      <p className="mt-0.5 text-xs leading-5 text-gray-600">
        メッセージの下に並ぶ選択肢ボタンです。押すと消え、押した言葉がトークに残ります。最大{QUICK_REPLY_MAX_ITEMS}個、表示する文字は{QUICK_REPLY_LABEL_MAX}文字までです。
      </p>
      <ol className="mt-2 space-y-3">
        {rows.map((row, index) => (
          <li key={index} className="border-l-2 border-gray-300 pl-3">
            <div className="flex items-center gap-2">
              <input
                value={row.label}
                onChange={(e) => setRow(index, { label: e.target.value })}
                maxLength={QUICK_REPLY_LABEL_MAX}
                placeholder="表示する文字（例: 詳しく知りたい）"
                className={inputCls}
                aria-label={`${index + 1}個目の表示する文字`}
              />
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                className="min-h-[44px] shrink-0 rounded-lg px-2 text-sm text-red-700 hover:bg-red-50"
                aria-label={`${index + 1}個目の選択肢を消す`}
              >
                消す
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <select
                value={row.kind}
                onChange={(e) => setRow(index, { kind: e.target.value as Kind, value: '' })}
                className={inputCls}
                aria-label={`${index + 1}個目を押したときの動き`}
              >
                <option value="message">その言葉を送る</option>
                <option value="harness">ボタンの動きを使う</option>
                <option value="uri">リンクを開く</option>
              </select>
              {row.kind === 'message' && (
                <input value={row.value} onChange={(e) => setRow(index, { value: e.target.value })} maxLength={300} placeholder="送る言葉（空なら表示する文字と同じ）" className={inputCls} />
              )}
              {row.kind === 'harness' && (
                <select value={row.value} onChange={(e) => setRow(index, { value: e.target.value })} className={inputCls} aria-label="使うボタンの動き">
                  <option value="">選んでください</option>
                  {postbackActions.map((action) => <option key={action.id} value={action.postbackData ?? ''}>{action.name}</option>)}
                </select>
              )}
              {row.kind === 'uri' && (
                <div className="space-y-2">
                  <input value={row.value} onChange={(e) => setRow(index, { value: e.target.value })} inputMode="url" placeholder="https://" className={inputCls} />
                  {linkActions.length > 0 && (
                    <select value="" onChange={(e) => { if (e.target.value) setRow(index, { value: e.target.value }) }} className={inputCls} aria-label="締切つきリンクを使う">
                      <option value="">締切つきリンクを使う場合は選ぶ</option>
                      {linkActions.map((action) => <option key={action.id} value={`${origin}${action.linkPath}`}>{action.name}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {rows.length < QUICK_REPLY_MAX_ITEMS && (
        <button
          type="button"
          onClick={() => setRows([...rows, { label: '', kind: 'message', value: '' }])}
          className="mt-2 min-h-[44px] text-sm font-medium text-blue-700 hover:underline"
        >
          ＋ 選択肢を足す
        </button>
      )}
      {finalizeQuickReply(value) && (
        <div className="mt-2">
          <p className="text-xs text-gray-600">友だちの画面では、メッセージの下にこう並びます</p>
          <QuickReplyChips quickReply={finalizeQuickReply(value)} />
        </div>
      )}
    </section>
  )
}

// 編集中は、まだ文字を入れていない行も消さずに持っておく (保存の直前に finalizeQuickReply で整える)
function toQuickReplyKeepingDrafts(rows: Row[]): QuickReply | undefined {
  if (rows.length === 0) return undefined
  return {
    items: rows.map((row): QuickReplyItem => {
      if (row.kind === 'harness') return { type: 'action', action: { type: 'postback', label: row.label, data: row.value, displayText: row.label } }
      if (row.kind === 'uri') return { type: 'action', action: { type: 'uri', label: row.label, uri: row.value } }
      return { type: 'action', action: { type: 'message', label: row.label, text: row.value } }
    }),
  }
}
