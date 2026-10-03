-- Adds the permission-group subject a queued cell is gated against to the cell sidecar, and adds
-- the index the account-deletion cancel needs.
--
-- The cell column exists because a dispatcher pre-stamp outlives the worker that wrote it: a cell
-- task that finds the row's cascade lock held bails, and whoever owns the lock drains the marker.
-- Without the subject on the marker that drain runs someone else's request under its own subject.
-- Additive and nullable; NULL means "no acting person, no per-tool gate", which is exactly what a
-- marker written before this column existed was already doing. There is no backfill: every
-- pre-existing row is NULL by definition and NULL is the correct, pre-migration-equivalent value.
--
-- Transaction shape: the runner batches every pending file into ONE transaction and only an
-- embedded `COMMIT;` ends it (packages/db/scripts/migrate.ts). `table_row_executions` is the large
-- table in this pair, so its `VALIDATE CONSTRAINT` scan must not run inside that batch — there it
-- would hold 0315's ACCESS EXCLUSIVE on `table_run_dispatches` and the FK's SHARE ROW EXCLUSIVE on
-- `user` (blocking every signup) for the length of the scan. The `COMMIT;` below puts the scan in
-- its own autocommit statement, where it takes only SHARE UPDATE EXCLUSIVE and runs alongside
-- ordinary traffic.
--
-- Replay-safe: this file runs entirely in autocommit (0315 already committed), so a failure at any
-- statement leaves it unjournaled and replays the whole file from the top. Every statement below
-- has to survive being run twice.
ALTER TABLE "table_row_executions" ADD COLUMN IF NOT EXISTS "capability_governed_user_id" text;--> statement-breakpoint
-- Ends the runner's batch transaction if one is still open — it is not when 0315 applies in the
-- same run, and a redundant COMMIT is a Postgres WARNING, not an error. Keeping it unconditional
-- is what makes this file correct on its own, for a database that already has 0315.
COMMIT;--> statement-breakpoint
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the replay guard is an explicit pg_constraint
-- lookup. Scoped to conrelid so an identically named constraint on another table cannot mask it.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'table_row_executions_capability_governed_user_id_user_id_fk'
      AND "conrelid" = '"table_row_executions"'::regclass
  ) THEN
    ALTER TABLE "table_row_executions" ADD CONSTRAINT "table_row_executions_capability_governed_user_id_user_id_fk" FOREIGN KEY ("capability_governed_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
-- Own transaction. The scan is the price of a constraint the schema snapshot describes as an
-- ordinary FK: leaving it NOT VALID forever would make a migrated database differ from a freshly
-- created one, which every later drift check and snapshot diff would then have to special-case.
-- VALIDATE on an already-validated constraint is a no-op, so this needs no replay guard.
ALTER TABLE "table_row_executions" VALIDATE CONSTRAINT "table_row_executions_capability_governed_user_id_user_id_fk";--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- Account deletion cancels every still-active dispatch the departing account governs, and that is
-- the only query keyed on the subject. The other two indexes on this table lead with `table_id` /
-- `status`, so without this one the deletion scans every active dispatch while holding its
-- transaction open. Partial on the two live statuses: a terminal row is never a cancellation
-- target, and dispatch history is what grows.
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "table_run_dispatches_governed_active_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_run_dispatches_governed_active_idx" ON "table_run_dispatches" USING btree ("capability_governed_user_id","status") WHERE "table_run_dispatches"."status" IN ('pending', 'dispatching');--> statement-breakpoint
SET lock_timeout = '5s';
