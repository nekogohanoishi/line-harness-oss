const MAX_REPLY_MESSAGES = 5;
const SUPPORTED_MESSAGE_TYPES = new Set(['text', 'flex', 'image']);

export interface AutoReplyMessageInput {
  messageType: string;
  messageContent: string;
  delaySeconds?: number;
  deliveryTimeJst?: string;
  sameDayCutoffTimeJst?: string;
}

interface AutoReplySequence {
  messages: AutoReplyMessageInput[];
}

const HH_MM_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseClockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function computeScheduledAutoReplyAt(
  now: Date,
  deliveryTimeJst: string,
  sameDayCutoffTimeJst: string,
): Date {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const cutoffMinutes = parseClockMinutes(sameDayCutoffTimeJst);
  const cutoffAt = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate(),
    Math.floor(cutoffMinutes / 60),
    cutoffMinutes % 60,
  ) - JST_OFFSET_MS;
  const deliveryMinutes = parseClockMinutes(deliveryTimeJst);
  const dayOffset = now.getTime() <= cutoffAt ? 0 : 1;
  const deliveryAt = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate() + dayOffset,
    Math.floor(deliveryMinutes / 60),
    deliveryMinutes % 60,
  ) - JST_OFFSET_MS;

  return new Date(deliveryAt);
}

export function resolveAutoReplySchedule(
  message: AutoReplyMessageInput,
  now: Date = new Date(),
): { delaySeconds: number; deliverAt?: string } {
  if (message.deliveryTimeJst && message.sameDayCutoffTimeJst) {
    const deliverAt = computeScheduledAutoReplyAt(
      now,
      message.deliveryTimeJst,
      message.sameDayCutoffTimeJst,
    );
    return {
      delaySeconds: Math.max(0, Math.ceil((deliverAt.getTime() - now.getTime()) / 1000)),
      deliverAt: deliverAt.toISOString(),
    };
  }

  return { delaySeconds: message.delaySeconds ?? 0 };
}

export function parseAutoReplyMessages(
  responseType: string,
  responseContent: string,
): AutoReplyMessageInput[] {
  if (responseType !== 'sequence') {
    return [{ messageType: responseType, messageContent: responseContent, delaySeconds: 0 }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseContent);
  } catch {
    throw new Error('sequence responseContent must be valid JSON');
  }

  const messages = (parsed as Partial<AutoReplySequence> | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('sequence must contain at least one message');
  }
  if (messages.length > MAX_REPLY_MESSAGES) {
    throw new Error(`sequence cannot contain more than ${MAX_REPLY_MESSAGES} messages`);
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new Error(`sequence message ${index + 1} must be an object`);
    }

    const {
      messageType,
      messageContent,
      delaySeconds = 0,
      deliveryTimeJst,
      sameDayCutoffTimeJst,
    } = message as Partial<AutoReplyMessageInput>;
    if (typeof messageType !== 'string' || !SUPPORTED_MESSAGE_TYPES.has(messageType)) {
      throw new Error(`sequence message ${index + 1} has an unsupported messageType`);
    }
    if (typeof messageContent !== 'string' || messageContent.trim().length === 0) {
      throw new Error(`sequence message ${index + 1} requires messageContent`);
    }
    if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 86_400) {
      throw new Error(`sequence message ${index + 1} delaySeconds must be an integer from 0 to 86400`);
    }

    const hasDeliveryTime = deliveryTimeJst !== undefined;
    const hasCutoffTime = sameDayCutoffTimeJst !== undefined;
    if (hasDeliveryTime !== hasCutoffTime) {
      throw new Error(
        `sequence message ${index + 1} requires both deliveryTimeJst and sameDayCutoffTimeJst`,
      );
    }
    if (hasDeliveryTime) {
      if (
        typeof deliveryTimeJst !== 'string' ||
        typeof sameDayCutoffTimeJst !== 'string' ||
        !HH_MM_PATTERN.test(deliveryTimeJst) ||
        !HH_MM_PATTERN.test(sameDayCutoffTimeJst)
      ) {
        throw new Error(`sequence message ${index + 1} scheduled times must use HH:mm`);
      }
      if (delaySeconds !== 0) {
        throw new Error(
          `sequence message ${index + 1} cannot combine delaySeconds with scheduled times`,
        );
      }
      if (parseClockMinutes(deliveryTimeJst) <= parseClockMinutes(sameDayCutoffTimeJst)) {
        throw new Error(
          `sequence message ${index + 1} deliveryTimeJst must be later than sameDayCutoffTimeJst`,
        );
      }
    }

    return {
      messageType,
      messageContent,
      delaySeconds,
      ...(deliveryTimeJst ? { deliveryTimeJst } : {}),
      ...(sameDayCutoffTimeJst ? { sameDayCutoffTimeJst } : {}),
    };
  });
}

export function validateAutoReplyResponse(
  responseType: string,
  responseContent: string,
): string | null {
  if (responseType !== 'sequence') return null;

  try {
    parseAutoReplyMessages(responseType, responseContent);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid sequence response';
  }
}
