import { describe, it, expect } from 'vitest';
import {
  REGISTRATION_SURVEY_QUESTIONS,
  buildSurveyAnswerConfirmationText,
  buildSurveyAnswerLogText,
  buildSurveyAnswerSummaryText,
  buildRegistrationSurveyPostbackData,
  buildInlineSurveyPostbackData,
  buildRegistrationSurveyQuestionMessage,
  buildIntroMessage,
  DEFAULT_FORM_LINK_FLEX,
  parseInlineSurveyPostbackData,
  parseRegistrationSurveyPostbackData,
} from './intro-message.js';
import type { MessageTemplate } from '@line-crm/db';

describe('buildIntroMessage', () => {
  const formUrl = 'https://liff.line.me/1234-AbCd?page=form&id=form-xyz&ref=route-1';

  it('テンプレート未指定の場合は LINE 内の yes/no アンケートを返す', () => {
    const result = buildIntroMessage(null, formUrl);
    expect(result).toEqual(DEFAULT_FORM_LINK_FLEX(formUrl));
  });

  it('text テンプレートは URL を含まない場合だけ質問文として使う', () => {
    const tpl: MessageTemplate = {
      id: 't1',
      name: 'intro text',
      message_type: 'text',
      message_content: 'この内容に興味はありますか？',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result.type).toBe('text');
    if (result.type !== 'text') throw new Error('unreachable');
    expect(result.text).toBe('この内容に興味はありますか？');
    expect(result.quickReply?.items).toHaveLength(2);
  });

  it('{formUrl} 付き text テンプレートでも別リンクにはしない', () => {
    const tpl: MessageTemplate = {
      id: 't2',
      name: 'old link text',
      message_type: 'text',
      message_content: '🎁 特典が届きました！\n受け取りはこちら👉 {formUrl}',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result).toEqual(DEFAULT_FORM_LINK_FLEX(formUrl));
    expect(JSON.stringify(result)).not.toContain(formUrl);
  });

  it('flex テンプレートでも別リンクにはせず yes/no アンケートにする', () => {
    const flexJson = JSON.stringify({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'タップして受け取る' }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '受け取る', uri: '{formUrl}' },
            style: 'primary',
          },
        ],
      },
    });
    const tpl: MessageTemplate = {
      id: 't3',
      name: 'intro flex',
      message_type: 'flex',
      message_content: flexJson,
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result).toEqual(DEFAULT_FORM_LINK_FLEX(formUrl));
    expect(JSON.stringify(result)).not.toContain('"uri"');
  });
});

describe('DEFAULT_FORM_LINK_FLEX', () => {
  it('formUrl から formId/ref を取り出して postback data に入れる', () => {
    const url = 'https://liff.line.me/abc?page=form&id=xyz&ref=abc-ref';
    const message = DEFAULT_FORM_LINK_FLEX(url);
    expect(message.type).toBe('text');
    if (message.type !== 'text') throw new Error('unreachable');
    expect(message.text).toBe('かんたんなアンケートです。興味はありますか？');
    expect(message.quickReply?.items[0]?.action).toMatchObject({
      type: 'postback',
      label: 'はい',
      data: 'lh:survey:yes:xyz:abc-ref',
      displayText: 'はい',
    });
    expect(message.quickReply?.items[1]?.action).toMatchObject({
      type: 'postback',
      label: 'いいえ',
      data: 'lh:survey:no:xyz:abc-ref',
      displayText: 'いいえ',
    });
    expect(JSON.stringify(message)).not.toContain('"uri"');
    expect(JSON.stringify(message)).not.toContain('liff.line.me');
    expect(JSON.stringify(message)).not.toContain('page=form');
  });
});

describe('inline survey postback data', () => {
  it('postback data を生成して復元できる', () => {
    const data = buildInlineSurveyPostbackData(
      'https://liff.line.me/abc?page=form&id=form%20id&ref=route%2F1',
      'yes',
    );
    expect(data).toBe('lh:survey:yes:form%20id:route%2F1');
    expect(parseInlineSurveyPostbackData(data)).toEqual({
      answer: 'yes',
      answerLabel: 'はい',
      formId: 'form id',
      ref: 'route/1',
    });
  });

  it('別用途の postback data は null を返す', () => {
    expect(parseInlineSurveyPostbackData('other:data')).toBeNull();
  });
});

describe('registration survey postback data', () => {
  it('汎用アンケート prefix を正しく復元できる', () => {
    const data = buildRegistrationSurveyPostbackData('form-1', 0, '司法試験');
    expect(data).toBe('lh:surveyform:form-1:0:%E5%8F%B8%E6%B3%95%E8%A9%A6%E9%A8%93');
    expect(parseRegistrationSurveyPostbackData(data)).toEqual({
      formId: 'form-1',
      questionIndex: 0,
      answer: '司法試験',
    });
  });

  it('旧 lh:regsurvey prefix も後方互換で復元できる', () => {
    expect(parseRegistrationSurveyPostbackData('lh:regsurvey:form-1:0:%E5%8F%B8%E6%B3%95%E8%A9%A6%E9%A8%93')).toEqual({
      formId: 'form-1',
      questionIndex: 0,
      answer: '司法試験',
    });
  });

  it('GUIで質問を増やした場合の5問目以降も復元できる', () => {
    const data = buildRegistrationSurveyPostbackData('form-1', 4, '追加の回答');
    expect(parseRegistrationSurveyPostbackData(data)).toEqual({
      formId: 'form-1',
      questionIndex: 4,
      answer: '追加の回答',
    });
  });

  it('質問文は疑問文にする', () => {
    const message = buildRegistrationSurveyQuestionMessage('form-1', 0);
    expect(message.type).toBe('flex');
    if (message.type !== 'flex') throw new Error('unreachable');
    expect(JSON.stringify(message.contents)).toContain('今1番目指している試験はどれですか？');
    expect(JSON.stringify(message.contents)).toContain('【1/4】');
  });

  it('回答後に返す確認文を生成できる', () => {
    expect(buildSurveyAnswerConfirmationText('司法試験')).toBe('回答：司法試験');
    expect(buildSurveyAnswerConfirmationText('ある', REGISTRATION_SURVEY_QUESTIONS[2]!)).toBe('回答：興味あり');
  });

  it('最後に返す回答まとめを生成できる', () => {
    expect(buildSurveyAnswerSummaryText(
      {
        目標試験: '司法試験',
        現在の属性: '社会人',
        個別指導の興味: 'ある',
        勉強相談の興味: 'ある',
      },
      REGISTRATION_SURVEY_QUESTIONS,
    )).toBe([
      '回答内容はこちらです',
      '目標試験：司法試験',
      '現在の属性：社会人',
      '個別指導：興味あり',
      '勉強相談：興味あり',
    ].join('\n'));
  });

  it('管理画面向けの回答ログを日本語で生成できる', () => {
    expect(buildSurveyAnswerLogText(REGISTRATION_SURVEY_QUESTIONS[0]!, '司法試験')).toBe(
      'アンケート回答\n今1番目指している試験はどれですか？：司法試験',
    );
  });
});
