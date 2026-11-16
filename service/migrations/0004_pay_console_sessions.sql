CREATE TABLE IF NOT EXISTS {{schema}}.console_sessions (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  api_key_id text NOT NULL REFERENCES {{schema}}.api_keys(id),
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  livemode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS console_sessions_merchant
  ON {{schema}}.console_sessions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS console_sessions_expiry
  ON {{schema}}.console_sessions(expires_at) WHERE revoked_at IS NULL;
