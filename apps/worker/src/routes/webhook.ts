import { Hono } from 'hono';
import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { Message, WebhookRequestBody, WebhookEvent, TextEventMessage } from '@line-crm/line-sdk';
import { createStickerMessageContent } from '@line-crm/shared';
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserId,
  getScenarios,
  enrollFriendInScenario,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  upsertChatOnMessage,
  getLineAccounts,
  jstNow,
  computeNextDeliveryAt,
  resolveStepContent,
  addTagToFriend,
  getEntryRouteByRefCode,
  getMessageTemplateById,
  createFormSubmission,
  getFormById,
  getScenarioById,
} from '@line-crm/db';
import type { EntryRoute, Friend } from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import {
  REGISTRATION_SURVEY_QUESTIONS,
  buildInlineSurveyAnswerLogText,
  buildSurveyAnswerConfirmationText,
  buildSurveyAnswerLogText,
  buildSurveyAnswerSummaryText,
  buildSurveyQuestionMessageFromQuestions,
  normalizeSurveyQuestions,
  parseInlineSurveyPostbackData,
  parseSurveyPostbackData,
} from '../services/intro-message.js';
import {
  buildMessage,
  buildWebinarTemplateContext,
  expandVariables,
  messageToLogPayload,
  resolveMetadata,
} from '../services/step-delivery.js';
import { applySurveyAnswerTags } from '../services/survey-answer-tags.js';
import type { Env } from '../index.js';

const webhook = new Hono<Env>();

// LINE webhook bodies are small (events array). Cap defends against unauthenticated
// large-payload DoS before signature verification (#104). 1 MiB leaves room for
// bursty batched deliveries (~100 events × ~5 KB) while still well below the
// 128 MB Cloudflare Workers memory ceiling.
const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024; // 1 MiB

type InlineSurveyPayload = NonNullable<ReturnType<typeof parseInlineSurveyPostbackData>>;

function parseFriendMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function logIncomingPostback(
  db: D1Database,
  friendId: string,
  content: string,
  lineAccountId: string | null,
  createdAt: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'postback', ?, ?)`,
      )
      .bind(crypto.randomUUID(), friendId, content, lineAccountId ?? null, createdAt)
      .run();
  } catch (err) {
    console.error('Failed to log incoming postback', err);
  }
}

async function handleInlineSurveyPostback(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  friend: Friend,
  payload: InlineSurveyPayload,
  lineAccountId: string | null,
): Promise<void> {
  const now = jstNow();
  await logIncomingPostback(
    db,
    friend.id,
    buildInlineSurveyAnswerLogText(payload),
    lineAccountId,
    now,
  );
  const metadata = {
    ...parseFriendMetadata(friend.metadata),
    initial_survey_answer: payload.answer,
    initial_survey_answer_label: payload.answerLabel,
    initial_survey_form_id: payload.formId,
    initial_survey_ref: payload.ref,
    initial_survey_answered_at: now,
  };

  await db
    .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(metadata), now, friend.id)
    .run();

  if (payload.formId) {
    const form = await getFormById(db, payload.formId);
    if (form?.is_active) {
      await createFormSubmission(db, {
        formId: payload.formId,
        friendId: friend.id,
        data: JSON.stringify({
          answer: payload.answer,
          answer_label: payload.answerLabel,
          source: 'line_inline_survey',
          ref: payload.ref,
        }),
      });

      if (form.on_submit_tag_id) {
        await addTagToFriend(db, friend.id, form.on_submit_tag_id);
      }
      if (form.on_submit_scenario_id) {
        await enrollFriendInScenario(db, friend.id, form.on_submit_scenario_id);
      }
    }
  }

  const responseText = `${buildSurveyAnswerConfirmationText(payload.answerLabel)}\n\n回答ありがとうございます。`;
  await lineClient.replyMessage(replyToken, [{ type: 'text', text: responseText }]);
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'reply', 'survey', ?, ?)`,
    )
    .bind(crypto.randomUUID(), friend.id, responseText, lineAccountId ?? null, now)
    .run();
}

