-- Backfill stable column ids onto every user table's schema (id-keyed columns).
-- Legacy columns are grandfathered with id = name: rows are already keyed by
-- name, so adopting the name as the id leaves user_table_rows correctly keyed
-- with zero row rewrites. Idempotent: tables whose every column already has an
-- id are skipped, and per column the id is only added when absent.
--
-- Run during a deploy/quiet window: this UPDATE does not take the app's
-- per-table advisory schema lock, so a concurrent column add/rename could race.
UPDATE "user_table_definitions" AS d
SET "schema" = jsonb_set(
  d."schema",
  '{columns}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN col ? 'id' THEN col
        ELSE col || jsonb_build_object('id', col->>'name')
      END
    )
    FROM jsonb_array_elements(d."schema"->'columns') AS col
  )
)
WHERE jsonb_typeof(d."schema"->'columns') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(d."schema"->'columns') AS c
    WHERE NOT (c ? 'id')
  );
