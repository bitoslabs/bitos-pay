ALTER TABLE {{schema}}.webhook_endpoints
  ADD COLUMN IF NOT EXISTS previous_secret_ciphertext text;

ALTER TABLE {{schema}}.webhook_endpoints
  ADD COLUMN IF NOT EXISTS previous_secret_expires_at timestamptz;
