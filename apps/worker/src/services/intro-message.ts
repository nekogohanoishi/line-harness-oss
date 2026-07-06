import type { MessageTemplate } from '@line-crm/db';

/**
 * LINE Messaging API message shape we send via push.
 * Subset to keep this module decoupled from the SDK.
 */
export type IntroMessage =
  | {
      type: 'text';
      text: string;
      quickReply?: {
        items: Array<{
          type: 'action';
          action: {
            type: 'postback';
            label: 'はい' | 'いいえ';
            data: string;
            displayText: 'はい' | 'いいえ';
          };
        }>;
      };
    }
  | { type: 'flex'; altText: string; contents: unknown }
  | {
      type: 'template';
      altText: string;
      template: {
        type: 'confirm';
        text: string;
        actions: [
          { type: 'postback'; label: 'はい'; data: string; displayText: 'はい' },
          { type: 'postback'; label: 'いいえ'; data: string; displayText: 'いいえ' },
        ];
      };
    };

export type InlineSurveyAnswer = 'yes' | 'no';

export interface InlineSurveyPostback {
  answer: InlineSurveyAnswer;
  answerLabel: 'はい' | 'いいえ';
  formId: string | null;
  ref: string | null;
}

const INLINE_SURVEY_POSTBACK_PREFIX = 'lh:survey';
const SURVEY_POSTBACK_PREFIX = 'lh:surveyform';
const REGISTRATION_SURVEY_POSTBACK_PREFIX = 'lh:regsurvey';
const DEFAULT_INLINE_SURVEY_TEXT = 'かんたんなアンケートです。興味はありますか？';
export const DEFAULT_REGISTRATION_SURVEY_GREETING_MESSAGE =
  '友だち追加ありがとうございます！\nまずは、あなたに合う案内をお届けするために、かんたんなアンケートにお答えください。';

export interface SurveyQuestion {
  name: string;
  label: string;
  options: string[];
}

export type RegistrationSurveyQuestion = SurveyQuestion;

export const REGISTRATION_SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    name: '目標試験',
    label: '今1番目指している試験はどれですか？',
    options: ['司法試験', '予備試験', '法科大学院入試', 'その他'],
  },
  {
    name: '現在の属性',
    label: '現在の属性はどれですか？',
    options: ['法科大学院生', '学部生', '社会人', '専業受験生'],
  },
  {
    name: '個別指導の興味',
    label: '個別指導に興味がありますか？',
    options: ['ある', 'ない'],
  },
  {
    name: '勉強相談の興味',
    label: '勉強の悩みを解決できる勉強相談に興味がありますか？',
    options: ['ある', 'ない'],
  },
];

export interface SurveyPostback {
  formId: string;
  questionIndex: number;
  answer: string;
}

export type RegistrationSurveyPostback = SurveyPostback;

function readFormUrlParam(formUrl: string, key: string): string {
  try {
    return new URL(formUrl).searchParams.get(key) ?? '';
  } catch {
    const queryIndex = formUrl.indexOf('?');
    if (queryIndex < 0) return '';
    return new URLSearchParams(formUrl.slice(queryIndex + 1)).get(key) ?? '';
  }
}

export function buildInlineSurveyPostbackData(
  formUrl: string,
  answer: InlineSurveyAnswer,
): string {
  const formId = encodeURIComponent(readFormUrlParam(formUrl, 'id'));
  const ref = encodeURIComponent(readFormUrlParam(formUrl, 'ref'));
  const base = `${INLINE_SURVEY_POSTBACK_PREFIX}:${answer}:${formId}`;
  const withRef = ref ? `${base}:${ref}` : base;
  return withRef.length <= 300 ? withRef : base;
}

