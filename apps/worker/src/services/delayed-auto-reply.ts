import { getFriendById, getLineAccountById, jstNow } from '@line-crm/db';
import type { Message } from '@line-crm/line-sdk';
import { buildMessage, messageToLogPayload } from './step-delivery.js';

export interface DelayedAutoReplyPayload {
  deliveryId: string;
  friendId: string;
  lineAccountId: string | null;
  messageType: string;
  messageContent: string;
  deliverAt?: string;
}

const ROADMAP_INVITATION_TEXT = `{{name}}さん
解説速報を受け取っていただき、ありがとうございます。

現在Xでは公に募集していないのですが、

公式LINE登録者限定で、
『各種試験（LS入試・予備試験・司法試験）攻略ロードマップ作成会』
を1回無料で行っております。

現状の勉強に行き詰まりを感じていたり、
最短で効率的に合格したいという方向けに、
各試験を最短で攻略するための実践的なロードマップを作成します。

現状・到達点・課題の3点を押さえ、明確にすることで、効率的な学習をサポートします。

※有料の個別指導は現在人数を絞っておりまして、必要であればご提案しますが、私の方で不要と判断した場合は一旦ご自分でやっていただく形になります。

※希望される方は、「作成会希望」と送ってください。`;

export function buildRoadmapInvitationText(displayName: string | null | undefined): string {
  const firstLine = displayName?.trim() ? `${displayName.trim()}さん` : '';
  return ROADMAP_INVITATION_TEXT.replace('{{name}}さん', firstLine).replace(/^\n/, '');
}

export function resolveDelayedAutoReplyMessage(
  payload: Pick<DelayedAutoReplyPayload, 'messageType' | 'messageContent'>,
  displayName: string | null | undefined,
): { messageType: string; messageContent: string } {
  const isQueuedRoadmapCard = payload.messageType === 'flex'
    && payload.messageContent.includes('解説速報はもうご覧いただけましたか。')
    && payload.messageContent.includes('作成会の詳しい案内を見る')
    && payload.messageContent.includes('ロードマップ作成会について');

  if (!isQueuedRoadmapCard) {
    return {
      messageType: payload.messageType,
      messageContent: payload.messageContent,
    };
  }

  return {
    messageType: 'text',
    messageContent: buildRoadmapInvitationText(displayName),
  };
}

export const MAX_QUEUE_DELAY_SECONDS = 86_400;
export const DELIVERY_CONTROL_METADATA_KEY = '__lineHarnessDeliveryControl';

export interface DelayedAutoReplyControl {
  paused: boolean;
  pausedAt: string | null;
}

function parseFriendMetadata(metadata: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadata || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function getDelayedAutoReplyControl(
  metadata: string | null | undefined,
): DelayedAutoReplyControl {
  const root = parseFriendMetadata(metadata);
  const raw = root[DELIVERY_CONTROL_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { paused: false, pausedAt: null };
  }

  const control = raw as Record<string, unknown>;
  return {
    paused: control.delayedAutoRepliesPaused === true,
    pausedAt: typeof control.delayedAutoRepliesPausedAt === 'string'
      ? control.delayedAutoRepliesPausedAt
      : null,
  };
}

export function setDelayedAutoReplyPaused(
  metadata: string | null | undefined,
  paused: boolean,
  pausedAt: string,
): string {
  const root = parseFriendMetadata(metadata);
  if (paused) {
    root[DELIVERY_CONTROL_METADATA_KEY] = {
      delayedAutoRepliesPaused: true,
      delayedAutoRepliesPausedAt: pausedAt,
    };
  } else {
    delete root[DELIVERY_CONTROL_METADATA_KEY];
  }
  return JSON.stringify(root);
}

export function getDelayedAutoReplyWaitSeconds(
  payload: DelayedAutoReplyPayload,
  now: Date = new Date(),
): number {
  if (!payload.deliverAt) return 0;

  const deliverAtMs = Date.parse(payload.deliverAt);
  if (!Number.isFinite(deliverAtMs)) {
    throw new Error('Invalid delayed auto-reply deliverAt');
  }

  return Math.min(
    MAX_QUEUE_DELAY_SECONDS,
    Math.max(0, Math.ceil((deliverAtMs - now.getTime()) / 1000)),
  );
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function pushLineMessageWithRetryKey(
  fetcher: Fetcher,
  channelAccessToken: string,
  to: string,
  messages: Message[],
  retryKey: string,
): Promise<'sent' | 'already_sent'> {
  const response = await fetcher('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json',
      'X-Line-Retry-Key': retryKey,
    },
    body: JSON.stringify({ to, messages }),
  });

  if (response.ok) return 'sent';
  if (response.status === 409 && response.headers.has('x-line-accepted-request-id')) {
    return 'already_sent';
  }

  const detail = await response.text().catch(() => '');
  throw new Error(`LINE delayed push failed: ${response.status} ${detail}`);
}

export async function deliverDelayedAutoReply(
  db: D1Database,
  payload: DelayedAutoReplyPayload,
  defaultChannelAccessToken: string,
): Promise<'sent' | 'already_sent' | 'skipped'> {
  const existing = await db
    .prepare('SELECT id FROM messages_log WHERE id = ?')
    .bind(payload.deliveryId)
    .first<{ id: string }>();
  if (existing) return 'already_sent';

  const friend = await getFriendById(db, payload.friendId);
  if (!friend || !friend.is_following) return 'skipped';
  if (getDelayedAutoReplyControl(friend.metadata).paused) return 'skipped';

  const accountId = payload.lineAccountId ?? friend.line_account_id;
  let channelAccessToken = defaultChannelAccessToken;
  if (accountId) {
    const account = await getLineAccountById(db, accountId);
    if (!account) throw new Error(`LINE account not found: ${accountId}`);
    channelAccessToken = account.channel_access_token;
  }

  // 2026-09-01より前にQueueへ入った旧ロードマップFlexは本文のスナップショットを
  // 保持しているため、設定変更だけでは差し替わらない。旧カードだけを新しい
  // テキストへ変換し、同日の予約分にも現在の案内を適用する。
  const resolvedMessage = resolveDelayedAutoReplyMessage(payload, friend.display_name);
  const message = buildMessage(resolvedMessage.messageType, resolvedMessage.messageContent);
  const result = await pushLineMessageWithRetryKey(
    fetch,
    channelAccessToken,
    friend.line_user_id,
    [message],
    payload.deliveryId,
  );

  const logPayload = messageToLogPayload(message);
  await db
    .prepare(
      `INSERT OR IGNORE INTO messages_log
       (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id,
        delivery_type, source, line_account_id, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'push', 'auto_reply', ?, ?)`,
    )
    .bind(
      payload.deliveryId,
      friend.id,
      logPayload.messageType,
      logPayload.content,
      accountId ?? null,
      jstNow(),
    )
    .run();

  return result;
}
