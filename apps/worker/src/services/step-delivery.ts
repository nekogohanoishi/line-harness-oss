import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getFriendScenariosDueForDelivery,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  claimFriendScenarioForDelivery,
  getFriendById,
  jstNow,
  computeNextDeliveryAt,
  resolveStepContent,
  addTagToFriend,
  type DeliveryMode,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { jitterDeliveryTime, addJitter, sleep } from './stealth.js';

// ===========================================================
// Phase 6c: Webinar countdown / cart countdown 用ヘルパ
// ===========================================================

export interface WebinarTemplateContext {
  // 直近の confirmed booking の slot.starts_at (UTC ISO8601, Z) と event 名
  bookingStartsAt?: string | null;
  bookingId?: string | null;
  workerUrl?: string | null;
  // 直近 active cart の closes_at (UTC ISO8601, Z)
  cartClosesAt?: string | null;
}

// 残り時間を「あと N 分」「あと N 時間 M 分」「あと N 日」表記にフォーマット。
// すでに過去 → "終了"。 1 分未満 → "もうすぐ".
export function formatRemainingJa(targetIso: string, now: Date = new Date()): string {
  const tMs = new Date(targetIso).getTime();
  if (!Number.isFinite(tMs)) return '';
  const diffMs = tMs - now.getTime();
  if (diffMs <= 0) return '終了';
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 1) return 'もうすぐ';
  if (totalMin < 60) return `あと${totalMin}分`;
  const totalHr = Math.floor(totalMin / 60);
  if (totalHr < 24) {
    const remMin = totalMin - totalHr * 60;
    return remMin === 0 ? `あと${totalHr}時間` : `あと${totalHr}時間${remMin}分`;
  }
  const days = Math.floor(totalHr / 24);
  return `あと${days}日`;
}

// UTC ISO8601 を JST clock の "YYYY-MM-DD HH:MM" に整形。
export function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const da = String(jst.getUTCDate()).padStart(2, '0');
  const h = String(jst.getUTCHours()).padStart(2, '0');
  const mi = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

// 直近の未開催 or 開催中の confirmed booking を探す。
// "未開催" = slot.starts_at が現在より未来、または starts_at が過去でも完視聴前。
// シンプルに「starts_at が最も近い未来の confirmed booking」を1つ返す。
// 同じ友だちが複数 webinar に予約していてもどれか1つで OK ([{{webinar_starts_in}} は
// 「次に来る webinar」を意味するという素直な定義])。
export async function findActiveBookingForFriend(
  db: D1Database,
  friendId: string,
  now: Date = new Date(),
): Promise<{ booking_id: string; event_id: string; starts_at: string; ends_at: string } | null> {
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT b.id AS booking_id, b.event_id, s.starts_at, s.ends_at
         FROM event_bookings b
         JOIN event_slots s ON s.id = b.slot_id
        WHERE b.friend_id = ?
          AND b.status = 'confirmed'
          AND s.deleted_at IS NULL
          AND s.ends_at > ?
        ORDER BY s.starts_at ASC
        LIMIT 1`,
    )
    .bind(friendId, nowIso)
    .first<{ booking_id: string; event_id: string; starts_at: string; ends_at: string }>();
  return row ?? null;
}

// 直近の "open" cart status を返す (purchased ではない closes_at 未来).
export async function findActiveCartStatusForFriend(
  db: D1Database,
  friendId: string,
  now: Date = new Date(),
): Promise<{ booking_id: string; event_id: string; closes_at: string } | null> {
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT booking_id, event_id, closes_at
         FROM event_cart_status
        WHERE friend_id = ?
          AND opened_at IS NOT NULL
          AND closes_at IS NOT NULL
          AND closes_at > ?
          AND purchased_at IS NULL
        ORDER BY closes_at ASC
        LIMIT 1`,
    )
    .bind(friendId, nowIso)
    .first<{ booking_id: string; event_id: string; closes_at: string }>();
  return row ?? null;
}

