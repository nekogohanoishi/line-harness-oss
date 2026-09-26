CREATE INDEX IF NOT EXISTS idx_health_logs_account_created_at
  ON account_health_logs (line_account_id, created_at DESC);

DROP INDEX IF EXISTS idx_health_logs_account;
