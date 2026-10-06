// クイックリプライ (メッセージの下に出て、押すと消える選択肢ボタン) を、
// メッセージ本文と一緒に保存し、送信時に取り出すための共通処理。
//
// 保存のしかた:
// - テキスト: 本文の末尾に「見えない区切り文字 + lhqr: + Base64(JSON)」を付ける。
//   本文を JSON で包まないのは、{{name}} の差し込みや URL 計測の置き換えなど、
//   既存の本文処理をそのまま通すため。
// - カード型 (flex)・画像: もともと JSON なので、最上位に lhQuickReply キーを足す。
//
// 送信時は extractQuickReply で取り出して LINE の quickReply に付け替え、
// 本文からは必ず取り除く (残したまま LINE に送ると、テキストに記号が混ざるか
// Flex の検証で弾かれる)。

// shared は DOM の型を読み込まないので、Workers / ブラウザ共通の関数だけ宣言する。
declare const btoa: (data: string) => string;
declare const atob: (data: string) => string;

export interface QuickReplyItem {
  type: 'action';
  action:
    | { type: 'message'; label: string; text: string }
    | { type: 'postback'; label: string; data: string; displayText?: string }
    | { type: 'uri'; label: string; uri: string };
}

export interface QuickReply {
  items: QuickReplyItem[];
}

/** LINE の上限: 1メッセージあたり13個、ラベルは20文字 */
export const QUICK_REPLY_MAX_ITEMS = 13;
export const QUICK_REPLY_LABEL_MAX = 20;

const TEXT_MARKER = '⁣lhqr:';
const JSON_KEY = 'lhQuickReply';

function toBase64Url(text: string): string {
  // UTF-8 のバイト列を1文字1バイトの文字列にしてから Base64 にする
  const binary = unescape(encodeURIComponent(text));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const normal = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

/** 形の崩れた項目を落とし、上限 (13個・20文字) に収める。1つも残らなければ undefined。 */
export function sanitizeQuickReply(input: unknown): QuickReply | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const rawItems = (input as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return undefined;
  const items: QuickReplyItem[] = [];
  for (const raw of rawItems) {
    if (items.length >= QUICK_REPLY_MAX_ITEMS) break;
    const action = (raw as { action?: Record<string, unknown> } | null)?.action;
    if (!action || typeof action.label !== 'string' || !action.label.trim()) continue;
    const label = action.label.trim().slice(0, QUICK_REPLY_LABEL_MAX);
    if (action.type === 'message' && typeof action.text === 'string' && action.text) {
      items.push({ type: 'action', action: { type: 'message', label, text: action.text } });
    } else if (action.type === 'postback' && typeof action.data === 'string' && action.data) {
      items.push({ type: 'action', action: { type: 'postback', label, data: action.data, displayText: label } });
    } else if (action.type === 'uri' && typeof action.uri === 'string' && /^https?:\/\//.test(action.uri)) {
      items.push({ type: 'action', action: { type: 'uri', label, uri: action.uri } });
    }
  }
  return items.length > 0 ? { items } : undefined;
}

/**
 * 本文からクイックリプライを取り出す。content は取り除いたあとの本文。
 * 付いていない・壊れている場合は本文をそのまま返す (送信を止めない)。
 */
export function extractQuickReply(
  messageType: string,
  content: string,
): { content: string; quickReply?: QuickReply } {
  if (messageType === 'text') {
    const at = content.lastIndexOf(TEXT_MARKER);
    if (at < 0) return { content };
    const body = content.slice(0, at);
    try {
      return { content: body, quickReply: sanitizeQuickReply(JSON.parse(fromBase64Url(content.slice(at + TEXT_MARKER.length)))) };
    } catch {
      return { content: body };
    }
  }
  if (!content.includes(`"${JSON_KEY}"`)) return { content };
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || !(JSON_KEY in parsed)) return { content };
    const { [JSON_KEY]: raw, ...rest } = parsed;
    return { content: JSON.stringify(rest), quickReply: sanitizeQuickReply(raw) };
  } catch {
    return { content };
  }
}

/** 本文にクイックリプライを付ける (既に付いていれば置き換える)。null や空なら取り除く。 */
export function embedQuickReply(messageType: string, content: string, quickReply: QuickReply | null | undefined): string {
  const base = extractQuickReply(messageType, content).content;
  const clean = sanitizeQuickReply(quickReply);
  if (!clean) return base;
  if (messageType === 'text') return `${base}${TEXT_MARKER}${toBase64Url(JSON.stringify(clean))}`;
  try {
    const parsed = JSON.parse(base) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, [JSON_KEY]: clean });
  } catch {
    return base;
  }
}
