import { describe, expect, test } from 'vitest';
import { embedQuickReply, extractQuickReply, sanitizeQuickReply } from '@line-crm/shared';

const qr = {
  items: [
    { type: 'action' as const, action: { type: 'postback' as const, label: '詳しく知りたい', data: 'lh:act:abc' } },
    { type: 'action' as const, action: { type: 'message' as const, label: '今回は見送る', text: '今回は見送る' } },
  ],
};

describe('quick reply の保存と取り出し', () => {
  test('テキスト: 本文はそのまま残り、末尾の印から選択肢を取り出せる', () => {
    const stored = embedQuickReply('text', '{{name}}さん、作成会のご案内です。', qr);
    expect(stored.startsWith('{{name}}さん、作成会のご案内です。')).toBe(true);
    const { content, quickReply } = extractQuickReply('text', stored);
    expect(content).toBe('{{name}}さん、作成会のご案内です。');
    expect(quickReply?.items.map((item) => item.action.label)).toEqual(['詳しく知りたい', '今回は見送る']);
    // postback は押したときにラベルがトークに残るよう displayText を付ける
    expect(quickReply?.items[0].action).toMatchObject({ type: 'postback', data: 'lh:act:abc', displayText: '詳しく知りたい' });
  });

  test('テキスト: 名前の差し込み後でも取り出せる (印の部分は書き換わらない)', () => {
    const stored = embedQuickReply('text', '{{name}}さん', qr).replace('{{name}}', '山田 "太郎"');
    const { content, quickReply } = extractQuickReply('text', stored);
    expect(content).toBe('山田 "太郎"さん');
    expect(quickReply?.items).toHaveLength(2);
  });

  test('カード型: JSON の最上位に入れ、取り出すと元のカードに戻る', () => {
    const bubble = JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } });
    const stored = embedQuickReply('flex', bubble, qr);
    expect(JSON.parse(stored).lhQuickReply.items).toHaveLength(2);
    const { content, quickReply } = extractQuickReply('flex', stored);
    expect(JSON.parse(content)).toEqual(JSON.parse(bubble));
    expect(quickReply?.items).toHaveLength(2);
  });

  test('付いていない本文は何も変えずに返し、空の選択肢を渡すと取り除く', () => {
    expect(extractQuickReply('text', 'こんにちは')).toEqual({ content: 'こんにちは' });
    const stored = embedQuickReply('text', 'こんにちは', qr);
    expect(embedQuickReply('text', stored, { items: [] })).toBe('こんにちは');
  });

  test('上限: 13個まで、ラベルは20文字、http(s) 以外のリンクは落とす', () => {
    const many = {
      items: [
        ...Array.from({ length: 15 }, (_, i) => ({ type: 'action', action: { type: 'message', label: `選択肢${i}`, text: `選択肢${i}` } })),
      ],
    };
    expect(sanitizeQuickReply(many)?.items).toHaveLength(13);
    expect(sanitizeQuickReply({ items: [{ type: 'action', action: { type: 'message', label: 'あ'.repeat(25), text: 'x' } }] })?.items[0].action.label)
      .toHaveLength(20);
    expect(sanitizeQuickReply({ items: [{ type: 'action', action: { type: 'uri', label: '開く', uri: 'javascript:alert(1)' } }] })).toBeUndefined();
  });

  test('壊れた印でも本文は送れる (選択肢だけ諦める)', () => {
    const broken = 'こんにちは⁣lhqr:%%%';
    expect(extractQuickReply('text', broken)).toEqual({ content: 'こんにちは' });
  });
});

describe('カード型のボタンで「ボタンの動き」を使う', () => {
  test('保存すると postback (lh:act:) になり、読み込むと「ボタンの動き」に戻る', async () => {
    const { buildFlexJson, parseBuilderFlex, emptyFlexBuilderState, emptyFlexBuilderBubble } = await import('@line-crm/shared');
    const state = emptyFlexBuilderState();
    state.bubbles = [{
      ...emptyFlexBuilderBubble(),
      bodyText: '作成会のご案内です',
      buttons: [{ label: '詳しく知りたい', actionType: 'harness', actionValue: 'lh:act:act-1', style: 'primary' }],
    }];
    const json = buildFlexJson(state) as { footer: { contents: Array<{ action: Record<string, unknown> }> } };
    expect(json.footer.contents[0].action).toEqual({ type: 'postback', label: '詳しく知りたい', data: 'lh:act:act-1', displayText: '詳しく知りたい' });
    const parsed = parseBuilderFlex(JSON.stringify(json));
    expect(parsed?.bubbles[0].buttons[0]).toMatchObject({ actionType: 'harness', actionValue: 'lh:act:act-1' });
  });
});
