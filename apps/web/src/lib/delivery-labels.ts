// 配信設定を「友だちにいつ・誰に届くか」の日本語に直す表示用ヘルパー。
// 「現在有効な配信」など、メッセージを時系列で見せる画面で共通に使う。

import type { Scenario, ScenarioStep } from '@line-crm/shared'

/** 分数を「1時間30分」「2日」のような長さの表現に直す。0 以下は空文字。 */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  return `${days ? `${days}日` : ''}${hours ? `${hours}時間` : ''}${rest ? `${rest}分` : ''}`
}

/** 秒数を「30秒」「5分」「1時間」のような長さの表現に直す。 */
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${formatDuration(minutes)}${rest ? `${rest}秒` : ''}`
}

type StartPhrases = {
  now: string
  after: (duration: string) => string
  onDay: (days: number, time: string) => string
}

const startPhrases: Record<Scenario['triggerType'], StartPhrases> = {
  friend_add: {
    now: '友だち追加の直後',
    after: (d) => `友だち追加から${d}後`,
    onDay: (n, t) => (n === 0 ? `友だち追加の当日 ${t}` : `友だち追加の${n}日後 ${t}`),
  },
  tag_added: {
    now: 'タグが付いた直後',
    after: (d) => `タグが付いてから${d}後`,
    onDay: (n, t) => (n === 0 ? `タグが付いた当日 ${t}` : `タグが付いた${n}日後 ${t}`),
  },
  manual: {
    now: '開始の直後',
    after: (d) => `開始から${d}後`,
    onDay: (n, t) => (n === 0 ? `開始の当日 ${t}` : `開始の${n}日後 ${t}`),
  },
}

/**
 * シナリオの各ステップが「いつ届くか」を、始まりのきっかけを主語にした文で返す。
 * index は 0 始まりの並び順。relative モードは前の通からの経過で表す。
 */
export function stepTimingLabel(
  step: Pick<ScenarioStep, 'delayMinutes' | 'offsetDays' | 'offsetMinutes' | 'deliveryTime'>,
  index: number,
  mode: Scenario['deliveryMode'] | undefined,
  triggerType: Scenario['triggerType'],
): string {
  const start = startPhrases[triggerType] ?? startPhrases.manual
  if (mode === 'absolute_time') {
    return start.onDay(step.offsetDays ?? 0, step.deliveryTime || '時刻未設定')
  }
  if (mode === 'elapsed') {
    const total = (step.offsetDays ?? 0) * 1440 + (step.offsetMinutes ?? 0)
    return total > 0 ? start.after(formatDuration(total)) : start.now
  }
  const delay = step.delayMinutes ?? 0
  if (index === 0) return delay > 0 ? start.after(formatDuration(delay)) : start.now
  return delay > 0 ? `${index}通目から${formatDuration(delay)}後` : `${index}通目の直後`
}

/** シナリオの始まり方を「〜のときに開始」の文で返す。 */
export function scenarioStartText(triggerType: Scenario['triggerType'], tagName?: string | null): string {
  if (triggerType === 'friend_add') return '友だち追加・ブロック解除のときに開始'
  if (triggerType === 'tag_added') return `タグ「${tagName || 'タグ名未確認'}」が付いたときに開始`
  return '手動で開始'
}

/**
 * ステップの配信条件を「誰に送るか」の文で返す。条件なしは null。
 * tagName は タグID → タグ名 の引き当て (見つからなければ undefined)。
 */
export function stepConditionText(
  step: Pick<ScenarioStep, 'conditionType' | 'conditionValue' | 'nextStepOnFalse'>,
  tagName: (id: string) => string | undefined,
): string | null {
  if (!step.conditionType) return null
  const value = step.conditionValue ?? ''
  const tag = () => `タグ「${tagName(value) ?? 'タグ名未確認'}」`
  const metadata = () => {
    try {
      const parsed = JSON.parse(value) as { key?: unknown; value?: unknown }
      return { key: String(parsed.key ?? ''), value: String(parsed.value ?? '') }
    } catch {
      return { key: '', value }
    }
  }
  let text: string
  switch (step.conditionType) {
    case 'tag_exists': text = `${tag()}が付いている人だけに送る`; break
    case 'tag_not_exists': text = `${tag()}が付いていない人だけに送る`; break
    case 'tracked_url_clicked': text = '指定したリンクを開いた人だけに送る'; break
    case 'tracked_url_not_clicked': text = '指定したリンクをまだ開いていない人だけに送る'; break
    case 'incoming_text_contains': text = `「${value}」を含むメッセージを送ってきた人だけに送る`; break
    case 'incoming_text_not_contains': text = `「${value}」を含むメッセージを送ってきていない人だけに送る`; break
    case 'metadata_equals': { const m = metadata(); text = `友だち情報「${m.key}」が「${m.value}」の人だけに送る`; break }
    case 'metadata_not_equals': { const m = metadata(); text = `友だち情報「${m.key}」が「${m.value}」ではない人だけに送る`; break }
    default: text = '条件に合う人だけに送る'
  }
  return step.nextStepOnFalse ? `${text}（合わない人は${step.nextStepOnFalse}通目へ進む）` : text
}

/** 自動返信の1通ごとの「いつ届くか」。delaySeconds はメッセージを受け取った時点から数える。 */
export function replyTimingLabel(item: { delaySeconds?: number; deliveryTimeJst?: string; sameDayCutoffTimeJst?: string }): string {
  if (item.deliveryTimeJst) {
    const cutoff = item.sameDayCutoffTimeJst
    return cutoff
      ? `${cutoff}までに受け取ったら当日の${item.deliveryTimeJst}、それ以降は翌日の${item.deliveryTimeJst}`
      : `受け取った日の${item.deliveryTimeJst}`
  }
  return item.delaySeconds && item.delaySeconds > 0 ? `受け取ってから${formatSeconds(item.delaySeconds)}後` : '受け取ってすぐ'
}
