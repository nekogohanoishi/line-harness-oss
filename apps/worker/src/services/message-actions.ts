import {
  addTagToFriend,
  removeTagFromFriend,
  enrollFriendInScenario,
  getFriendById,
  getTemplateById,
  jstNow,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { buildMessage, expandVariables, resolveMetadata } from './step-delivery.js';
import { fireEvent, logOutgoingMessage } from './event-bus.js';
import { enrollTagTriggeredScenarios } from './tag-scenarios.js';

/**
 * ボタンの動き (message_actions) — メッセージのボタンやクイックリプライを押した
 * 友だちに対して Harness が行う処理。ボタン側は postback data "lh:act:<id>" で指す。
 */

export const ACTION_POSTBACK_PREFIX = 'lh:act:';
export const DEFAULT_EXPIRED_REPLY = '受付は終了しました。';

export type MessageActionStep =
  | { type: 'add_tag'; tagId: string }
  | { type: 'remove_tag'; tagId: string }
  | { type: 'start_scenario'; scenarioId: string }
  | { type: 'set_metadata'; key: string; value: string }
  | { type: 'reply_text'; text: string }
  | { type: 'reply_template'; templateId: string };

export interface MessageActionRow {
  id: string;
  line_account_id: string | null;
  name: string;
  kind: 'postback' | 'link';
  steps: string;
  link_url: string | null;
  once_per_friend: number;
  repeat_reply: string | null;
  deadline_at: string | null;
  expired_reply: string | null;
  expired_url: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type ActionOutcome = 'done' | 'repeat' | 'expired' | 'ignored';

const MAX_STEPS = 10;
const ID_PATTERN = /^[\w-]{1,64}$/;

export function parseActionPostback(data: string): string | null {
  if (!data.startsWith(ACTION_POSTBACK_PREFIX)) return null;
  const id = data.slice(ACTION_POSTBACK_PREFIX.length).trim();
  return ID_PATTERN.test(id) ? id : null;
}

/** 締切 ('YYYY-MM-DDTHH:MM'、日本時間) を過ぎているか。締切なしは false。 */
export function isPastDeadline(deadlineAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!deadlineAt) return false;
  const at = Date.parse(`${deadlineAt.slice(0, 16)}:00+09:00`);
  return Number.isFinite(at) && now.getTime() >= at;
}

/** 保存前の検証。1つでも不正な手順があれば null。 */
export function sanitizeSteps(input: unknown): MessageActionStep[] | null {
  if (!Array.isArray(input) || input.length > MAX_STEPS) return null;
  const steps: MessageActionStep[] = [];
  for (const raw of input) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v : null);
    switch (s.type) {
      case 'add_tag':
      case 'remove_tag': {
        const tagId = str(s.tagId, 64);
        if (!tagId || !ID_PATTERN.test(tagId)) return null;
        steps.push({ type: s.type, tagId });
        break;
      }
      case 'start_scenario': {
        const scenarioId = str(s.scenarioId, 64);
        if (!scenarioId || !ID_PATTERN.test(scenarioId)) return null;
        steps.push({ type: 'start_scenario', scenarioId });
        break;
      }
      case 'set_metadata': {
        const key = str(s.key, 50);
        if (!key || typeof s.value !== 'string' || s.value.length > 500) return null;
        steps.push({ type: 'set_metadata', key: key.trim(), value: s.value });
        break;
      }
      case 'reply_text': {
        const text = str(s.text, 2000);
        if (!text) return null;
        steps.push({ type: 'reply_text', text });
        break;
      }
      case 'reply_template': {
        const templateId = str(s.templateId, 64);
        if (!templateId || !ID_PATTERN.test(templateId)) return null;
        steps.push({ type: 'reply_template', templateId });
        break;
      }
      default:
        return null;
    }
  }
  return steps;
}

