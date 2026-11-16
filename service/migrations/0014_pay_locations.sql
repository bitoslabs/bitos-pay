CREATE TABLE IF NOT EXISTS {{schema}}.merchant_locations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES {{schema}}.organizations(id),
  merchant_id text NOT NULL REFERENCES {{schema}}.merchants(id),
  name text NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (merchant_id, code)
);
CREATE INDEX IF NOT EXISTS merchant_locations_merchant
  ON {{schema}}.merchant_locations(merchant_id, created_at ASC);

ALTER TABLE {{schema}}.payment_intents
  ADD COLUMN IF NOT EXISTS location_id text REFERENCES {{schema}}.merchant_locations(id);

CREATE INDEX IF NOT EXISTS payment_intents_location
  ON {{schema}}.payment_intents(merchant_id, location_id, created_at DESC)
  WHERE location_id IS NOT NULL;
