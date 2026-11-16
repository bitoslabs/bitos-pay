CREATE TABLE IF NOT EXISTS {{schema}}.plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  features jsonb NOT NULL,
  limits jsonb NOT NULL,
  price_msat bigint NOT NULL CHECK (price_msat >= 0),
  currency text NOT NULL DEFAULT 'SAT',
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS {{schema}}.subscriptions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  plan_code text NOT NULL REFERENCES {{schema}}.plans(code),
  status text NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REFUNDED')),
  provider_reference text,
  payment_hash text,
  bolt11 text,
  amount_msat bigint NOT NULL CHECK (amount_msat > 0),
  currency text NOT NULL,
  expires_at timestamptz NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS subscriptions_org ON {{schema}}.subscriptions(organization_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_reference
  ON {{schema}}.subscriptions(provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_payment_hash
  ON {{schema}}.subscriptions(payment_hash)
  WHERE payment_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS {{schema}}.entitlements (
  id text PRIMARY KEY,
  organization_id text NOT NULL UNIQUE REFERENCES {{schema}}.organizations(id),
  subscription_id text REFERENCES {{schema}}.subscriptions(id),
  plan_code text NOT NULL REFERENCES {{schema}}.plans(code),
  features jsonb NOT NULL,
  limits jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'GRACE', 'EXPIRED', 'REVOKED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS entitlements_org ON {{schema}}.entitlements(organization_id);

INSERT INTO {{schema}}.plans (code, name, version, features, limits, price_msat, currency, status, created_at)
VALUES
  ('workspace_free', 'Workspace Free', 1, '["core"]'::jsonb, '{"members":5,"retention_days":30,"ai_collaborators":0}'::jsonb, 0, 'SAT', 'ACTIVE', now()),
  ('workspace_pro', 'Workspace Pro', 1, '["core","audit_export","advanced_roles"]'::jsonb, '{"members":25,"retention_days":365,"ai_collaborators":1}'::jsonb, 10000000, 'SAT', 'ACTIVE', now()),
  ('workspace_business', 'Workspace Business', 1, '["core","audit_export","advanced_roles","sso"]'::jsonb, '{"members":100,"retention_days":730,"ai_collaborators":5}'::jsonb, 29000000, 'SAT', 'ACTIVE', now())
ON CONFLICT (code) DO NOTHING;
