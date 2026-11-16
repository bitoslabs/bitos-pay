CREATE TABLE IF NOT EXISTS {{schema}}.console_nostr_identities (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  api_key_id text NOT NULL REFERENCES {{schema}}.api_keys(id),
  pubkey text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (pubkey ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS console_nostr_identities_merchant
  ON {{schema}}.console_nostr_identities(merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS {{schema}}.console_nostr_challenges (
  id text PRIMARY KEY,
  challenge_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('LOGIN', 'LINK')),
  merchant_id text REFERENCES {{schema}}.merchants(id),
  session_id text REFERENCES {{schema}}.console_sessions(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (
    (purpose = 'LOGIN' AND merchant_id IS NULL AND session_id IS NULL)
    OR (purpose = 'LINK' AND merchant_id IS NOT NULL AND session_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS console_nostr_challenges_expiry
  ON {{schema}}.console_nostr_challenges(expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE {{schema}}.console_sessions
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'api_key'
    CHECK (auth_method IN ('api_key', 'nostr')),
  ADD COLUMN IF NOT EXISTS nostr_pubkey text;
