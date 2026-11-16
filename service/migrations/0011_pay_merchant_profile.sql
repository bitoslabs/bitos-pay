ALTER TABLE {{schema}}.merchants
  ADD COLUMN IF NOT EXISTS support_email text;

ALTER TABLE {{schema}}.merchants
  ADD COLUMN IF NOT EXISTS website text;
