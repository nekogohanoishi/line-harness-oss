import { jstNow } from '@line-crm/db';

export type SurveyTagQuestion = {
  name: string;
  label?: string;
};

export type SurveyAnswerTag = {
  category: string;
  tagName: string;
  sourceKey: string;
  answer: string;
};

type SurveyAnswerTagRule = {
  category: string;
  matchKeys: string[];
  valueToTag: Record<string, string>;
};

const SURVEY_TAG_RULES: SurveyAnswerTagRule[] = [
  {
    category: 'goal',
    matchKeys: ['目標試験', '今1番目指している試験'],
    valueToTag: {
      司法試験: '目標_司法試験',
      予備試験: '目標_予備試験',
      法科大学院入試: '目標_法科大学院入試',
      その他: '目標_その他',
    },
  },
  {
    category: 'attribute',
    matchKeys: ['現在の属性', '属性'],
    valueToTag: {
      法科大学院生: '属性_法科大学院生',
      学部生: '属性_学部生',
      社会人: '属性_社会人',
      専業受験生: '属性_専業受験生',
    },
  },
  {
    category: 'coaching_interest',
    matchKeys: ['個別指導の興味', '個別指導'],
    valueToTag: {
      ある: '指導_興味あり',
      興味がある: '指導_興味あり',
      興味あり: '指導_興味あり',
      話を聞いてみたい: '指導_様子見',
      様子見: '指導_様子見',
      ない: '指導_不要',
      今はない: '指導_不要',
      不要: '指導_不要',
    },
  },
  {
    category: 'study_history',
    matchKeys: ['学習歴', '法律の学習歴'],
    valueToTag: {
      これから始める: '学習歴_これから',
      '1年未満': '学習歴_1年未満',
      '1〜3年': '学習歴_1-3年',
      '3年以上': '学習歴_3年以上',
    },
  },
  {
    category: 'consultation_interest',
    matchKeys: ['勉強相談の興味', '勉強相談'],
    valueToTag: {
      ある: '相談_興味あり',
      興味がある: '相談_興味あり',
      興味あり: '相談_興味あり',
      ない: '相談_不要',
      今はない: '相談_不要',
      不要: '相談_不要',
    },
  },
];

function normalizeKey(value: string): string {
  return value.replace(/[？?\s]/g, '').trim();
}

function normalizeAnswerValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeAnswerValue(item));
  }
  if (value === null || value === undefined) return [];
  const normalized = String(value).trim();
  return normalized ? [normalized] : [];
}

function findRule(questionName: string, questionLabel?: string): SurveyAnswerTagRule | null {
  const normalizedName = normalizeKey(questionName);
  const normalizedLabel = questionLabel ? normalizeKey(questionLabel) : '';
  return SURVEY_TAG_RULES.find((rule) =>
    rule.matchKeys.some((key) => {
      const normalizedKey = normalizeKey(key);
      return normalizedName === normalizedKey ||
        normalizedName.includes(normalizedKey) ||
        normalizedLabel === normalizedKey ||
        normalizedLabel.includes(normalizedKey);
    }),
  ) ?? null;
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function resolveSurveyAnswerTags(
  answers: Record<string, unknown>,
  questions: SurveyTagQuestion[] = [],
): SurveyAnswerTag[] {
  const questionByName = new Map(questions.map((question) => [question.name, question]));
  const resolved: SurveyAnswerTag[] = [];

  for (const [sourceKey, rawValue] of Object.entries(answers)) {
    const question = questionByName.get(sourceKey);
    const rule = findRule(sourceKey, question?.label);
    if (!rule) continue;

    for (const answer of normalizeAnswerValue(rawValue)) {
      const tagName = rule.valueToTag[answer];
      if (!tagName) continue;
      resolved.push({
        category: rule.category,
        tagName,
        sourceKey,
        answer,
      });
    }
  }

  const seen = new Set<string>();
  return resolved.filter((item) => {
    const key = `${item.category}:${item.tagName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function ensureTagByName(db: D1Database, tagName: string): Promise<string> {
  const now = jstNow();
  await db
    .prepare(`INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), tagName, '#3B82F6', now)
    .run();

  const row = await db
    .prepare(`SELECT id FROM tags WHERE name = ?`)
    .bind(tagName)
    .first<{ id: string }>();
  if (!row) {
    throw new Error(`Failed to ensure survey answer tag: ${tagName}`);
  }
  return row.id;
}

async function removeCategoryTags(db: D1Database, friendId: string, tagNames: string[]): Promise<void> {
  const uniqueTagNames = uniqueValues(tagNames);
  if (uniqueTagNames.length === 0) return;
  const placeholders = uniqueTagNames.map(() => '?').join(', ');
  await db
    .prepare(
      `DELETE FROM friend_tags
       WHERE friend_id = ?
         AND tag_id IN (SELECT id FROM tags WHERE name IN (${placeholders}))`,
    )
    .bind(friendId, ...uniqueTagNames)
    .run();
}

function allTagNamesForCategory(category: string): string[] {
  const rule = SURVEY_TAG_RULES.find((item) => item.category === category);
  return rule ? uniqueValues(Object.values(rule.valueToTag)) : [];
}

export async function applySurveyAnswerTags(
  db: D1Database,
  friendId: string,
  answers: Record<string, unknown>,
  questions: SurveyTagQuestion[] = [],
): Promise<SurveyAnswerTag[]> {
  const resolved = resolveSurveyAnswerTags(answers, questions);
  if (resolved.length === 0) return [];

  for (const category of uniqueValues(resolved.map((item) => item.category))) {
    await removeCategoryTags(db, friendId, allTagNamesForCategory(category));
  }

  const now = jstNow();
  for (const tagName of uniqueValues(resolved.map((item) => item.tagName))) {
    const tagId = await ensureTagByName(db, tagName);
    await db
      .prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`)
      .bind(friendId, tagId, now)
      .run();
  }

  return resolved;
}
