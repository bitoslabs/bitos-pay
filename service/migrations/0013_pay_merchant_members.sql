ALTER TABLE {{schema}}.api_keys
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'api'
    CHECK (kind IN ('api', 'member'));

ALTER TABLE {{schema}}.console_nostr_identities
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'OWNER'
    CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'VIEWER')),
  ADD COLUMN IF NOT EXISTS label text;

CREATE INDEX IF NOT EXISTS api_keys_member
  ON {{schema}}.api_keys(merchant_id, created_at DESC)
  WHERE kind = 'member';

CREATE INDEX IF NOT EXISTS console_nostr_identities_role
  ON {{schema}}.console_nostr_identities(merchant_id, role, status);
