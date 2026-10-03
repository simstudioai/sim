-- The scheduler round-trips these schedules through a JavaScript `Date` and claims a run by
-- matching the value back exactly. `Date` carries milliseconds while PostgreSQL stores
-- microseconds, so a schedule written in SQL rather than by the application became unmatchable the
-- moment it landed on a fractional millisecond: the connector stayed permanently due and every
-- claim was refused. Narrowing to the precision the round trip can carry makes both ends compare
-- the same value, and rounds the stored values so an already-wedged row recovers. Both columns are
-- narrowed in one statement so the rewrite is a single pass. `knowledge_connector_member`'s
-- `next_attempt_at` is written by the same backfill but is only ever range-compared, never claimed
-- by equality, so it is left alone.
--
-- migration-safe: every deployed reader and writer of these columns goes through a JavaScript
-- `Date`, which already truncates to milliseconds, so the discarded precision is unobservable to
-- the running version and this needs no earlier deploy.
ALTER TABLE "knowledge_connector"
  ALTER COLUMN "next_member_sync_at" SET DATA TYPE timestamp (3),
  ALTER COLUMN "next_sync_at" SET DATA TYPE timestamp (3);
