// =============================================================================
// Flex メッセージ「かんたんビルダー」— 純関数群
// L-step 等の商用ツールにある「ボタン付きメッセージをGUIで作る」体験の再現。
//
// 設計方針:
//   - buildFlexJson(state) は常に決まった構造の Flex JSON (bubble/carousel) を生成する
//   - parseBuilderFlex(json) はその決まった構造だけを認識して BuilderState に逆変換する
//   - ビルダー生成物に "_builder":"v1" 等のカスタムキーは入れない
//     (LINE Messaging API が未知キーを拒否する可能性があるため)。
//     代わりに「構造がこのパターンと完全一致するか」で判定する。
//   - 上記いずれの構造にも一致しない Flex JSON (手書き・複雑な入れ子など) は
//     parseBuilderFlex が null を返す → 呼び出し側は JSON モード固定で表示する。
// =============================================================================

export type FlexButtonStyle = 'primary' | 'secondary';
export type FlexActionKind = 'uri' | 'message' | 'postback';
export type FlexHeaderColor = 'green' | 'blue' | 'gray';
export type FlexBuilderMode = 'single' | 'carousel';

export interface FlexBuilderButton {
  /** ボタンのラベル (20字まで) */
  label: string;
  /** アクション種別: URLを開く / テキストを送信させる / ポストバック(上級者向け) */
  actionType: FlexActionKind;
  /** アクション値: URL / 送信テキスト / postback data */
  actionValue: string;
  /** ボタンの見た目: primary(緑) / secondary(グレー) */
  style: FlexButtonStyle;
}

export interface FlexBuilderBubbleState {
  /** ヘッダーテキスト (任意・小さいラベル)。空文字 = ヘッダーなし */
  headerText: string;
  /** ヘッダー背景色 */
  headerColor: FlexHeaderColor;
  /** 本文テキスト (必須・複数行可) */
  bodyText: string;
  /** hero 画像 URL。空文字 = 画像なし */
  imageUrl: string;
  /** ボタン 1〜4個 */
  buttons: FlexBuilderButton[];
}

export interface FlexBuilderState {
  mode: FlexBuilderMode;
  /** single: 1件のみ / carousel: 2〜10件 */
  bubbles: FlexBuilderBubbleState[];
}

export const FLEX_BUILDER_HEADER_COLORS: Record<FlexHeaderColor, string> = {
  green: '#06C755',
  blue: '#2563EB',
  gray: '#9CA3AF',
};

const BODY_TEXT_COLOR = '#111827';
const HEADER_TEXT_COLOR = '#FFFFFF';
const PRIMARY_BUTTON_COLOR = '#06C755';
const BUTTON_LABEL_MAX_LENGTH = 20;
export const FLEX_BUILDER_MAX_BUTTONS = 4;
export const FLEX_BUILDER_MIN_CAROUSEL_BUBBLES = 2;
export const FLEX_BUILDER_MAX_CAROUSEL_BUBBLES = 10;

export function emptyFlexBuilderButton(): FlexBuilderButton {
  return { label: '', actionType: 'uri', actionValue: '', style: 'primary' };
}

export function emptyFlexBuilderBubble(): FlexBuilderBubbleState {
  return {
    headerText: '',
    headerColor: 'green',
    bodyText: '',
    imageUrl: '',
    buttons: [emptyFlexBuilderButton()],
  };
}