// Webinar/cart 関連の動的コンテキストを 1 回のクエリ群で組み立てる。
// 受け取った friend に対して、active な webinar booking / active cart を引き、
// expandVariables 用のテンプレ context を返す。
export async function buildWebinarTemplateContext(
  db: D1Database,
  friendId: string,
  workerUrl?: string,
  now: Date = new Date(),
): Promise<WebinarTemplateContext> {
  const ctx: WebinarTemplateContext = { workerUrl: workerUrl ?? null };
  try {
    const b = await findActiveBookingForFriend(db, friendId, now);
    if (b) {
      ctx.bookingId = b.booking_id;
      ctx.bookingStartsAt = b.starts_at;
    }
  } catch (e) {
    console.error('[step-delivery] findActiveBookingForFriend failed:', e);
  }
  try {
    const cart = await findActiveCartStatusForFriend(db, friendId, now);
    if (cart) ctx.cartClosesAt = cart.closes_at;
  } catch (e) {
    console.error('[step-delivery] findActiveCartStatusForFriend failed:', e);
  }
  return ctx;
}

/**
 * Replace template variables in message content.
 *
 * Supported variables:
 * - {{name}}                → friend's display name
 * - {{uid}}                 → friend's user UUID
 * - {{friend_id}}           → friend's internal ID
 * - {{auth_url:CHANNEL_ID}} → full /auth/line URL with uid for cross-account linking
 * - {{metadata.KEY}}       → friend's metadata value (from form responses etc.)
 *
 * Phase 6c (webinar countdown / cart countdown) は webinarCtx 経由で渡す:
 * - {{webinar_starts_in}}   → "あと3時間20分" 等の残り時間 (booking が無ければ空)
 * - {{webinar_starts_at}}   → "2026-05-16 20:00" (JST clock)
 * - {{webinar_url}}         → LIFF 視聴 URL `{workerUrl}/liff/webinar/{bookingId}`
 * - {{cart_closes_in}}      → "あと45分" 等
 * - {{cart_closes_at}}      → "2026-05-16 22:00"
 *
 * webinarCtx が省略された場合、対応プレースホルダは空文字に置換される (テンプレが
 * 壊れない方向の挙動 = 「webinar に紐付かない通常メッセージ」でも安全).
 */
