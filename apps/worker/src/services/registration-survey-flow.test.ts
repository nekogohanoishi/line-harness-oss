import { describe, expect, test } from 'vitest';
import { getRegistrationSurveyFlowState } from './registration-survey-flow.js';

describe('getRegistrationSurveyFlowState', () => {
  test('アンケート有効時は挨拶シナリオを有効にしてアンケートステップを含める', () => {
    expect(getRegistrationSurveyFlowState(true)).toEqual({
      scenarioIsActive: true,
      includeSurveyStep: true,
      description: '友だち追加・ブロック解除時に、挨拶のあと登録時アンケートを送る',
    });
  });

  test('アンケート無効時も挨拶シナリオは有効のままアンケートステップだけを外す', () => {
    expect(getRegistrationSurveyFlowState(false)).toEqual({
      scenarioIsActive: true,
      includeSurveyStep: false,
      description: '友だち追加・ブロック解除時に挨拶だけを送る',
    });
  });
});
