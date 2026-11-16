CREATE TABLE IF NOT EXISTS {{schema}}.organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  country text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS {{schema}}.merchants (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED')),
  default_currency text NOT NULL DEFAULT 'SAT',
  fee_bps integer NOT NULL DEFAULT 0 CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS merchants_org ON {{schema}}.merchants(organization_id);

CREATE TABLE IF NOT EXISTS {{schema}}.provider_connections (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  provider text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('sandbox', 'live')),
  status text NOT NULL CHECK (status IN ('UNVERIFIED', 'ACTIVE', 'DEGRADED', 'DISABLED')),
  credential_ref text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_connections_org ON {{schema}}.provider_connections(organization_id);

CREATE TABLE IF NOT EXISTS {{schema}}.api_keys (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  livemode boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS api_keys_merchant ON {{schema}}.api_keys(merchant_id);

CREATE TABLE IF NOT EXISTS {{schema}}.payment_intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  provider_connection_id text NOT NULL REFERENCES {{schema}}.provider_connections(id),
  external_reference text,
  amount_msat bigint NOT NULL CHECK (amount_msat > 0),
  currency text NOT NULL,
  scale integer NOT NULL CHECK (scale >= 0 AND scale <= 12),
  status text NOT NULL CHECK (status IN ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  retry_of_intent_id text REFERENCES {{schema}}.payment_intents(id),
  livemode boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_intents_merchant_created ON {{schema}}.payment_intents(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_intents_due ON {{schema}}.payment_intents(expires_at) WHERE status IN ('CREATED', 'PENDING');

CREATE TABLE IF NOT EXISTS {{schema}}.payment_attempts (
  id text PRIMARY KEY,
  payment_intent_id text NOT NULL REFERENCES {{schema}}.payment_intents(id),
  provider_connection_id text NOT NULL REFERENCES {{schema}}.provider_connections(id),
  provider_reference text,
  status text NOT NULL CHECK (status IN ('CREATED', 'INVOICE_ISSUED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'QUARANTINED')),
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_attempts_intent ON {{schema}}.payment_attempts(payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_successful_attempt ON {{schema}}.payment_attempts(payment_intent_id) WHERE status = 'SUCCEEDED';

CREATE TABLE IF NOT EXISTS {{schema}}.invoices (
  id text PRIMARY KEY,
  payment_attempt_id text NOT NULL UNIQUE REFERENCES {{schema}}.payment_attempts(id),
  payment_hash text NOT NULL UNIQUE,
  bolt11 text NOT NULL,
  amount_msat bigint NOT NULL CHECK (amount_msat > 0),
  status text NOT NULL CHECK (status IN ('ISSUED', 'SETTLED', 'EXPIRED', 'CANCELLED', 'QUARANTINED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS invoices_status_expiry ON {{schema}}.invoices(status, expires_at);

CREATE TABLE IF NOT EXISTS {{schema}}.transactions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  payment_attempt_id text NOT NULL UNIQUE REFERENCES {{schema}}.payment_attempts(id),
  provider_connection_id text NOT NULL REFERENCES {{schema}}.provider_connections(id),
  provider_reference text NOT NULL,
  payment_hash text NOT NULL UNIQUE,
  amount_msat bigint NOT NULL CHECK (amount_msat > 0),
  fee_msat bigint NOT NULL DEFAULT 0 CHECK (fee_msat >= 0),
  net_msat bigint NOT NULL CHECK (net_msat >= 0),
  currency text NOT NULL,
  scale integer NOT NULL,
  status text NOT NULL CHECK (status IN ('DETECTED', 'CONFIRMED', 'SETTLED', 'REVERSED')),
  settled_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (provider_connection_id, provider_reference),
  CHECK (fee_msat + net_msat = amount_msat)
);
CREATE INDEX IF NOT EXISTS transactions_merchant_created ON {{schema}}.transactions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_created ON {{schema}}.transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS {{schema}}.fees (
  id text PRIMARY KEY,
  transaction_id text NOT NULL UNIQUE REFERENCES {{schema}}.transactions(id),
  rule_ref text NOT NULL,
  basis text NOT NULL,
  amount_msat bigint NOT NULL CHECK (amount_msat >= 0),
  currency text NOT NULL,
  scale integer NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS {{schema}}.ledger_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  code text NOT NULL,
  type text NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY')),
  currency text NOT NULL,
  scale integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, code, currency, scale)
);

CREATE TABLE IF NOT EXISTS {{schema}}.ledger_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  transaction_id text NOT NULL REFERENCES {{schema}}.transactions(id),
  account_id text NOT NULL REFERENCES {{schema}}.ledger_accounts(id),
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_msat bigint NOT NULL CHECK (amount_msat > 0),
  currency text NOT NULL,
  scale integer NOT NULL,
  posted_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_transaction ON {{schema}}.ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON {{schema}}.ledger_entries(account_id, posted_at);

CREATE TABLE IF NOT EXISTS {{schema}}.provider_events (
  id text PRIMARY KEY,
  provider_connection_id text NOT NULL REFERENCES {{schema}}.provider_connections(id),
  provider_event_id text NOT NULL,
  payment_hash text,
  status text NOT NULL CHECK (status IN ('ACCEPTED', 'DUPLICATE', 'QUARANTINED', 'REJECTED')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL,
  UNIQUE (provider_connection_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS {{schema}}.webhook_endpoints (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  url text NOT NULL,
  secret_ciphertext text NOT NULL,
  events jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_merchant ON {{schema}}.webhook_endpoints(merchant_id);

CREATE TABLE IF NOT EXISTS {{schema}}.webhook_deliveries (
  id text PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES {{schema}}.webhook_endpoints(id),
  event_id text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED', 'DEAD')),
  attempt integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  response_code integer,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (endpoint_id, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON {{schema}}.webhook_deliveries(next_attempt_at) WHERE status IN ('PENDING', 'FAILED');

CREATE TABLE IF NOT EXISTS {{schema}}.outbox_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  type text NOT NULL,
  api_version text NOT NULL,
  livemode boolean NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_events_unpublished ON {{schema}}.outbox_events(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS {{schema}}.idempotency_keys (
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  endpoint text NOT NULL,
  key text NOT NULL,
  request_digest text NOT NULL,
  status integer NOT NULL,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (merchant_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS {{schema}}.audit_logs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  actor_ref text NOT NULL,
  action text NOT NULL,
  target_ref text NOT NULL,
  result text NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_org_occurred ON {{schema}}.audit_logs(organization_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS {{schema}}.exchange_quotes (
  id text PRIMARY KEY,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate text NOT NULL,
  source text NOT NULL,
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS {{schema}}.settlements (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  gross_msat bigint NOT NULL,
  fees_msat bigint NOT NULL,
  net_msat bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED')),
  created_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION {{schema}}.reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_immutable ON {{schema}}.ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON {{schema}}.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_ledger_mutation();

CREATE OR REPLACE FUNCTION {{schema}}.assert_ledger_balanced() RETURNS trigger AS $$
DECLARE
  debit bigint;
  credit bigint;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_msat ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_msat ELSE 0 END), 0)
  INTO debit, credit
  FROM {{schema}}.ledger_entries
  WHERE transaction_id = NEW.transaction_id;

  IF debit <> credit THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced', NEW.transaction_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_balanced ON {{schema}}.ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON {{schema}}.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.assert_ledger_balanced();
