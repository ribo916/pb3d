-- pb3d's own drill table, in the same Neon database as pickleball-drills'
-- kv_store table but deliberately separate/namespaced from it. One row per
-- drill (not a single JSONB blob) so create/update/delete are atomic
-- single-row operations for the in-app manage UI, rather than a whole-array
-- read-modify-write.
CREATE TABLE IF NOT EXISTS pb3d_drills (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  tags       TEXT[] NOT NULL DEFAULT '{}',
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pb3d_drills_tags_idx ON pb3d_drills USING GIN (tags);
