ALTER TABLE {{schema}}.api_keys
  ADD COLUMN IF NOT EXISTS label text;

CREATE TABLE IF NOT EXISTS {{schema}}.api_key_usage_hourly (
  api_key_id text NOT NULL REFERENCES {{schema}}.api_keys(id) ON DELETE CASCADE,
  bucket_start timestamptz NOT NULL,
  total_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  auth_error_count integer NOT NULL DEFAULT 0,
  rate_limit_count integer NOT NULL DEFAULT 0,
  server_error_count integer NOT NULL DEFAULT 0,
  last_endpoint text,
  PRIMARY KEY (api_key_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS api_key_usage_hourly_bucket
  ON {{schema}}.api_key_usage_hourly(bucket_start DESC);
