import { describe, expect, test } from 'vitest';
import { normalizeRegistrationSurveyConfig } from './registration-survey-config.js';

describe('normalizeRegistrationSurveyConfig', () => {
  test('設定がない場合は既存の登録時アンケートを最初の候補にする', () => {
    expect(normalizeRegistrationSurveyConfig(null, { formId: 'legacy', isActive: false })).toEqual({
      candidateFormIds: ['legacy'],
      selectedFormId: 'legacy',
      isActive: false,
    });
  });

  test('複数候補を重複なく保存し、選択中フォームを候補へ含める', () => {
    expect(normalizeRegistrationSurveyConfig({
      candidateFormIds: ['survey-1', 'survey-1', 'survey-2'],
      selectedFormId: 'survey-3',
      isActive: true,
    }, { formId: 'legacy', isActive: false })).toEqual({
      candidateFormIds: ['survey-1', 'survey-2', 'survey-3'],
      selectedFormId: 'survey-3',
      isActive: true,
    });
  });

  test('保存済み候補から削除された旧フォームを再追加しない', () => {
    expect(normalizeRegistrationSurveyConfig({
      candidateFormIds: ['survey-2'],
      selectedFormId: 'survey-2',
      isActive: false,
    }, { formId: 'legacy', isActive: false })).toEqual({
      candidateFormIds: ['survey-2'],
      selectedFormId: 'survey-2',
      isActive: false,
    });
  });

  test('壊れた設定は既存フォームへ安全に戻す', () => {
    expect(normalizeRegistrationSurveyConfig({
      candidateFormIds: [null, '', 123],
      selectedFormId: null,
      isActive: 'yes',
    }, { formId: 'legacy', isActive: true })).toEqual({
      candidateFormIds: ['legacy'],
      selectedFormId: 'legacy',
      isActive: true,
    });
  });
});
