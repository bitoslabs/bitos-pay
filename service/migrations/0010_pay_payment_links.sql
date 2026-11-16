CREATE TABLE IF NOT EXISTS {{schema}}.payment_links (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  amount_msat bigint NOT NULL CHECK (amount_msat > 0),
  currency text NOT NULL,
  scale integer NOT NULL CHECK (scale >= 0 AND scale <= 12),
  reference text,
  label text,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL,
  disabled_at timestamptz
);
CREATE INDEX IF NOT EXISTS payment_links_merchant_created
  ON {{schema}}.payment_links(merchant_id, created_at DESC);
