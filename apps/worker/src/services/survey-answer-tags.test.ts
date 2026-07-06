import { describe, expect, test } from 'vitest';
import { resolveSurveyAnswerTags } from './survey-answer-tags.js';

describe('resolveSurveyAnswerTags', () => {
  test('登録時アンケート4問の回答から対応タグを解決する', () => {
    const tags = resolveSurveyAnswerTags(
      {
        目標試験: '司法試験',
        現在の属性: '社会人',
        個別指導の興味: '話を聞いてみたい',
        勉強相談の興味: 'ある',
      },
      [
        { name: '目標試験', label: '今1番目指している試験はどれですか？' },
        { name: '現在の属性', label: '現在の属性はどれですか？' },
        { name: '個別指導の興味', label: '個別指導に興味がありますか？' },
        { name: '勉強相談の興味', label: '勉強の悩みを解決できる勉強相談に興味がありますか？' },
      ],
    );

    expect(tags.map((tag) => tag.tagName)).toEqual([
      '目標_司法試験',
      '属性_社会人',
      '指導_様子見',
      '相談_興味あり',
    ]);
  });

  test('質問名が変わっても表示文からカテゴリを推定する', () => {
    const tags = resolveSurveyAnswerTags(
      {
        q1: '予備試験',
        q2: '法科大学院生',
        q3: '今はない',
        q4: 'ない',
      },
      [
        { name: 'q1', label: '今1番目指している試験はどれですか？' },
        { name: 'q2', label: '現在の属性はどれですか？' },
        { name: 'q3', label: '個別指導に興味がありますか？' },
        { name: 'q4', label: '勉強相談に興味がありますか？' },
      ],
    );

    expect(tags.map((tag) => tag.tagName)).toEqual([
      '目標_予備試験',
      '属性_法科大学院生',
      '指導_不要',
      '相談_不要',
    ]);
  });

  test('未定義の質問と選択肢はタグ化しない', () => {
    const tags = resolveSurveyAnswerTags({
      好きな科目: '民法',
      目標試験: '未定義の試験',
    });

    expect(tags).toEqual([]);
  });
});
