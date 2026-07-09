import { describe, it, expect } from 'vitest';
import {
  buildFlexJson,
  parseBuilderFlex,
  buildFlexAltTextPreview,
  emptyFlexBuilderBubble,
  emptyFlexBuilderButton,
  type FlexBuilderState,
  type FlexBuilderBubbleState,
} from '@line-crm/shared';

function bubbleWithButtons(buttons: FlexBuilderBubbleState['buttons']): FlexBuilderState {
  return {
    mode: 'single',
    bubbles: [{ ...emptyFlexBuilderBubble(), bodyText: '本文です', buttons }],
  };
}

describe('flex-builder: buildFlexJson', () => {
  it('ボタン1個の単一バブルを生成する (uri アクション)', () => {
    const state = bubbleWithButtons([
      { label: '詳細を見る', actionType: 'uri', actionValue: 'https://example.com', style: 'primary' },
    ]);
    const json = buildFlexJson(state) as any;
    expect(json.type).toBe('bubble');
    expect(json.footer.contents).toHaveLength(1);
    expect(json.footer.contents[0]).toEqual({
      type: 'button',
      style: 'primary',
      color: '#06C755',
      height: 'sm',
      action: { type: 'uri', label: '詳細を見る', uri: 'https://example.com' },
    });
    expect(json.header).toBeUndefined();
    expect(json.hero).toBeUndefined();
  });

  it('ボタン4個 (uri/message/postback混在, primary/secondary混在) の単一バブルを生成する', () => {
    const state = bubbleWithButtons([
      { label: 'URL', actionType: 'uri', actionValue: 'https://a.example', style: 'primary' },
      { label: '送信', actionType: 'message', actionValue: 'はい', style: 'secondary' },
      { label: 'ポストバック', actionType: 'postback', actionValue: 'lh:custom:1', style: 'primary' },
      { label: '4つ目', actionType: 'uri', actionValue: 'https://b.example', style: 'secondary' },
    ]);
    const json = buildFlexJson(state) as any;
    expect(json.footer.contents).toHaveLength(4);
    expect(json.footer.contents[1]).toEqual({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: { type: 'message', label: '送信', text: 'はい' },
    });
    expect(json.footer.contents[2].action).toEqual({
      type: 'postback',
      label: 'ポストバック',
      data: 'lh:custom:1',
      displayText: 'ポストバック',
    });
  });

  it('hero 画像ありのバブルを生成する', () => {
    const state: FlexBuilderState = {
      mode: 'single',
      bubbles: [{ ...emptyFlexBuilderBubble(), bodyText: '本文', imageUrl: 'https://img.example/a.png', buttons: [emptyFlexBuilderButton()] }],
    };
    const json = buildFlexJson(state) as any;
    expect(json.hero).toEqual({
      type: 'image',
      url: 'https://img.example/a.png',
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    });
  });

  it('hero 画像なしのバブルは hero キーを持たない', () => {
    const state = bubbleWithButtons([emptyFlexBuilderButton()]);
    const json = buildFlexJson(state) as any;
    expect('hero' in json).toBe(false);
  });

  it('ヘッダーテキストありの場合、色に応じた backgroundColor が入る', () => {
    const state: FlexBuilderState = {
      mode: 'single',
      bubbles: [{
        ...emptyFlexBuilderBubble(),
        headerText: 'アンケート 1/4',
        headerColor: 'blue',
        bodyText: '質問文',
        buttons: [emptyFlexBuilderButton()],
      }],
    };
    const json = buildFlexJson(state) as any;
    expect(json.header.backgroundColor).toBe('#2563EB');
    expect(json.header.contents[0]).toEqual({
      type: 'text',
      text: 'アンケート 1/4',
      size: 'xs',
      color: '#FFFFFF',
      weight: 'bold',
    });
  });

  it('カルーセル (3バブル) を生成する', () => {
    const state: FlexBuilderState = {
      mode: 'carousel',
      bubbles: [
        { ...emptyFlexBuilderBubble(), bodyText: '1つ目', buttons: [emptyFlexBuilderButton()] },
        { ...emptyFlexBuilderBubble(), bodyText: '2つ目', buttons: [emptyFlexBuilderButton()] },
        { ...emptyFlexBuilderBubble(), bodyText: '3つ目', buttons: [emptyFlexBuilderButton()] },
      ],
    };
    const json = buildFlexJson(state) as any;
    expect(json.type).toBe('carousel');
    expect(json.contents).toHaveLength(3);
    expect(json.contents[1].body.contents[0].text).toBe('2つ目');
  });

  it('ボタンラベルは20字に切り詰められる', () => {
    const longLabel = 'あ'.repeat(30);
    const state = bubbleWithButtons([{ label: longLabel, actionType: 'uri', actionValue: 'https://x.example', style: 'primary' }]);
    const json = buildFlexJson(state) as any;
    expect(json.footer.contents[0].action.label).toHaveLength(20);
  });
});