async function handleSurveyPostback(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  friend: Friend,
  payload: NonNullable<ReturnType<typeof parseSurveyPostbackData>>,
  lineAccountId: string | null,
  workerUrl?: string,
): Promise<void> {
  const now = jstNow();
  const form = await getFormById(db, payload.formId);
  const questions = normalizeSurveyQuestions(form?.fields ?? REGISTRATION_SURVEY_QUESTIONS);
  const question = questions[payload.questionIndex];
  if (!question || !question.options.includes(payload.answer)) {
    await logIncomingPostback(
      db,
      friend.id,
      question
        ? buildSurveyAnswerLogText(question, payload.answer)
        : `アンケート回答\n回答を確認できませんでした：${payload.answer}`,
      lineAccountId,
      now,
    );
    const responseText = '回答を確認できませんでした。もう一度アンケートのボタンから選んでください。';
    await lineClient.replyMessage(replyToken, [{ type: 'text', text: responseText }]);
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'reply', 'survey', ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, responseText, lineAccountId ?? null, now)
      .run();
    return;
  }
  await logIncomingPostback(
    db,
    friend.id,
    buildSurveyAnswerLogText(question, payload.answer),
    lineAccountId,
    now,
  );
  const existingMetadata = parseFriendMetadata(friend.metadata);
  const existingSurveyAnswers =
    existingMetadata.survey_answers &&
    typeof existingMetadata.survey_answers === 'object' &&
    !Array.isArray(existingMetadata.survey_answers)
      ? existingMetadata.survey_answers as Record<string, unknown>
      : {};
  const existingAnswersForForm =
    existingSurveyAnswers[payload.formId] &&
    typeof existingSurveyAnswers[payload.formId] === 'object' &&
    !Array.isArray(existingSurveyAnswers[payload.formId])
      ? existingSurveyAnswers[payload.formId] as Record<string, unknown>
      : {};
  const answers = {
    ...existingAnswersForForm,
    [question.name]: payload.answer,
  };
  const isRegistrationSurvey =
    form?.name === '登録時アンケート' ||
    existingMetadata.initial_survey_form_id === payload.formId;
  const isLastQuestion = payload.questionIndex === questions.length - 1;
  const metadata = {
    ...existingMetadata,
    ...answers,
    survey_answers: {
      ...existingSurveyAnswers,
      [payload.formId]: answers,
    },
    last_survey_form_id: payload.formId,
    last_survey_answered_at: isLastQuestion ? now : existingMetadata.last_survey_answered_at,
    ...(isRegistrationSurvey
      ? {
          registration_survey_answers: answers,
          initial_survey_form_id: payload.formId,
          initial_survey_answered_at: isLastQuestion ? now : existingMetadata.initial_survey_answered_at,
          initial_survey_pending_at: existingMetadata.initial_survey_pending_at ?? now,
        }
      : {}),
  };

  await db
    .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(metadata), now, friend.id)
    .run();

  try {
    await applySurveyAnswerTags(db, friend.id, answers, questions);
  } catch (err) {
    console.error('Failed to apply survey answer tags', err);
  }

  const nextQuestionIndex = payload.questionIndex + 1;
  const confirmationText = buildSurveyAnswerConfirmationText(payload.answer, question);
  if (nextQuestionIndex < questions.length) {
    const nextMessage = buildSurveyQuestionMessageFromQuestions(
      payload.formId,
      nextQuestionIndex,
      questions,
    );
    await lineClient.replyMessage(replyToken, [
      { type: 'text', text: confirmationText },
      nextMessage as any,
    ]);
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'reply', 'survey', ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, confirmationText, lineAccountId ?? null, now)
      .run();
    const logPayload = messageToLogPayload(nextMessage as any);
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', 'survey', ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, logPayload.messageType, logPayload.content, lineAccountId ?? null, now)
      .run();
    return;
  }

  let scenarioReplies: Array<{
    message: Message;
    stepId: string;
    templateIdAtSend: string | null;
  }> = [];
  if (form?.is_active) {
    await createFormSubmission(db, {
      formId: payload.formId,
      friendId: friend.id,
      data: JSON.stringify(answers),
    });
    if (form.on_submit_tag_id) {
      await addTagToFriend(db, friend.id, form.on_submit_tag_id);
    }
    if (form.on_submit_scenario_id) {
      const friendWithUpdatedMetadata = {
        ...friend,
        metadata: JSON.stringify(metadata),
      };
      scenarioReplies = await buildImmediateScenarioReplyMessages(
        db,
        friendWithUpdatedMetadata,
        form.on_submit_scenario_id,
        workerUrl,
      );
    }
  }

  const responseText =
    form?.on_submit_message_content?.trim() ||
    'ご回答ありがとうございました！\nいただいた内容をもとに、お役立ち情報をお届けします。';
  const answerSummaryText = `${confirmationText}\n\n${buildSurveyAnswerSummaryText(answers, questions)}`;
  const scenarioRepliesToSend = scenarioReplies.slice(0, Math.max(0, 5 - 2));
  await lineClient.replyMessage(replyToken, [
    { type: 'text', text: answerSummaryText },
    { type: 'text', text: responseText },
    ...scenarioRepliesToSend.map(({ message }) => message),
  ]);
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'reply', 'survey', ?, ?)`,
    )
    .bind(crypto.randomUUID(), friend.id, answerSummaryText, lineAccountId ?? null, now)
    .run();
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'reply', 'survey', ?, ?)`,
    )
    .bind(crypto.randomUUID(), friend.id, responseText, lineAccountId ?? null, now)
    .run();
  for (const scenarioReply of scenarioRepliesToSend) {
    const logPayload = messageToLogPayload(scenarioReply.message);
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, template_id_at_send, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'reply', 'scenario', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        friend.id,
        logPayload.messageType,
        logPayload.content,
        scenarioReply.stepId,
        lineAccountId ?? null,
        scenarioReply.templateIdAtSend,
        now,
      )
      .run();
  }
}

