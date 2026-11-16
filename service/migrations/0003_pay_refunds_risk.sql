ALTER TABLE {{schema}}.merchants
  ADD COLUMN IF NOT EXISTS max_payment_msat bigint NOT NULL DEFAULT 100000000
    CHECK (max_payment_msat > 0),
  ADD COLUMN IF NOT EXISTS daily_volume_msat bigint NOT NULL DEFAULT 1000000000
    CHECK (daily_volume_msat > 0),
  ADD COLUMN IF NOT EXISTS max_payments_per_minute integer NOT NULL DEFAULT 60
    CHECK (max_payments_per_minute > 0);

CREATE TABLE IF NOT EXISTS {{schema}}.refunds (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  transaction_id text NOT NULL REFERENCES {{schema}}.transactions(id),
  payment_intent_id text NOT NULL REFERENCES {{schema}}.payment_intents(id),
  amount_msat bigint NOT NULL CHECK (amount_msat > 0),
  fee_msat bigint NOT NULL DEFAULT 0 CHECK (fee_msat >= 0),
  net_msat bigint NOT NULL CHECK (net_msat >= 0),
  currency text NOT NULL,
  scale integer NOT NULL,
  reason text,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  livemode boolean NOT NULL,
  created_at timestamptz NOT NULL,
  settled_at timestamptz,
  CHECK (fee_msat + net_msat = amount_msat)
);
CREATE INDEX IF NOT EXISTS refunds_merchant_created
  ON {{schema}}.refunds(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_transaction
  ON {{schema}}.refunds(transaction_id);

ALTER TABLE {{schema}}.ledger_entries
  ADD COLUMN IF NOT EXISTS refund_id text REFERENCES {{schema}}.refunds(id);
CREATE INDEX IF NOT EXISTS ledger_entries_refund
  ON {{schema}}.ledger_entries(refund_id) WHERE refund_id IS NOT NULL;
