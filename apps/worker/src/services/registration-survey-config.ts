import { jstNow } from '@line-crm/db';

export const REGISTRATION_SURVEY_SETTING_KEY = 'registration_survey';

export type RegistrationSurveyConfig = {
  candidateFormIds: string[];
  selectedFormId: string | null;
  isActive: boolean;
};

type RegistrationSurveyConfigFallback = {
  formId: string | null;
  isActive: boolean;
};

export function normalizeRegistrationSurveyConfig(
  value: unknown,
  fallback: RegistrationSurveyConfigFallback,
): RegistrationSurveyConfig {
  const input = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const candidates = Array.isArray(input.candidateFormIds)
    ? input.candidateFormIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const configuredSelected = typeof input.selectedFormId === 'string' && input.selectedFormId.trim()
    ? input.selectedFormId.trim()
    : null;
  const selected = configuredSelected ?? candidates[0] ?? fallback.formId;
  const candidateFormIds = [...new Set([
    ...candidates,
    ...(selected ? [selected] : []),
  ])];

  return {
    candidateFormIds,
    selectedFormId: selected,
    isActive: typeof input.isActive === 'boolean' ? input.isActive : fallback.isActive,
  };
}

export async function loadRegistrationSurveyConfig(
  db: D1Database,
  accountId: string,
  fallback: RegistrationSurveyConfigFallback,
): Promise<RegistrationSurveyConfig> {
  const row = await db
    .prepare(
      `SELECT value FROM account_settings
       WHERE line_account_id = ? AND key = ?`,
    )
    .bind(accountId, REGISTRATION_SURVEY_SETTING_KEY)
    .first<{ value: string }>();
  if (!row) return normalizeRegistrationSurveyConfig(null, fallback);

  try {
    return normalizeRegistrationSurveyConfig(JSON.parse(row.value), fallback);
  } catch {
    return normalizeRegistrationSurveyConfig(null, fallback);
  }
}

export async function saveRegistrationSurveyConfig(
  db: D1Database,
  accountId: string,
  config: RegistrationSurveyConfig,
): Promise<void> {
  const now = jstNow();
  const value = JSON.stringify(config);
  await db
    .prepare(
      `INSERT INTO account_settings
       (id, line_account_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (line_account_id, key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      accountId,
      REGISTRATION_SURVEY_SETTING_KEY,
      value,
      now,
      now,
    )
    .run();
}
