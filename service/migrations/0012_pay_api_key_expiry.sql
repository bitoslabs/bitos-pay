ALTER TABLE {{schema}}.api_keys
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS api_keys_expiry
  ON {{schema}}.api_keys(expires_at)
  WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;
