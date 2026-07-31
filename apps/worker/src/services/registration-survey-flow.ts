export type RegistrationSurveyFlowState = {
  scenarioIsActive: true;
  includeSurveyStep: boolean;
  description: string;
};

export function getRegistrationSurveyFlowState(
  surveyIsActive: boolean,
): RegistrationSurveyFlowState {
  return {
    scenarioIsActive: true,
    includeSurveyStep: surveyIsActive,
    description: surveyIsActive
      ? '友だち追加・ブロック解除時に、挨拶のあと登録時アンケートを送る'
      : '友だち追加・ブロック解除時に挨拶だけを送る',
  };
}
