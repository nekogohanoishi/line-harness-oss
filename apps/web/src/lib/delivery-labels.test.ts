import { describe, expect, test } from 'vitest'
import {
  formatDuration,
  formatSeconds,
  replyTimingLabel,
  scenarioStartText,
  stepConditionText,
  stepTimingLabel,
} from './delivery-labels'

const step = (over: Record<string, unknown> = {}) => ({
  delayMinutes: 0,
  offsetDays: null,
  offsetMinutes: null,
  deliveryTime: null,
  ...over,
})

describe('formatDuration / formatSeconds', () => {
  test('日・時間・分を0を省いてつなげる', () => {
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(30)).toBe('30分')
    expect(formatDuration(90)).toBe('1時間30分')
    expect(formatDuration(1440)).toBe('1日')
    expect(formatDuration(1440 + 120)).toBe('1日2時間')
  })

  test('秒は60秒未満だけ秒で表し、それ以上は分以上で表す', () => {
    expect(formatSeconds(45)).toBe('45秒')
    expect(formatSeconds(300)).toBe('5分')
    expect(formatSeconds(3605)).toBe('1時間5秒')
  })
})

describe('stepTimingLabel', () => {
  test('relative: 1通目は始まりのきっかけから、2通目以降は前の通から数える', () => {
    expect(stepTimingLabel(step(), 0, 'relative', 'friend_add')).toBe('友だち追加の直後')
    expect(stepTimingLabel(step({ delayMinutes: 60 }), 0, 'relative', 'friend_add')).toBe('友だち追加から1時間後')
    expect(stepTimingLabel(step(), 1, 'relative', 'friend_add')).toBe('1通目の直後')
    expect(stepTimingLabel(step({ delayMinutes: 1440 }), 2, 'relative', 'friend_add')).toBe('2通目から1日後')
  })

  test('deliveryMode が未設定なら relative として扱う', () => {
    expect(stepTimingLabel(step({ delayMinutes: 30 }), 1, undefined, 'manual')).toBe('1通目から30分後')
  })

  test('elapsed: 始まりからの経過時間で表す', () => {
    expect(stepTimingLabel(step({ offsetDays: 0, offsetMinutes: 0 }), 3, 'elapsed', 'tag_added')).toBe('タグが付いた直後')
    expect(stepTimingLabel(step({ offsetDays: 1, offsetMinutes: 30 }), 3, 'elapsed', 'friend_add')).toBe('友だち追加から1日30分後')
  })

  test('absolute_time: 何日後の何時かで表し、時刻がなければそう書く', () => {
    expect(stepTimingLabel(step({ offsetDays: 0, deliveryTime: '10:00' }), 0, 'absolute_time', 'friend_add')).toBe('友だち追加の当日 10:00')
    expect(stepTimingLabel(step({ offsetDays: 2, deliveryTime: '21:00' }), 1, 'absolute_time', 'manual')).toBe('開始の2日後 21:00')
    expect(stepTimingLabel(step({ offsetDays: 1 }), 1, 'absolute_time', 'friend_add')).toBe('友だち追加の1日後 時刻未設定')
  })
})

describe('scenarioStartText', () => {
  test('きっかけごとの文になる', () => {
    expect(scenarioStartText('friend_add')).toBe('友だち追加・ブロック解除のときに開始')
    expect(scenarioStartText('tag_added', '面談希望')).toBe('タグ「面談希望」が付いたときに開始')
    expect(scenarioStartText('tag_added', null)).toBe('タグ「タグ名未確認」が付いたときに開始')
    expect(scenarioStartText('manual')).toBe('手動で開始')
  })
})

describe('stepConditionText', () => {
  const tagName = (id: string) => (id === 'tag-1' ? '面談希望' : undefined)

  test('条件がなければ null', () => {
    expect(stepConditionText({ conditionType: null, conditionValue: null, nextStepOnFalse: null }, tagName)).toBeNull()
  })

  test('タグ条件はタグ名で表し、見つからなければその旨を書く', () => {
    expect(stepConditionText({ conditionType: 'tag_exists', conditionValue: 'tag-1', nextStepOnFalse: null }, tagName))
      .toBe('タグ「面談希望」が付いている人だけに送る')
    expect(stepConditionText({ conditionType: 'tag_not_exists', conditionValue: 'tag-x', nextStepOnFalse: null }, tagName))
      .toBe('タグ「タグ名未確認」が付いていない人だけに送る')
  })

  test('リンク条件は名前が分かればリンク名で表し、分からなければ「指定したリンク」と書く', () => {
    const linkName = (id: string) => (id === 'link-1' ? '解説速報ページ' : undefined)
    expect(stepConditionText({ conditionType: 'tracked_url_clicked', conditionValue: 'link-1', nextStepOnFalse: null }, tagName, linkName))
      .toBe('リンク「解説速報ページ」を開いた人だけに送る')
    expect(stepConditionText({ conditionType: 'tracked_url_not_clicked', conditionValue: 'link-x', nextStepOnFalse: null }, tagName))
      .toBe('指定したリンクをまだ開いていない人だけに送る')
  })

  test('友だち情報の条件はキーと値を引用し、合わない人の行き先も書く', () => {
    expect(stepConditionText({
      conditionType: 'metadata_equals',
      conditionValue: JSON.stringify({ key: '目標試験', value: '予備試験' }),
      nextStepOnFalse: 4,
    }, tagName)).toBe('友だち情報「目標試験」が「予備試験」の人だけに送る（合わない人は4通目へ進む）')
  })
})

describe('replyTimingLabel', () => {
  test('即時・秒数指定・時刻指定を区別する', () => {
    expect(replyTimingLabel({})).toBe('受け取ってすぐ')
    expect(replyTimingLabel({ delaySeconds: 300 })).toBe('受け取ってから5分後')
    expect(replyTimingLabel({ deliveryTimeJst: '20:00', sameDayCutoffTimeJst: '18:00' }))
      .toBe('18:00までに受け取ったら当日の20:00、それ以降は翌日の20:00')
  })
})