describe('flex-builder: parseBuilderFlex — ラウンドトリップ', () => {
  it('単一バブル (ボタン1個) を build → parse すると同じ state に戻る', () => {
    const state = bubbleWithButtons([
      { label: '詳細', actionType: 'uri', actionValue: 'https://example.com', style: 'primary' },
    ]);
    const json = JSON.stringify(buildFlexJson(state));
    expect(parseBuilderFlex(json)).toEqual(state);
  });

  it('画像・ヘッダー・ボタン4個ありの単一バブルを build → parse すると同じ state に戻る', () => {
    const state: FlexBuilderState = {
      mode: 'single',
      bubbles: [{
        headerText: '限定オファー',
        headerColor: 'gray',
        bodyText: '本文\n複数行\nテキストです',
        imageUrl: 'https://img.example/hero.png',
        buttons: [
          { label: 'A', actionType: 'uri', actionValue: 'https://a.example', style: 'primary' },
          { label: 'B', actionType: 'message', actionValue: 'こんにちは', style: 'secondary' },
          { label: 'C', actionType: 'postback', actionValue: 'lh:custom:x', style: 'primary' },
          { label: 'D', actionType: 'uri', actionValue: 'https://d.example', style: 'secondary' },
        ],
      }],
    };
    const json = JSON.stringify(buildFlexJson(state));
    expect(parseBuilderFlex(json)).toEqual(state);
  });

  it('カルーセル (2〜10バブル) を build → parse すると同じ state に戻る', () => {
    const state: FlexBuilderState = {
      mode: 'carousel',
      bubbles: Array.from({ length: 5 }, (_, i) => ({
        ...emptyFlexBuilderBubble(),
        bodyText: `バブル${i + 1}`,
        buttons: [{ label: `ボタン${i + 1}`, actionType: 'uri' as const, actionValue: `https://x.example/${i}`, style: 'primary' as const }],
      })),
    };
    const json = JSON.stringify(buildFlexJson(state));
    expect(parseBuilderFlex(json)).toEqual(state);
  });

  it('パース不能な JSON 文字列は null を返す', () => {
    expect(parseBuilderFlex('{ this is not valid json')).toBeNull();
  });

  it('構造がビルダーパターンと一致しない Flex JSON (本文が複数テキスト) は null を返す', () => {
    // apps/worker/src/services/intro-message.ts の buildSurveyQuestionMessageFromQuestions が
    // 生成するようなバブル: body 内に進捗表示テキストと質問文の2つのテキストノードがある
    const surveyLikeBubble = {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '【1/4】', size: 'xs', color: '#06C755', weight: 'bold' },
          { type: 'text', text: '質問文', size: 'lg', weight: 'bold', color: '#111827', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', color: '#06C755', height: 'sm', action: { type: 'postback', label: 'はい', data: 'x', displayText: 'はい' } },
        ],
      },
    };
    expect(parseBuilderFlex(JSON.stringify(surveyLikeBubble))).toBeNull();
  });

  it('ボタンが1つも無い Flex (footer なし) は null を返す (v1スコープ外)', () => {
    const noButtonBubble = buildFlexJson(bubbleWithButtons([emptyFlexBuilderButton()])) as any;
    delete noButtonBubble.footer;
    expect(parseBuilderFlex(JSON.stringify(noButtonBubble))).toBeNull();
  });

  it('カルーセルのバブル数が範囲外 (1件, 11件) の場合は null を返す', () => {
    const singleBubbleJson = buildFlexJson(bubbleWithButtons([emptyFlexBuilderButton()]));
    expect(parseBuilderFlex(JSON.stringify({ type: 'carousel', contents: [singleBubbleJson] }))).toBeNull();

    const elevenBubbles = Array.from({ length: 11 }, () => buildFlexJson(bubbleWithButtons([emptyFlexBuilderButton()])));
    expect(parseBuilderFlex(JSON.stringify({ type: 'carousel', contents: elevenBubbles }))).toBeNull();
  });
});

describe('flex-builder: buildFlexAltTextPreview', () => {
  it('ヘッダーがあればヘッダーテキストを優先する (Worker の extractFlexAltText と同じ優先順位)', () => {
    const state: FlexBuilderState = {
      mode: 'single',
      bubbles: [{ ...emptyFlexBuilderBubble(), headerText: 'アンケート 1/4', bodyText: '質問本文がここに入ります' }],
    };
    expect(buildFlexAltTextPreview(state)).toBe('アンケート 1/4');
  });

  it('ヘッダーが無ければ本文の先頭40字を使う', () => {
    const longBody = 'あ'.repeat(60);
    const state: FlexBuilderState = {
      mode: 'single',
      bubbles: [{ ...emptyFlexBuilderBubble(), headerText: '', bodyText: longBody }],
    };
    const preview = buildFlexAltTextPreview(state);
    expect(preview).toHaveLength(40);
    expect(preview).toBe(longBody.slice(0, 40));
  });
});