export function parseInlineSurveyPostbackData(data: string): InlineSurveyPostback | null {
  const [prefix, kind, answer, encodedFormId = '', encodedRef = ''] = data.split(':');
  if (`${prefix}:${kind}` !== INLINE_SURVEY_POSTBACK_PREFIX) return null;
  if (answer !== 'yes' && answer !== 'no') return null;

  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const formId = decode(encodedFormId).trim();
  const ref = decode(encodedRef).trim();
  return {
    answer,
    answerLabel: answer === 'yes' ? 'はい' : 'いいえ',
    formId: formId || null,
    ref: ref || null,
  };
}

export function buildSurveyPostbackData(
  formId: string,
  questionIndex: number,
  answer: string,
): string {
  return [
    SURVEY_POSTBACK_PREFIX,
    encodeURIComponent(formId),
    String(questionIndex),
    encodeURIComponent(answer),
  ].join(':');
}

export function buildRegistrationSurveyPostbackData(
  formId: string,
  questionIndex: number,
  answer: string,
): string {
  return buildSurveyPostbackData(formId, questionIndex, answer);
}

export function parseSurveyPostbackData(data: string): SurveyPostback | null {
  const [prefix, kind, encodedFormId = '', rawIndex = '', encodedAnswer = ''] = data.split(':');
  const fullPrefix = `${prefix}:${kind}`;
  if (fullPrefix !== SURVEY_POSTBACK_PREFIX && fullPrefix !== REGISTRATION_SURVEY_POSTBACK_PREFIX) {
    return null;
  }
  const questionIndex = Number.parseInt(rawIndex, 10);
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= 50) {
    return null;
  }
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const formId = decode(encodedFormId).trim();
  const answer = decode(encodedAnswer).trim();
  if (!formId || !answer) return null;
  return { formId, questionIndex, answer };
}

export function parseRegistrationSurveyPostbackData(data: string): RegistrationSurveyPostback | null {
  return parseSurveyPostbackData(data);
}

export function normalizeSurveyQuestions(fields: unknown): SurveyQuestion[] {
  const rawFields = typeof fields === 'string'
    ? (() => {
        try {
          return JSON.parse(fields) as unknown;
        } catch {
          return [];
        }
      })()
    : fields;
  const rows = Array.isArray(rawFields) ? rawFields : [];
  const questions = rows
    .map((row): SurveyQuestion | null => {
      if (!row || typeof row !== 'object') return null;
      const record = row as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const label = typeof record.label === 'string' ? record.label.trim() : '';
      const options = Array.isArray(record.options)
        ? record.options
            .map((option) => typeof option === 'string' ? option.trim() : '')
            .filter(Boolean)
        : [];
      if (!name || !label || options.length === 0) return null;
      return { name, label, options };
    })
    .filter((question): question is SurveyQuestion => question !== null);
  return questions.length > 0 ? questions : [...REGISTRATION_SURVEY_QUESTIONS];
}

export function normalizeRegistrationSurveyQuestions(fields: unknown): RegistrationSurveyQuestion[] {
  return normalizeSurveyQuestions(fields);
}

export function normalizeRegistrationSurveyGreetingMessage(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 1000)
    : DEFAULT_REGISTRATION_SURVEY_GREETING_MESSAGE;
}

function normalizeSurveyAnswerValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function getSurveyAnswerDisplayValue(answer: string, question?: SurveyQuestion): string {
  if (question?.name.endsWith('の興味')) {
    if (answer === 'ある') return '興味あり';
    if (answer === 'ない') return '興味なし';
  }
  return answer;
}

function getSurveySummaryLabel(question: SurveyQuestion): string {
  const interestSuffix = 'の興味';
  return question.name.endsWith(interestSuffix)
    ? question.name.slice(0, -interestSuffix.length)
    : question.name;
}

export function buildSurveyAnswerConfirmationText(answer: string, question?: SurveyQuestion): string {
  return `回答：${getSurveyAnswerDisplayValue(answer, question)}`;
}

