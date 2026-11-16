ALTER TABLE {{schema}}.organizations
  ADD COLUMN IF NOT EXISTS subject_ref text;

ALTER TABLE {{schema}}.organizations
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'seed';

CREATE UNIQUE INDEX IF NOT EXISTS organizations_subject_ref_unique
  ON {{schema}}.organizations(subject_ref)
  WHERE subject_ref IS NOT NULL;