async function buildImmediateScenarioReplyMessages(
  db: D1Database,
  friend: Friend,
  scenarioId: string,
  workerUrl?: string,
): Promise<Array<{ message: Message; stepId: string; templateIdAtSend: string | null }>> {
  const scenario = await getScenarioById(db, scenarioId);
  if (!scenario?.is_active) return [];

  const firstStep = scenario.steps[0] ?? null;
  if (!firstStep) return [];

  const enrolledAtJst = new Date(Date.now() + 9 * 60 * 60_000);
  const firstScheduledAt = computeNextDeliveryAt(
    { delivery_mode: scenario.delivery_mode ?? 'relative' },
    firstStep,
    { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
  );
  if (firstScheduledAt.getTime() > enrolledAtJst.getTime()) {
    await enrollFriendInScenario(db, friend.id, scenarioId);
    return [];
  }

  const enrollment = await enrollFriendInScenario(db, friend.id, scenarioId);
  if (!enrollment) return [];

  const resolved = await resolveStepContent(db, firstStep);
  const resolvedMeta = await resolveMetadata(db, {
    user_id: (friend as unknown as Record<string, string | null>).user_id,
    metadata: (friend as unknown as Record<string, string | null>).metadata,
  });
  const webinarCtx = await buildWebinarTemplateContext(db, friend.id, workerUrl);
  const expandedContent = expandVariables(
    resolved.messageContent,
    { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1],
    workerUrl,
    webinarCtx,
  );

  let messageType = resolved.messageType;
  let messageContent = expandedContent;
  if (workerUrl) {
    const { autoTrackContent } = await import('../services/auto-track.js');
    const tracked = await autoTrackContent(db, resolved.messageType, expandedContent, workerUrl);
    messageType = tracked.messageType;
    messageContent = tracked.content;
  }

  const message = buildMessage(messageType, messageContent);
  const nextStep = scenario.steps[1] ?? null;
  if (nextStep) {
    const nextDeliveryAt = computeNextDeliveryAt(
      { delivery_mode: scenario.delivery_mode ?? 'relative' },
      nextStep,
      { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
    );
    await advanceFriendScenario(
      db,
      enrollment.id,
      firstStep.step_order,
      nextDeliveryAt.toISOString().slice(0, -1) + '+09:00',
    );
  } else {
    await completeFriendScenario(db, enrollment.id);
  }

  if (firstStep.on_reach_tag_id) {
    await addTagToFriend(db, friend.id, firstStep.on_reach_tag_id);
  }

  return [{ message, stepId: firstStep.id, templateIdAtSend: resolved.templateIdAtSend }];
}

webhook.post('/webhook', async (c) => {
  // Pre-read size guard: reject before reading the body if Content-Length is oversized.
  const contentLengthHeader = c.req.header('Content-Length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_SIZE) {
      return c.json({ status: 'too_large' }, 413);
    }
  }

  const rawBody = await c.req.text();

  // Post-read size guard for the case where Content-Length was absent or untrustworthy.
  // Use UTF-8 byte count: `rawBody.length` counts UTF-16 code units, so multibyte
  // payloads (Japanese/emoji) would otherwise bypass the cap.
  const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
  if (rawBodyByteLength > MAX_WEBHOOK_BODY_SIZE) {
    return c.json({ status: 'too_large' }, 413);
  }

  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  // Cheap pre-reject for unsigned / malformed-signature requests. LINE signatures
  // are HMAC-SHA256 + base64 = 44 chars. This avoids D1 lookups and HMAC compute
  // for junk traffic on a public endpoint.
  const LINE_SIGNATURE_LENGTH = 44;
  if (signature.length !== LINE_SIGNATURE_LENGTH) {
    console.error('Missing or malformed LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  // Verify signature BEFORE JSON.parse so attacker-controlled bodies never reach the parser.
  // Fast path: try env default secret first so malformed/unauthenticated traffic
  //   fails fast without a D1 lookup. The main account is typically also registered
  //   in line_accounts; on env match we still look it up so matchedAccountId binds
  //   correctly for downstream account-scoped filters.
  // Slow path: iterate DB-registered accounts for genuinely multi-account installs.
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;
  let valid = false;

  const envSecret = c.env.LINE_CHANNEL_SECRET;
  if (envSecret) {
    valid = await verifySignature(envSecret, rawBody, signature);
    if (valid) {
      const accounts = await getLineAccounts(db);
      const main = accounts.find(
        (a) => a.is_active && a.channel_secret === envSecret,
      );
      if (main) {
        channelAccessToken = main.channel_access_token;
        matchedAccountId = main.id;
      }
    }
  }

  if (!valid) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      if (envSecret && account.channel_secret === envSecret) continue; // already tried via fast path
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        valid = true;
        break;
      }
    }
  }

  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin, c.env.LIFF_URL);
      } catch (err) {
        console.error('Error handling webhook event:', err);
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
): Promise<void> {
  if (event.type === 'follow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    console.log(`[follow] userId=${userId} lineAccountId=${lineAccountId}`);

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      console.error('Failed to get profile for', userId, err);
    }

    console.log(`[follow] profile=${profile?.displayName ?? 'null'}`);

    const friendBeforeFollow = await getFriendByLineUserId(db, userId);
    const isRepeatFollow = friendBeforeFollow?.is_following === 0;

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });

    console.log(`[follow] friend.id=${friend.id} friend.line_account_id=${(friend as any).line_account_id}`);

    // Set line_account_id for multi-account tracking (always update on follow)
    if (lineAccountId) {
      await db.prepare('UPDATE friends SET line_account_id = ?, updated_at = ? WHERE id = ?')
        .bind(lineAccountId, jstNow(), friend.id).run();
      console.log(`[follow] line_account_id set to ${lineAccountId} for friend ${friend.id}`);
    }

    // Resolve referral link (entry_route) for this friend.
    // /auth/callback (OAuth path) writes friends.ref_code in parallel with
    // this follow webhook, so the field can briefly be NULL when LINE
    // delivers the event. Retry a few times (~1s total) before giving up,
    // otherwise override mode and intro pushes silently fall back to the
    // account default whenever the webhook wins the race.
    const { getFriendById } = await import('@line-crm/db');
    let friendRefCode = (friend as { ref_code?: string | null }).ref_code ?? null;
    if (!friendRefCode) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const refreshed = await getFriendById(db, friend.id);
        const refreshedRef = (refreshed as { ref_code?: string | null } | null)?.ref_code ?? null;
        if (refreshedRef) {
          friendRefCode = refreshedRef;
          break;
        }
      }
    }
    const referralRoute: EntryRoute | null = friendRefCode
      ? await getEntryRouteByRefCode(db, friendRefCode)
      : null;

    const runAccountScenarios =
      (!referralRoute || referralRoute.run_account_friend_add_scenarios !== 0);

    // friend_add シナリオに登録（このアカウントのシナリオのみ）。
    // LINE は新規友だち追加だけでなくブロック解除でも follow webhook を送るため、
    // repeat follow では既存の未完了登録を完了扱いにして、同じシナリオを最初から再開する。
    // Skip entirely when a referral link explicitly overrides (run_account_friend_add_scenarios=0).
    const scenarios = runAccountScenarios ? await getScenarios(db) : [];
    for (const scenario of scenarios) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch = !scenario.line_account_id || !lineAccountId || scenario.line_account_id === lineAccountId;
      if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
        try {
          if (isRepeatFollow) {
            await db
              .prepare(
                `DELETE FROM friend_scenarios
                 WHERE friend_id = ? AND scenario_id = ?`,
              )
              .bind(friend.id, scenario.id)
              .run();
          }

          // INSERT OR IGNORE handles normal dedup via UNIQUE(friend_id, scenario_id).
          // Repeat follow has already cleared the old row so block解除 starts over.
          const friendScenario = await enrollFriendInScenario(db, friend.id, scenario.id);
          if (!friendScenario) continue; // already enrolled

            // Immediate delivery: scenario.delivery_mode を踏まえて step1 が「now 以前」に
            // スケジュールされる場合のみ replyMessage で即時送信する。
            // - relative + delay_minutes=0 → 即時
            // - elapsed + offset_days=0 + offset_minutes=0 → 即時
            // - absolute_time で過去時刻 → computeNextDeliveryAt が now に clamp するので即時
            const steps = await getScenarioSteps(db, scenario.id);
            const firstStep = steps[0];
            const deliveryMode = scenario.delivery_mode ?? 'relative';
            const enrolledAtJst = new Date(Date.now() + 9 * 60 * 60_000);
            const firstScheduledAt = firstStep
              ? computeNextDeliveryAt(
                  { delivery_mode: deliveryMode },
                  firstStep,
                  { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
                )
              : null;
            const shouldSendImmediately =
              firstStep &&
              firstScheduledAt !== null &&
              firstScheduledAt.getTime() <= enrolledAtJst.getTime() &&
              friendScenario.status === 'active';
            if (firstStep && shouldSendImmediately) {
              try {
                const immediateDeliveries: Array<{
                  step: NonNullable<typeof firstStep>;
                  message: Message;
                  templateIdAtSend: string | null;
                }> = [];
                let lastSentStep: NonNullable<typeof firstStep> | null = null;
                let nextPendingStep: NonNullable<typeof firstStep> | null = null;
                let previousDeliveredAt = enrolledAtJst;

                for (const step of steps) {
                  if (immediateDeliveries.length >= 5) {
                    nextPendingStep = step;
                    break;
                  }
                  if (step.condition_type) {
                    nextPendingStep = step;
                    break;
                  }
                  const scheduledAt = computeNextDeliveryAt(
                    { delivery_mode: deliveryMode },
                    step,
                    { enrolledAt: enrolledAtJst, previousDeliveredAt, now: enrolledAtJst },
                  );
                  if (scheduledAt.getTime() > enrolledAtJst.getTime()) {
                    nextPendingStep = step;
                    break;
                  }

                  const resolved = await resolveStepContent(db, step);
                  const resolvedMeta = await resolveMetadata(db, {
                    user_id: (friend as unknown as Record<string, string | null>).user_id,
                    metadata: (friend as unknown as Record<string, string | null>).metadata,
                  });
                  const expandedContent = expandVariables(
                    resolved.messageContent,
                    { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1],
                  );
                  const message = buildMessage(resolved.messageType, expandedContent);
                  immediateDeliveries.push({ step, message, templateIdAtSend: resolved.templateIdAtSend });
                  lastSentStep = step;
                  previousDeliveredAt = enrolledAtJst;
                }

                if (!lastSentStep || immediateDeliveries.length === 0) continue;

                await lineClient.replyMessage(event.replyToken, immediateDeliveries.map(({ message }) => message));
                console.log(`Immediate delivery: sent ${immediateDeliveries.length} step(s) to ${userId}`);

                for (const delivery of immediateDeliveries) {
                  const logPayload = messageToLogPayload(delivery.message);
                  await db
                    .prepare(
                      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, template_id_at_send, created_at)
                       VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'reply', 'scenario', ?, ?)`,
                    )
                    .bind(
                      crypto.randomUUID(),
                      friend.id,
                      logPayload.messageType,
                      logPayload.content,
                      delivery.step.id,
                      delivery.templateIdAtSend,
                      jstNow(),
                    )
                    .run();
                }

                if (nextPendingStep) {
                  const nextDeliveryDate = computeNextDeliveryAt(
                    { delivery_mode: deliveryMode },
                    nextPendingStep,
                    { enrolledAt: enrolledAtJst, previousDeliveredAt, now: enrolledAtJst },
                  );
                  await advanceFriendScenario(db, friendScenario.id, lastSentStep.step_order, nextDeliveryDate.toISOString().slice(0, -1) + '+09:00');
                } else {
                  await completeFriendScenario(db, friendScenario.id);
                }

                for (const delivery of immediateDeliveries) {
                  if (delivery.step.on_reach_tag_id) {
                    try {
                      await addTagToFriend(db, friend.id, delivery.step.on_reach_tag_id);
                    } catch (err) {
                      console.error(`[scenario] tag attach failed step=${delivery.step.id}:`, err);
                    }
                  }
                }
              } catch (err) {
                console.error('Failed immediate delivery for scenario', scenario.id, err);
              }
            }
        } catch (err) {
          console.error('Failed to enroll friend in scenario', scenario.id, err);
        }
      }
    }

    // Referral link side-effects (intro push + dedicated scenario)
    if (referralRoute && !isRepeatFollow) {
      // Intro push from referral link
      if (referralRoute.intro_template_id) {
        try {
          const template = await getMessageTemplateById(db, referralRoute.intro_template_id);
          if (template) {
            const message = buildMessage(template.message_type, template.message_content);
            await lineClient.pushMessage(userId, [message]);
            console.log(`[follow] referral intro push sent route=${referralRoute.id}`);
          }
        } catch (err) {
          console.error('[follow] referral intro push failed', err);
        }
      }

      // Dedicated scenario enrollment from referral link
      if (referralRoute.scenario_id) {
        try {
          await enrollFriendInScenario(db, friend.id, referralRoute.scenario_id);
          console.log(`[follow] referral scenario enrolled scenario=${referralRoute.scenario_id}`);
        } catch (err) {
          console.error('[follow] referral scenario enrollment failed', err);
        }
      }
    }

    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    if (!isRepeatFollow) {
      await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);
    }
    return;
  }

  if (event.type === 'unfollow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    await updateFriendFollowStatus(db, userId, false);
    return;
  }

  // Postback events — triggered by Flex buttons with action.type: "postback"
  // Uses the same auto_replies matching but without displaying text in chat
  if (event.type === 'postback') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const postbackData = (event as unknown as { postback: { data: string } }).postback.data;

    const survey = parseSurveyPostbackData(postbackData);
    if (survey) {
      try {
        await handleSurveyPostback(
          db,
          lineClient,
          event.replyToken,
          friend,
          survey,
          lineAccountId,
          workerUrl,
        );
      } catch (err) {
        console.error('Failed to handle survey postback', err);
      }
      return;
    }

    const inlineSurvey = parseInlineSurveyPostbackData(postbackData);
    if (inlineSurvey) {
      try {
        await handleInlineSurveyPostback(
          db,
          lineClient,
          event.replyToken,
          friend,
          inlineSurvey,
          lineAccountId,
        );
      } catch (err) {
        console.error('Failed to handle inline survey postback', err);
      }
      return;
    }

    // Match postback data against auto_replies (exact match on keyword)
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
        template_id: string | null;
      }>();

    // postback の incoming 自体を messages_log に記録する。Rich Menu のタップで
    // 利用者が "コスト比較" などのアクションを起こした事実を chat 履歴で可視化する。
    // アンケート系 postback は上の専用処理で日本語ログとして保存する。
    await logIncomingPostback(db, friend.id, postbackData, lineAccountId, jstNow());

    for (const rule of autoReplies.results) {
      const isMatch = rule.match_type === 'exact'
        ? postbackData === rule.keyword
        : postbackData.includes(rule.keyword);

      if (isMatch) {
        try {
          const { resolveMetadata } = await import('../services/step-delivery.js');
          const resolvedMeta = await resolveMetadata(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const resolved = await resolveAutoReplyContent(db, {
            template_id: rule.template_id,
            response_type: rule.response_type,
            response_content: rule.response_content,
          });
          const expandedContent = expandVariables(resolved.content, { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1], workerUrl);
          const replyMsg = buildMessage(resolved.messageType, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);

          // 送信ログ — Rich Menu 経由の Flex 応答もチャット詳細に残るようにする。
          // テキスト auto_reply (line ~390) と同じパターン。
          const { messageToLogPayload: logPayload } = await import('../services/step-delivery.js');
          const replyPayload = logPayload(replyMsg);
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', 'auto_reply', ?, ?)`,
            )
            .bind(crypto.randomUUID(), friend.id, replyPayload.messageType, replyPayload.content, lineAccountId ?? null, jstNow())
            .run();
        } catch (err) {
          console.error('Failed to send postback reply', err);
        }
        break;
      }
    }
    return;
  }

  // 非テキストの受信メッセージ（スタンプ/画像/音声/動画/ファイル/位置情報等）もログに残す。
  // ここで早期 return することで、テキスト用の auto_reply / scenario 判定には進まない
  // （スタンプ単体に対するキーワードマッチは意味を持たないため）。inbox 抜けだけ防ぐ。
  if (event.type === 'message' && event.message.type !== 'text') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;
    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const msg = event.message as {
      type: string;
      fileName?: string;
      title?: string;
      packageId?: string | number;
      package_id?: string | number;
      stickerId?: string | number;
      sticker_id?: string | number;
      stickerResourceType?: string | number;
      sticker_resource_type?: string | number;
    };
    const labels: Record<string, string> = {
      sticker: '[スタンプ]',
      image: '[画像]',
      audio: '[音声]',
      video: '[動画]',
      file: msg.fileName ? `[ファイル: ${msg.fileName}]` : '[ファイル]',
      location: msg.title ? `[位置情報: ${msg.title}]` : '[位置情報]',
    };
    let content = labels[msg.type] ?? `[${msg.type}]`;
    if (msg.type === 'sticker') {
      const stickerContent = createStickerMessageContent(msg);
      if (stickerContent) {
        content = JSON.stringify(stickerContent);
      }
    }

    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
         VALUES (?, ?, 'incoming', ?, ?, NULL, NULL, 'user', ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, msg.type, content, jstNow())
      .run();
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const textMessage = event.message as TextEventMessage;
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'user', ?)`,
      )
      .bind(logId, friend.id, incomingText, now)
      .run();

    // Cross-account trigger: send message from another account via UUID
    if (incomingText === '体験を完了する' && lineAccountId) {
      try {
        const friendRecord = await db.prepare('SELECT user_id FROM friends WHERE id = ?').bind(friend.id).first<{ user_id: string | null }>();
        if (friendRecord?.user_id) {
          // Find the same user on other accounts
          const otherFriends = await db.prepare(
            'SELECT f.line_user_id, la.channel_access_token FROM friends f INNER JOIN line_accounts la ON la.id = f.line_account_id WHERE f.user_id = ? AND f.line_account_id != ? AND f.is_following = 1'
          ).bind(friendRecord.user_id, lineAccountId).all<{ line_user_id: string; channel_access_token: string }>();

          for (const other of otherFriends.results) {
            const otherClient = new LineClient(other.channel_access_token);
            const { buildMessage: bm } = await import('../services/step-delivery.js');
            await otherClient.pushMessage(other.line_user_id, [bm('flex', JSON.stringify({
              type: 'bubble', size: 'giga',
              header: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#fffbeb',
                contents: [{ type: 'text', text: `${friend.display_name || ''}さんへ`, size: 'lg', weight: 'bold', color: '#1e293b' }],
              },
              body: { type: 'box', layout: 'vertical', paddingAll: '20px',
                contents: [
                  { type: 'text', text: '別アカウントからのアクションを検知しました。', size: 'sm', color: '#06C755', weight: 'bold', wrap: true },
                  { type: 'text', text: 'アカウント連携が正常に動作しています。体験ありがとうございました。', size: 'sm', color: '#1e293b', wrap: true, margin: 'md' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: 'ステップ配信・フォーム即返信・アカウント連携・リッチメニュー・自動返信 — 全て無料、全てOSS。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
                ],
              },
              footer: { type: 'box', layout: 'vertical', paddingAll: '16px',
                contents: [
                  { type: 'button', action: { type: 'message', label: '導入について相談する', text: '導入支援を希望します' }, style: 'primary', color: '#06C755' },
                  ...(liffUrl ? [{ type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: `${liffUrl}?page=form` }, style: 'secondary', margin: 'sm' }] : []),
                ],
              },
            }))]);
          }

          // Reply on Account ② confirming
          await lineClient.replyMessage(event.replyToken, [buildMessage('flex', JSON.stringify({
            type: 'bubble',
            body: { type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: 'Account ① にメッセージを送りました', size: 'sm', color: '#06C755', weight: 'bold', align: 'center' },
                { type: 'text', text: 'Account ① のトーク画面を確認してください', size: 'xs', color: '#64748b', align: 'center', margin: 'md' },
              ],
            },
          }))]);
          return;
        }
      } catch (err) {
        console.error('Cross-account trigger error:', err);
      }
    }

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）
    // NOTE: Auto-replies use replyMessage (free, no quota) instead of pushMessage
    // The replyToken is only valid for ~1 minute after the message event
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
        template_id: string | null;
        is_active: number;
        created_at: string;
      }>();

    let matched = false;
    let replyTokenConsumed = false;
    for (const rule of autoReplies.results) {
      const isMatch =
        rule.match_type === 'exact'
          ? incomingText === rule.keyword
          : incomingText.includes(rule.keyword);

      if (isMatch) {
        // silent タイプ: 返信しないが matched=true にして unread / push を抑止する
        if (rule.response_type === 'silent') {
          matched = true;
          break;
        }

        try {
          const { resolveMetadata: resolveMeta2 } = await import('../services/step-delivery.js');
          const resolvedMeta2 = await resolveMeta2(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const resolved = await resolveAutoReplyContent(db, {
            template_id: rule.template_id,
            response_type: rule.response_type,
            response_content: rule.response_content,
          });
          const expandedContent = expandVariables(resolved.content, { ...friend, metadata: resolvedMeta2 } as Parameters<typeof expandVariables>[1], workerUrl);
          const replyMsg = buildMessage(resolved.messageType, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);
          replyTokenConsumed = true;

          // 送信ログ（replyMessage = 無料）— derive content from the built
          // reply message so any cleanEmptyNodes / parse-failure fallback is
          // reflected in the dashboard.
          const outLogId = crypto.randomUUID();
          const { messageToLogPayload: logPayload2 } = await import('../services/step-delivery.js');
          const wbAutoReplyPayload = logPayload2(replyMsg);
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', 'auto_reply', ?)`,
            )
            .bind(outLogId, friend.id, wbAutoReplyPayload.messageType, wbAutoReplyPayload.content, jstNow())
            .run();
        } catch (err) {
          console.error('Failed to send auto-reply', err);
        }

        matched = true;
        break;
      }
    }

    // auto_replies にマッチしなかった = 自発メッセージ → unread にする
    if (!matched) {
      await upsertChatOnMessage(db, friend.id);
    }

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(db, 'message_received', {
      friendId: friend.id,
      eventData: { text: incomingText, matched },
      replyToken: replyTokenConsumed ? undefined : event.replyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }
}

/**
 * auto_reply 行の content/type を resolve する。template_id が set なら templates
 * から取得、参照切れや NULL のときは inline response_content/response_type を使う。
 */
async function resolveAutoReplyContent(
  db: D1Database,
  rule: { template_id: string | null; response_type: string; response_content: string },
): Promise<{ messageType: string; content: string }> {
  if (rule.template_id) {
    const { getTemplateById } = await import('@line-crm/db');
    const tpl = await getTemplateById(db, rule.template_id);
    if (tpl) {
      return { messageType: tpl.message_type, content: tpl.message_content };
    }
  }
  return { messageType: rule.response_type, content: rule.response_content };
}

export { webhook };