export function expandVariables(
  content: string,
  friend: { id: string; display_name: string | null; user_id: string | null; ref_code?: string | null; metadata?: Record<string, unknown> | string | null },
  apiOrigin?: string,
  webinarCtx?: WebinarTemplateContext,
): string {
  let result = content;
  result = result.replace(/\{\{name\}\}/g, friend.display_name || '');
  result = result.replace(/\{\{uid\}\}/g, friend.user_id || '');
  result = result.replace(/\{\{friend_id\}\}/g, friend.id);
  result = result.replace(/\{\{ref\}\}/g, friend.ref_code || '');
  // Conditional block: {{#if_ref}}...{{/if_ref}} — only shown if ref_code exists
  if (friend.ref_code) {
    result = result.replace(/\{\{#if_ref\}\}([\s\S]*?)\{\{\/if_ref\}\}/g, '$1');
  } else {
    result = result.replace(/\{\{#if_ref\}\}[\s\S]*?\{\{\/if_ref\}\}/g, '');
  }
  // Metadata variables: {{metadata.KEY}} → value from friend's metadata
  const meta = friend.metadata
    ? (typeof friend.metadata === 'string' ? JSON.parse(friend.metadata) as Record<string, unknown> : friend.metadata)
    : {};
  // Conditional block: {{#if_metadata.KEY}}...{{/if_metadata.KEY}} — only shown if metadata key has a value
  // When inside JSON arrays, removes the element and fixes trailing/leading commas
  result = result.replace(/\{\{#if_metadata\.([^}]+)\}\}([\s\S]*?)\{\{\/if_metadata\.\1\}\}/g, (_match, key, inner) => {
    const val = meta[key];
    if (val == null || val === '') return '';
    return inner;
  });
  // Clean up broken JSON commas from removed conditional blocks (e.g. ",," or "[," or ",]")
  result = result.replace(/,\s*,/g, ',');
  result = result.replace(/\[\s*,/g, '[');
  result = result.replace(/,\s*\]/g, ']');
  result = result.replace(/\{\{metadata\.([^}]+)\}\}/g, (_match, key) => {
    const val = meta[key];
    if (val == null) return '';
    return Array.isArray(val) ? val.join(', ') : String(val);
  });
  if (apiOrigin) {
    result = result.replace(/\{\{auth_url:([^}]+)\}\}/g, (_match, channelId) => {
      const params = new URLSearchParams({ account: channelId, ref: 'cross-link' });
      if (friend.user_id) params.set('uid', friend.user_id);
      return `${apiOrigin}/auth/line?${params.toString()}`;
    });
  }
  // Phase 6c: webinar / cart 関連変数。webinarCtx が undefined のキーは空文字。
  // {{webinar_starts_in}}
  result = result.replace(/\{\{webinar_starts_in\}\}/g, () => {
    return webinarCtx?.bookingStartsAt ? formatRemainingJa(webinarCtx.bookingStartsAt) : '';
  });
  // {{webinar_starts_at}}
  result = result.replace(/\{\{webinar_starts_at\}\}/g, () => {
    return webinarCtx?.bookingStartsAt ? formatDateTimeJa(webinarCtx.bookingStartsAt) : '';
  });
  // {{webinar_url}}: workerUrl が無い場合は LIFF パスのみ返す (相対 URL)
  result = result.replace(/\{\{webinar_url\}\}/g, () => {
    if (!webinarCtx?.bookingId) return '';
    const path = `/liff/webinar/${encodeURIComponent(webinarCtx.bookingId)}`;
    return webinarCtx.workerUrl ? `${webinarCtx.workerUrl.replace(/\/$/, '')}${path}` : path;
  });
  // {{cart_closes_in}}
  result = result.replace(/\{\{cart_closes_in\}\}/g, () => {
    return webinarCtx?.cartClosesAt ? formatRemainingJa(webinarCtx.cartClosesAt) : '';
  });
  // {{cart_closes_at}}
  result = result.replace(/\{\{cart_closes_at\}\}/g, () => {
    return webinarCtx?.cartClosesAt ? formatDateTimeJa(webinarCtx.cartClosesAt) : '';
  });
  return result;
}

/**
 * Resolve metadata for a friend, merging across all UUID-linked records.
 * Falls back to the friend's own metadata if no user_id.
 */
export async function resolveMetadata(
  db: D1Database,
  friend: { user_id?: string | null; metadata?: string | null },
): Promise<Record<string, unknown>> {
  // If friend has a UUID, merge metadata from all linked records
  if (friend.user_id) {
    const { getMergedMetadataByUserId } = await import('@line-crm/db');
    return getMergedMetadataByUserId(db, friend.user_id);
  }
  // Fallback: parse own metadata
  if (friend.metadata) {
    try { return JSON.parse(friend.metadata); } catch { return {}; }
  }
  return {};
}

const MAX_SENDS_PER_CRON = 40; // CF Free plan: 50 subrequests limit (margin for other jobs)

export async function processStepDeliveries(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  const now = jstNow();
  const dueFriendScenarios = await getFriendScenariosDueForDelivery(db, now);

  let sendCount = 0;
  for (let i = 0; i < dueFriendScenarios.length; i++) {
    if (sendCount >= MAX_SENDS_PER_CRON) break;
    const fs = dueFriendScenarios[i];
    try {
      // Stealth: add small random delay between deliveries to avoid burst patterns
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }
      const sent = await processSingleDelivery(db, lineClient, fs, workerUrl);
      if (sent) sendCount++;
    } catch (err) {
      console.error(`Error processing friend_scenario ${fs.id}:`, err);
      // Continue with next one
    }
  }
}

async function processSingleDelivery(
  db: D1Database,
  lineClient: LineClient,
  fs: {
    id: string;
    friend_id: string;
    scenario_id: string;
    current_step_order: number;
    status: string;
    next_delivery_at: string | null;
    started_at: string;
  },
  workerUrl?: string,
): Promise<boolean> {
  // Optimistic lock: claim this delivery (prevents duplicate sends from parallel workers)
  const claimed = await claimFriendScenarioForDelivery(db, fs.id, fs.current_step_order);
  if (!claimed) return false;

  const friend = await getFriendById(db, fs.friend_id);
  if (!friend || !friend.is_following) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Fetch scenario row for delivery_mode (needed by computeNextDeliveryAt below)
  const scenarioRow = await db
    .prepare(`SELECT delivery_mode FROM scenarios WHERE id = ?`)
    .bind(fs.scenario_id)
    .first<{ delivery_mode: DeliveryMode }>();
  if (!scenarioRow) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Get all steps for this scenario
  const steps = await getScenarioSteps(db, fs.scenario_id);
  if (steps.length === 0) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // computeNextDeliveryAt は「JST clock-time を UTC として表現する Date」前提
  // (setHours/getDate が JST clock 通りに動くようにオフセット済みの Date)。
  // fs.started_at は "+09:00" 付き ISO で本物の UTC instant として parse されるため、
  // +9h ずらして JST clock-time 表現に揃える必要がある。
  const enrolledAtDate = new Date(new Date(fs.started_at).getTime() + 9 * 60 * 60_000);
  const nowJstDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryFor = (step: { delay_minutes: number; offset_days: number | null; offset_minutes: number | null; delivery_time: string | null }): Date =>
    computeNextDeliveryAt(
      { delivery_mode: scenarioRow.delivery_mode },
      step,
      { enrolledAt: enrolledAtDate, previousDeliveredAt: nowJstDate, now: nowJstDate },
    );

  // Steps are sorted by step_order but may not be contiguous (e.g., 1, 3, 5 after deletions).
  // Find the next step whose step_order > current_step_order.
  const currentStep = steps.find((s) => s.step_order > fs.current_step_order);

  if (!currentStep) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Check step condition before sending
  if (currentStep.condition_type) {
    const conditionMet = await evaluateCondition(db, fs.friend_id, currentStep);
    if (!conditionMet) {
      if (currentStep.next_step_on_false !== null && currentStep.next_step_on_false !== undefined) {
        const jumpStep = steps.find((s) => s.step_order === currentStep.next_step_on_false);
        if (jumpStep) {
          const jitteredDate = jitterDeliveryTime(nextDeliveryFor(jumpStep));
          await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
          return false;
        }
      }
      const nextIndex = steps.indexOf(currentStep) + 1;
      if (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        const jitteredDate = jitterDeliveryTime(nextDeliveryFor(nextStep));
        await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
      } else {
        await completeFriendScenario(db, fs.id);
      }
      return false;
    }
  }

  // Resolve template_id → templates table (参照型). template_id 未設定なら step 値そのまま。
  const resolved = await resolveStepContent(db, currentStep);

  // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}}, {{metadata.KEY}}, etc.)
  const resolvedMeta = await resolveMetadata(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
  const friendWithMeta = { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1];
  // Phase 6c: webinar / cart 動的変数の context を組み立てる。
  const webinarCtx = await buildWebinarTemplateContext(db, friend.id, workerUrl);
  const expandedContent = expandVariables(resolved.messageContent, friendWithMeta, workerUrl, webinarCtx);
  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let trackedType: string = resolved.messageType;
  let trackedContent = expandedContent;
  if (workerUrl) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, resolved.messageType, expandedContent, workerUrl);
    trackedType = tracked.messageType;
    trackedContent = tracked.content;
  }
  const message = buildMessage(trackedType, trackedContent);
  // Resolve the correct LINE client for this friend's account
  let deliveryClient = lineClient;
  const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
  if (friendAccountId) {
    const { getLineAccountById } = await import('@line-crm/db');
    const account = await getLineAccountById(db, friendAccountId);
    if (account) {
      const { LineClient: LC } = await import('@line-crm/line-sdk');
      deliveryClient = new LC(account.channel_access_token);
    }
  }
  await deliveryClient.pushMessage(friend.line_user_id, [message]);

  // Log what we actually pushed: variables expanded, URLs auto-tracked, AND
  // any cleanEmptyNodes() mutation or parse-failure text fallback applied by
  // buildMessage(). Use scenario_step_id to recover the original template.
  const logId = crypto.randomUUID();
  const logPayload = messageToLogPayload(message);
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, template_id_at_send, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'scenario', ?, ?)`,
    )
    .bind(logId, friend.id, logPayload.messageType, logPayload.content, currentStep.id, resolved.templateIdAtSend, jstNow())
    .run();

  // Determine next step (find the step after currentStep in the sorted list)
  const currentIndex = steps.indexOf(currentStep);
  const nextStep = currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;

  if (nextStep) {
    const jitteredDate = jitterDeliveryTime(nextDeliveryFor(nextStep));
    await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
  } else {
    // This was the last step
    await completeFriendScenario(db, fs.id);
  }

  // 到達タグ付与 (advance / complete の後 = 再送が起きてもタグ付与は影響しない順序)
  // 失敗してもログに残すだけで配信フローは止めない。
  if (currentStep.on_reach_tag_id) {
    try {
      await addTagToFriend(db, friend.id, currentStep.on_reach_tag_id);
    } catch (err) {
      console.error(`[scenario] tag attach failed step=${currentStep.id}:`, err);
    }
  }
  return true;
}

export const SUPPORTED_CONDITION_TYPES = [
  'tag_exists',
  'tag_not_exists',
  'metadata_equals',
  'metadata_not_equals',
  'tracked_url_clicked',
  'tracked_url_not_clicked',
  'incoming_text_contains',
  'incoming_text_not_contains',
] as const;

export type ConditionType = (typeof SUPPORTED_CONDITION_TYPES)[number];

export function isSupportedConditionType(value: unknown): value is ConditionType {
  return typeof value === 'string' && (SUPPORTED_CONDITION_TYPES as readonly string[]).includes(value);
}

async function hasFriendClickedTrackedUrl(
  db: D1Database,
  friendId: string,
  conditionValue: string,
): Promise<boolean> {
  const needle = conditionValue.trim();
  if (!needle) return false;

  const row = await db
    .prepare(
      `SELECT 1
         FROM link_clicks lc
         INNER JOIN tracked_links tl ON tl.id = lc.tracked_link_id
        WHERE lc.friend_id = ?
          AND (
            tl.id = ?
            OR tl.original_url = ?
            OR instr(tl.original_url, ?) > 0
            OR instr(COALESCE(tl.name, ''), ?) > 0
          )
        LIMIT 1`,
    )
    .bind(friendId, needle, needle, needle, needle)
    .first();

  return !!row;
}

async function hasFriendSentTextContaining(
  db: D1Database,
  friendId: string,
  conditionValue: string,
): Promise<boolean> {
  const needle = conditionValue.trim();
  if (!needle) return false;

  const row = await db
    .prepare(
      `SELECT 1
         FROM messages_log
        WHERE friend_id = ?
          AND direction = 'incoming'
          AND message_type = 'text'
          AND instr(content, ?) > 0
        LIMIT 1`,
    )
    .bind(friendId, needle)
    .first();

  return !!row;
}

export async function evaluateCondition(
  db: D1Database,
  friendId: string,
  step: { condition_type: string | null; condition_value: string | null },
): Promise<boolean> {
  if (!step.condition_type) return true;

  if (!isSupportedConditionType(step.condition_type)) {
    console.error(
      `[scenario] unknown condition_type "${step.condition_type}" for friend=${friendId} - skipping step. ` +
        `Supported types: ${SUPPORTED_CONDITION_TYPES.join(', ')}`,
    );
    return false;
  }

  if (!step.condition_value) {
    console.error(
      `[scenario] condition_type=${step.condition_type} is set but condition_value is empty for friend=${friendId} - skipping step`,
    );
    return false;
  }

  switch (step.condition_type) {
    case 'tag_exists': {
      const tag = await db
        .prepare('SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
        .bind(friendId, step.condition_value)
        .first();
      return !!tag;
    }
    case 'tag_not_exists': {
      const tag = await db
        .prepare('SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
        .bind(friendId, step.condition_value)
        .first();
      return !tag;
    }
    case 'tracked_url_clicked': {
      return hasFriendClickedTrackedUrl(db, friendId, step.condition_value);
    }
    case 'tracked_url_not_clicked': {
      const clicked = await hasFriendClickedTrackedUrl(db, friendId, step.condition_value);
      return !clicked;
    }
    case 'incoming_text_contains': {
      return hasFriendSentTextContaining(db, friendId, step.condition_value);
    }
    case 'incoming_text_not_contains': {
      const sent = await hasFriendSentTextContaining(db, friendId, step.condition_value);
      return !sent;
    }
    case 'metadata_equals':
    case 'metadata_not_equals': {
      let raw: unknown;
      try {
        raw = JSON.parse(step.condition_value);
      } catch {
        console.error(
          `[scenario] malformed condition_value JSON for friend=${friendId} type=${step.condition_type} - skipping step`,
        );
        return false;
      }
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        typeof (raw as { key?: unknown }).key !== 'string' ||
        !('value' in (raw as Record<string, unknown>))
      ) {
        console.error(
          `[scenario] condition_value missing key/value for friend=${friendId} type=${step.condition_type} - skipping step`,
        );
        return false;
      }
      const parsed = raw as { key: string; value: unknown };
      const friend = await db
        .prepare('SELECT metadata FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ metadata: string }>();
      let metadata: Record<string, unknown> = {};
      try {
        metadata = JSON.parse(friend?.metadata || '{}') as Record<string, unknown>;
      } catch {
        metadata = {};
      }
      const actual = metadata[parsed.key];
      return step.condition_type === 'metadata_equals'
        ? actual === parsed.value
        : actual !== parsed.value;
    }
  }
}


/** Remove empty text nodes and boxes with empty text from Flex JSON */
function cleanEmptyNodes(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const node = obj as Record<string, unknown>;
  for (const key of ['header', 'body', 'footer']) {
    if (node[key]) cleanEmptyNodes(node[key]);
  }
  if (Array.isArray(node.contents)) {
    // First clean children recursively
    for (const c of node.contents as unknown[]) cleanEmptyNodes(c);
    // Then filter out empty nodes
    node.contents = (node.contents as unknown[]).filter((c) => {
      if (!c || typeof c !== 'object') return true;
      const child = c as Record<string, unknown>;
      // Remove empty text nodes
      if (child.type === 'text') {
        const text = child.text;
        return typeof text === 'string' && text.trim().length > 0;
      }
      // Remove box nodes where any text child is empty (metadata rows with no value)
      if (child.type === 'box' && Array.isArray(child.contents)) {
        const texts = (child.contents as Array<Record<string, unknown>>).filter(t => t.type === 'text');
        if (texts.length >= 2) {
          // horizontal box with label + value — remove if value is empty
          const hasEmptyText = texts.some(t => typeof t.text === 'string' && t.text.trim() === '');
          if (hasEmptyText) return false;
        }
      }
      return true;
    });
  }
}

/**
 * Derive (messageType, content) from a built `Message` object so that what
 * lands in messages_log mirrors what was actually pushed to LINE — including
 * cleanEmptyNodes() mutations and any parse-failure text fallback inside
 * buildMessage(). Use this whenever you log a message you just pushed.
 */
export function messageToLogPayload(message: Message): { messageType: string; content: string } {
  if (message.type === 'text') return { messageType: 'text', content: message.text };
  if (message.type === 'flex') return { messageType: 'flex', content: JSON.stringify(message.contents) };
  if (message.type === 'image') {
    return {
      messageType: 'image',
      content: JSON.stringify({
        originalContentUrl: message.originalContentUrl,
        previewImageUrl: message.previewImageUrl,
      }),
    };
  }
  return { messageType: message.type, content: JSON.stringify(message) };
}

export function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }

  if (messageType === 'image') {
    // messageContent is expected to be JSON: { originalContentUrl, previewImageUrl }
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      // Fallback: treat as text if parsing fails
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      // Remove empty text nodes (from {{#if_ref}} conditional blocks)
      cleanEmptyNodes(contents);
      // Extract first text element for altText (shown in notifications)
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  // Fallback
  return { type: 'text', text: messageContent };
}
