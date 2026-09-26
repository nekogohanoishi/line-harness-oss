import { describe, expect, it } from 'vitest';
import {
  collectFlexButtonFields,
  collectFlexTextFields,
  getDeliveryMode,
  parseSequenceDocument,
  setDeliveryMode,
  stringifySequenceDocument,
  updateFlexButton,
  updateJsonAtPath,
} from '../../../web/src/components/auto-replies/auto-reply-editor-utils.js';

const customFlex = {
  type: 'bubble',
  size: 'mega',
  header: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: '公式LINE登録者限定・1回無料' },
      { type: 'text', text: 'ロードマップ作成会' },
    ],
  },
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: '解説速報はもうご覧いただけましたか。' },
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '現在地' },
          { type: 'text', text: '→' },
          { type: 'text', text: '優先順位' },
        ],
      },
    ],
  },
  footer: {
    type: 'box',
    layout: 'vertical',
    contents: [{
      type: 'button',
      action: {
        type: 'message',
        label: '作成会の詳しい案内を見る',
        text: 'ロードマップ作成会について',
      },
    }],
  },
};

describe('auto reply sequence editor data', () => {
  it('loads the current immediate + scheduled Flex flow without exposing nested JSON', () => {
    const raw = JSON.stringify({
      messages: [
        { messageType: 'text', messageContent: '速報本文', delaySeconds: 0 },
        {
          messageType: 'flex',
          messageContent: JSON.stringify(customFlex),
          deliveryTimeJst: '20:00',
          sameDayCutoffTimeJst: '18:00',
        },
      ],
    });

    const document = parseSequenceDocument(raw);
    expect(document.messages).toHaveLength(2);
    expect(getDeliveryMode(document.messages[0])).toBe('immediate');
    expect(getDeliveryMode(document.messages[1])).toBe('clock');
    expect(document.messages[1].deliveryTimeJst).toBe('20:00');
    expect(parseSequenceDocument(stringifySequenceDocument(document))).toEqual(document);
  });

  it('edits custom Flex text while preserving its layout', () => {
    const fields = collectFlexTextFields(customFlex);
    expect(fields.map((field) => field.text)).toEqual([
      '公式LINE登録者限定・1回無料',
      'ロードマップ作成会',
      '解説速報はもうご覧いただけましたか。',
      '現在地',
      '優先順位',
    ]);

    const title = fields.find((field) => field.text === 'ロードマップ作成会')!;
    const updated = updateJsonAtPath(customFlex, title.path, '新しい見出し');
    expect((updated.header.contents[1] as { text: string }).text).toBe('新しい見出し');
    expect(customFlex.header.contents[1].text).toBe('ロードマップ作成会');
    expect(updated.body).toEqual(customFlex.body);
  });

  it('edits the visible button label and sent message together', () => {
    const button = collectFlexButtonFields(customFlex)[0];
    const updated = updateFlexButton(customFlex, button, {
      label: '詳しく見る',
      actionValue: '作成会について',
    }) as typeof customFlex;
    expect(updated.footer.contents[0].action).toEqual({
      type: 'message',
      label: '詳しく見る',
      text: '作成会について',
    });
  });

  it('switches timing modes without leaving conflicting fields', () => {
    const scheduled = {
      messageType: 'text' as const,
      messageContent: 'x',
      deliveryTimeJst: '20:00',
      sameDayCutoffTimeJst: '18:00',
    };
    expect(setDeliveryMode(scheduled, 'delay')).toEqual({
      messageType: 'text',
      messageContent: 'x',
      delaySeconds: 60,
    });
  });
});
