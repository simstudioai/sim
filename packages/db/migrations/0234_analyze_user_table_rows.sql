-- Guard for the reltuples corruption hit on staging (2026-06-12): the CREATE INDEX
-- CONCURRENTLY builds in 0233 left pg_class.reltuples = Infinity on user_table_rows
-- (PG 18.4, build ran under concurrent write churn). Infinity reltuples makes every
-- plan on the relation cost NaN and simultaneously disables autovacuum's self-repair —
-- its trigger threshold is base + scale_factor * reltuples = Infinity, so no churn can
-- ever trip an autoanalyze. ANALYZE rewrites reltuples from a fresh sample, restoring
-- sane plans and re-arming autovacuum. Cheap (~7s at 7M rows) and idempotent, so it is
-- safe on databases that never hit the corruption.
ANALYZE user_table_rows;
