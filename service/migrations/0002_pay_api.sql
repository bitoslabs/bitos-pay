ALTER TABLE {{schema}}.exchange_quotes
  ADD COLUMN IF NOT EXISTS base_amount bigint,
  ADD COLUMN IF NOT EXISTS quote_amount bigint;

CREATE INDEX IF NOT EXISTS exchange_quotes_expiry
  ON {{schema}}.exchange_quotes(expires_at);

ALTER TABLE {{schema}}.settlements
  ADD COLUMN IF NOT EXISTS transaction_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ledger_balanced boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS settlements_merchant_period
  ON {{schema}}.settlements(merchant_id, period_start DESC);
