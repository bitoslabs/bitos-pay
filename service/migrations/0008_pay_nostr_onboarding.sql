ALTER TABLE {{schema}}.organizations
  ADD COLUMN IF NOT EXISTS owner_pubkey text;

CREATE INDEX IF NOT EXISTS organizations_owner_pubkey
  ON {{schema}}.organizations(owner_pubkey)
  WHERE owner_pubkey IS NOT NULL;

CREATE TABLE IF NOT EXISTS {{schema}}.onboarding_challenges (
  id text PRIMARY KEY,
  challenge_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS onboarding_challenges_expiry
  ON {{schema}}.onboarding_challenges(expires_at)
  WHERE consumed_at IS NULL;