export function emptyFlexBuilderState(): FlexBuilderState {
  return { mode: 'single', bubbles: [emptyFlexBuilderBubble()] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerColorFromBg(bg: string): FlexHeaderColor | null {
  const entry = (Object.entries(FLEX_BUILDER_HEADER_COLORS) as Array<[FlexHeaderColor, string]>).find(
    ([, hex]) => hex === bg,
  );
  return entry ? entry[0] : null;
}

// -----------------------------------------------------------------------------
// state → JSON
// -----------------------------------------------------------------------------

function buildAction(button: FlexBuilderButton): Record<string, unknown> {
  const label = button.label.slice(0, BUTTON_LABEL_MAX_LENGTH);
  if (button.actionType === 'uri') {
    return { type: 'uri', label, uri: button.actionValue };
  }
  if (button.actionType === 'message') {
    return { type: 'message', label, text: button.actionValue };
  }
  // postback: 既存の投票・アンケート系ボタンと同様、displayText はラベルと同じにする
  // (トーク画面にタップした選択肢がそのまま表示されるようにするため)
  return { type: 'postback', label, data: button.actionValue, displayText: label };
}

function buildButtonJson(button: FlexBuilderButton): Record<string, unknown> {
  return {
    type: 'button',
    style: button.style,
    ...(button.style === 'primary' ? { color: PRIMARY_BUTTON_COLOR } : {}),
    height: 'sm',
    action: buildAction(button),
  };
}

function buildBubbleJson(bubble: FlexBuilderBubbleState): Record<string, unknown> {
  const result: Record<string, unknown> = { type: 'bubble', size: 'mega' };

  if (bubble.imageUrl.trim()) {
    result.hero = {
      type: 'image',
      url: bubble.imageUrl.trim(),
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  if (bubble.headerText.trim()) {
    result.header = {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FLEX_BUILDER_HEADER_COLORS[bubble.headerColor],
      paddingAll: 'md',
      contents: [
        { type: 'text', text: bubble.headerText.trim(), size: 'xs', color: HEADER_TEXT_COLOR, weight: 'bold' },
      ],
    };
  }

  result.body = {
    type: 'box',
    layout: 'vertical',
    paddingAll: 'lg',
    contents: [
      { type: 'text', text: bubble.bodyText, size: 'md', color: BODY_TEXT_COLOR, wrap: true },
    ],
  };

  const buttons = bubble.buttons.slice(0, FLEX_BUILDER_MAX_BUTTONS);
  if (buttons.length > 0) {
    result.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: 'lg',
      contents: buttons.map(buildButtonJson),
    };
  }

  return result;
}

/** ビルダーの state から LINE Flex Message JSON (bubble または carousel) を生成する */
export function buildFlexJson(state: FlexBuilderState): Record<string, unknown> {
  if (state.mode === 'carousel' && state.bubbles.length > 1) {
    return { type: 'carousel', contents: state.bubbles.map(buildBubbleJson) };
  }
  return buildBubbleJson(state.bubbles[0] ?? emptyFlexBuilderBubble());
}

// -----------------------------------------------------------------------------
// JSON → state (構造が完全一致する場合のみ)
// -----------------------------------------------------------------------------

const ALLOWED_BUBBLE_KEYS = new Set(['type', 'size', 'hero', 'header', 'body', 'footer']);

function parseHero(raw: unknown): string | null | undefined {
  // undefined = hero キー自体がない (OK, 画像なし)
  // null = hero キーはあるが形式が一致しない (パース失敗)
  // string = 画像URL
  if (raw === undefined) return undefined;
  if (
    !isRecord(raw) ||
    raw.type !== 'image' ||
    typeof raw.url !== 'string' ||
    raw.size !== 'full' ||
    raw.aspectRatio !== '20:13' ||
    raw.aspectMode !== 'cover' ||
    Object.keys(raw).length !== 5
  ) {
    return null;
  }
  return raw.url;
}

function parseHeader(raw: unknown): { headerText: string; headerColor: FlexHeaderColor } | null | undefined {
  if (raw === undefined) return undefined;
  if (
    !isRecord(raw) ||
    raw.type !== 'box' ||
    raw.layout !== 'vertical' ||
    typeof raw.backgroundColor !== 'string' ||
    raw.paddingAll !== 'md' ||
    !Array.isArray(raw.contents) ||
    raw.contents.length !== 1 ||
    Object.keys(raw).length !== 5
  ) {
    return null;
  }
  const headerColor = headerColorFromBg(raw.backgroundColor);
  if (!headerColor) return null;
  const textNode = raw.contents[0];
  if (
    !isRecord(textNode) ||
    textNode.type !== 'text' ||
    typeof textNode.text !== 'string' ||
    textNode.size !== 'xs' ||
    textNode.color !== HEADER_TEXT_COLOR ||
    textNode.weight !== 'bold' ||
    Object.keys(textNode).length !== 5
  ) {
    return null;
  }
  return { headerText: textNode.text, headerColor };
}

function parseBody(raw: unknown): string | null {
  if (
    !isRecord(raw) ||
    raw.type !== 'box' ||
    raw.layout !== 'vertical' ||
    raw.paddingAll !== 'lg' ||
    !Array.isArray(raw.contents) ||
    raw.contents.length !== 1 ||
    Object.keys(raw).length !== 4
  ) {
    return null;
  }
  const textNode = raw.contents[0];
  if (
    !isRecord(textNode) ||
    textNode.type !== 'text' ||
    typeof textNode.text !== 'string' ||
    textNode.size !== 'md' ||
    textNode.color !== BODY_TEXT_COLOR ||
    textNode.wrap !== true ||
    Object.keys(textNode).length !== 5
  ) {
    return null;
  }
  return textNode.text;
}

function parseButton(raw: unknown): FlexBuilderButton | null {
  if (!isRecord(raw) || raw.type !== 'button') return null;
  if (raw.style !== 'primary' && raw.style !== 'secondary') return null;
  if (raw.height !== 'sm') return null;
  const expectedKeyCount = raw.style === 'primary' ? 5 : 4; // type, style, color?, height, action
  if (Object.keys(raw).length !== expectedKeyCount) return null;
  if (raw.style === 'primary' && raw.color !== PRIMARY_BUTTON_COLOR) return null;

  const action = raw.action;
  if (!isRecord(action) || typeof action.label !== 'string') return null;

  if (action.type === 'uri') {
    if (typeof action.uri !== 'string' || Object.keys(action).length !== 3) return null;
    return { label: action.label, actionType: 'uri', actionValue: action.uri, style: raw.style };
  }
  if (action.type === 'message') {
    if (typeof action.text !== 'string' || Object.keys(action).length !== 3) return null;
    return { label: action.label, actionType: 'message', actionValue: action.text, style: raw.style };
  }
  if (action.type === 'postback') {
    if (typeof action.data !== 'string' || Object.keys(action).length !== 4) return null;
    if (action.displayText !== action.label) return null;
    return { label: action.label, actionType: 'postback', actionValue: action.data, style: raw.style };
  }
  return null;
}

function parseFooter(raw: unknown): FlexBuilderButton[] | null | undefined {
  if (raw === undefined) return undefined;
  if (
    !isRecord(raw) ||
    raw.type !== 'box' ||
    raw.layout !== 'vertical' ||
    raw.spacing !== 'sm' ||
    raw.paddingAll !== 'lg' ||
    !Array.isArray(raw.contents) ||
    raw.contents.length < 1 ||
    raw.contents.length > FLEX_BUILDER_MAX_BUTTONS ||
    Object.keys(raw).length !== 5
  ) {
    return null;
  }
  const buttons: FlexBuilderButton[] = [];
  for (const item of raw.contents) {
    const button = parseButton(item);
    if (!button) return null;
    buttons.push(button);
  }
  return buttons;
}

/** 1つの bubble がビルダー生成パターンと完全一致するかを判定し、一致すれば state に変換する */
function parseBubble(raw: unknown): FlexBuilderBubbleState | null {
  if (!isRecord(raw) || raw.type !== 'bubble') return null;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_BUBBLE_KEYS.has(key)) return null;
  }

  const hero = parseHero(raw.hero);
  if (hero === null) return null;

  const header = parseHeader(raw.header);
  if (header === null) return null;

  const bodyText = parseBody(raw.body);
  if (bodyText === null) return null;

  const buttons = parseFooter(raw.footer);
  if (buttons === null || buttons === undefined || buttons.length === 0) {
    // v1 スコープ: ボタン付きメッセージのみサポート (ボタン0個の Flex は簡単モード対象外)
    return null;
  }

  return {
    headerText: header?.headerText ?? '',
    headerColor: header?.headerColor ?? 'green',
    bodyText,
    imageUrl: hero ?? '',
    buttons,
  };
}

/**
 * 保存済み Flex JSON 文字列をパースし、ビルダーで編集可能な構造なら BuilderState を返す。
 * 手書きの複雑な構造 (入れ子ボックス、テキスト複数個など) や、パース不能な JSON は null を返す。
 * 呼び出し側は null の場合 JSON モード固定で表示すること。
 */
export function parseBuilderFlex(json: string): FlexBuilderState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  if (parsed.type === 'carousel') {
    if (!Array.isArray(parsed.contents) || Object.keys(parsed).length !== 2) return null;
    if (
      parsed.contents.length < FLEX_BUILDER_MIN_CAROUSEL_BUBBLES ||
      parsed.contents.length > FLEX_BUILDER_MAX_CAROUSEL_BUBBLES
    ) {
      return null;
    }
    const bubbles: FlexBuilderBubbleState[] = [];
    for (const item of parsed.contents) {
      const bubble = parseBubble(item);
      if (!bubble) return null;
      bubbles.push(bubble);
    }
    return { mode: 'carousel', bubbles };
  }

  const bubble = parseBubble(parsed);
  if (!bubble) return null;
  return { mode: 'single', bubbles: [bubble] };
}

// -----------------------------------------------------------------------------
// altText プレビュー (通知欄に表示される文言の目安)
// -----------------------------------------------------------------------------

/**
 * Worker 側 (apps/worker/src/utils/flex-alt-text.ts の extractFlexAltText) と同じ優先順位
 * — ヘッダーがあればヘッダー、なければ本文 — で、通知に表示される文言のプレビューを作る。
 * シナリオステップの Flex には altText を保存するカラムが無く、配信時に常に自動生成される
 * ため、この関数はあくまで UI 上のプレビュー用 (実際に送信される値ではない)。
 */
export function buildFlexAltTextPreview(state: FlexBuilderState, maxLength = 40): string {
  const bubble = state.bubbles[0];
  if (!bubble) return '';
  const source = bubble.headerText.trim() || bubble.bodyText.trim();
  return source.slice(0, maxLength);
}