function parseStoredSteps(raw: string): MessageActionStep[] {
  try {
    return sanitizeSteps(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

async function recordLog(db: D1Database, actionId: string, friendId: string | null, result: 'done' | 'repeat' | 'expired' | 'opened') {
  try {
    await db
      .prepare(`INSERT INTO message_action_logs (id, action_id, friend_id, result, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), actionId, friendId, result, jstNow())
      .run();
  } catch (err) {
    console.error('message_action_logs insert failed:', err);
  }
}

/** 返信をまとめて送る。reply token が使えなければ push に切り替える。 */
async function sendReplies(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string | undefined,
  friend: { id: string; line_user_id: string },
  messages: Message[],
  lineAccountId: string | null,
): Promise<void> {
  if (messages.length === 0) return;
  const batch = messages.slice(0, 5);
  let deliveryType: 'reply' | 'push' = 'push';
  if (replyToken) {
    try {
      await lineClient.replyMessage(replyToken, batch);
      deliveryType = 'reply';
    } catch {
      await lineClient.pushMessage(friend.line_user_id, batch);
    }
  } else {
    await lineClient.pushMessage(friend.line_user_id, batch);
  }
  for (const msg of batch) {
    await logOutgoingMessage(db, {
      friendId: friend.id,
      messageType: msg.type,
      content: msg.type === 'text' ? msg.text : JSON.stringify(msg.type === 'flex' ? msg.contents : msg),
      deliveryType,
      source: 'message_action',
      lineAccountId,
    });
  }
}

/**
 * postback "lh:act:<id>" を受けたときの処理。
 * 締切後 → 締切後の返信、1人1回の2回目以降 → 2回目以降の返信、それ以外 → 手順を順に実行して返信。
 */
export async function handleMessageActionPostback(params: {
  db: D1Database;
  lineAccessToken: string;
  replyToken?: string;
  friendId: string;
  actionId: string;
  lineAccountId: string | null;
  now?: Date;
}): Promise<ActionOutcome> {
  const { db, lineAccessToken, replyToken, friendId, actionId, lineAccountId } = params;
  const row = await db
    .prepare(`SELECT * FROM message_actions WHERE id = ? AND kind = 'postback' AND is_active = 1`)
    .bind(actionId)
    .first<MessageActionRow>();
  if (!row) return 'ignored';
  if (row.line_account_id && lineAccountId && row.line_account_id !== lineAccountId) return 'ignored';

  const friend = await getFriendById(db, friendId);
  if (!friend) return 'ignored';
  const lineClient = new LineClient(lineAccessToken);
  const textMessage = (text: string): Message => ({ type: 'text', text });

  if (isPastDeadline(row.deadline_at, params.now)) {
    await sendReplies(db, lineClient, replyToken, friend, [textMessage(row.expired_reply?.trim() || DEFAULT_EXPIRED_REPLY)], lineAccountId);
    await recordLog(db, row.id, friendId, 'expired');
    return 'expired';
  }

  if (row.once_per_friend) {
    const done = await db
      .prepare(`SELECT 1 AS hit FROM message_action_logs WHERE action_id = ? AND friend_id = ? AND result = 'done' LIMIT 1`)
      .bind(row.id, friendId)
      .first<{ hit: number }>();
    if (done) {
      if (row.repeat_reply?.trim()) {
        await sendReplies(db, lineClient, replyToken, friend, [textMessage(row.repeat_reply.trim())], lineAccountId);
      }
      await recordLog(db, row.id, friendId, 'repeat');
      return 'repeat';
    }
  }

  const resolvedMeta = await resolveMetadata(db, {
    user_id: (friend as unknown as Record<string, string | null>).user_id,
    metadata: (friend as unknown as Record<string, string | null>).metadata,
  });
  const expandFor = (content: string) =>
    expandVariables(content, { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1]);

  const replies: Message[] = [];
  for (const step of parseStoredSteps(row.steps)) {
    try {
      switch (step.type) {
        case 'add_tag':
          await addTagToFriend(db, friendId, step.tagId);
          await enrollTagTriggeredScenarios(db, friendId, step.tagId);
          await fireEvent(db, 'tag_change', { friendId, eventData: { tagId: step.tagId, action: 'add' } }, lineAccessToken, lineAccountId);
          break;
        case 'remove_tag':
          await removeTagFromFriend(db, friendId, step.tagId);
          await fireEvent(db, 'tag_change', { friendId, eventData: { tagId: step.tagId, action: 'remove' } }, lineAccessToken, lineAccountId);
          break;
        case 'start_scenario': {
          const running = await db
            .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ? AND status != 'completed'`)
            .bind(friendId, step.scenarioId)
            .first();
          if (!running) await enrollFriendInScenario(db, friendId, step.scenarioId);
          break;
        }
        case 'set_metadata': {
          const current = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friendId).first<{ metadata: string | null }>();
          let merged: Record<string, unknown> = {};
          try {
            merged = JSON.parse(current?.metadata || '{}') as Record<string, unknown>;
          } catch {
            merged = {};
          }
          merged[step.key] = step.value;
          await db.prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(merged), jstNow(), friendId).run();
          break;
        }
        case 'reply_text':
          replies.push(buildMessage('text', expandFor(step.text)));
          break;
        case 'reply_template': {
          const tpl = await getTemplateById(db, step.templateId);
          if (tpl) replies.push(buildMessage(tpl.message_type, expandFor(tpl.message_content)));
          break;
        }
      }
    } catch (err) {
      // 1つの手順が失敗しても、残りの手順と返信は続ける
      console.error(`message action ${row.id} step ${step.type} failed:`, err);
    }
  }

  await sendReplies(db, lineClient, replyToken, friend, replies, lineAccountId);
  await recordLog(db, row.id, friendId, 'done');
  return 'done';
}

/** 締切つきリンク (/go/<id>) の行き先。null なら受付終了の案内ページを出す。 */
export async function resolveLinkAction(
  db: D1Database,
  actionId: string,
  now: Date = new Date(),
): Promise<{ status: 'open'; url: string } | { status: 'expired'; url: string | null; message: string } | { status: 'missing' }> {
  const row = await db
    .prepare(`SELECT * FROM message_actions WHERE id = ? AND kind = 'link' AND is_active = 1`)
    .bind(actionId)
    .first<MessageActionRow>();
  if (!row || !row.link_url) return { status: 'missing' };
  if (isPastDeadline(row.deadline_at, now)) {
    await recordLog(db, row.id, null, 'expired');
    return { status: 'expired', url: row.expired_url || null, message: row.expired_reply?.trim() || DEFAULT_EXPIRED_REPLY };
  }
  await recordLog(db, row.id, null, 'opened');
  return { status: 'open', url: row.link_url };
}