export function buildSurveyAnswerSummaryText(
  answers: Record<string, unknown>,
  questions: SurveyQuestion[],
): string {
  const normalized = normalizeSurveyQuestions(questions);
  const lines = normalized
    .map((question) => {
      const value = normalizeSurveyAnswerValue(answers[question.name]);
      return value
        ? `${getSurveySummaryLabel(question)}：${getSurveyAnswerDisplayValue(value, question)}`
        : null;
    })
    .filter((line): line is string => line !== null);

  return ['回答内容はこちらです', ...lines].join('\n');
}

export function buildSurveyAnswerLogText(question: SurveyQuestion, answer: string): string {
  return `アンケート回答\n${question.label}：${answer}`;
}

export function buildInlineSurveyAnswerLogText(payload: InlineSurveyPostback): string {
  return `アンケート回答\n${DEFAULT_INLINE_SURVEY_TEXT}：${payload.answerLabel}`;
}

export function buildSurveyQuestionMessageFromQuestions(
  formId: string,
  questionIndex: number,
  questions: SurveyQuestion[],
  title = 'アンケート',
): IntroMessage {
  const normalized = normalizeSurveyQuestions(questions);
  const question = normalized[questionIndex] ?? normalized[0];
  const total = normalized.length;
  const progressText = `【${questionIndex + 1}/${total}】`;
  return {
    type: 'flex',
    altText: `${title} ${progressText}${question.label}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: progressText,
            size: 'xs',
            color: '#06C755',
            weight: 'bold',
          },
          {
            type: 'text',
            text: question.label,
            size: 'lg',
            weight: 'bold',
            color: '#111827',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: question.options.map((option) => ({
          type: 'button',
          style: 'primary',
          color: '#06C755',
          height: 'sm',
          action: {
            type: 'postback',
            label: option,
            data: buildSurveyPostbackData(formId, questionIndex, option),
            displayText: option,
          },
        })),
      },
    },
  };
}

export function buildRegistrationSurveyQuestionMessageFromQuestions(
  formId: string,
  questionIndex: number,
  questions: RegistrationSurveyQuestion[],
): IntroMessage {
  return buildSurveyQuestionMessageFromQuestions(formId, questionIndex, questions);
}

export function buildRegistrationSurveyQuestionMessage(
  formId: string,
  questionIndex: number,
): IntroMessage {
  return buildSurveyQuestionMessageFromQuestions(
    formId,
    questionIndex,
    REGISTRATION_SURVEY_QUESTIONS,
  );
}

/**
 * Default inline survey sent when no intro template is configured.
 * The legacy name is kept because liff.ts/tests already use this helper, but
 * the behavior is now an in-chat yes/no answer instead of a link-out button.
 */
export function DEFAULT_FORM_LINK_FLEX(formUrl: string): IntroMessage {
  return {
    type: 'text',
    text: DEFAULT_INLINE_SURVEY_TEXT,
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'はい',
            data: buildInlineSurveyPostbackData(formUrl, 'yes'),
            displayText: 'はい',
          },
        },
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'いいえ',
            data: buildInlineSurveyPostbackData(formUrl, 'no'),
            displayText: 'いいえ',
          },
        },
      ],
    },
  };
}

/**
 * Build the push message sent to a friend right after they join via a
 * tracked-link campaign. The survey now stays inside LINE: the user taps
 * "はい" / "いいえ" and the webhook receives a postback. URL/Flex templates
 * are intentionally not used here because this step must not link the user to
 * a separate form page.
 */
export function buildIntroMessage(
  template: MessageTemplate | null,
  formUrl: string,
): IntroMessage {
  const message = DEFAULT_FORM_LINK_FLEX(formUrl);
  if (
    template?.message_type === 'text' &&
    template.message_content.trim() &&
    !template.message_content.includes('{formUrl}') &&
    message.type === 'text' &&
    message.quickReply
  ) {
    return {
      ...message,
      text: template.message_content.trim().slice(0, 240),
    };
  }

  return message;
}
