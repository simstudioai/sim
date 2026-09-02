-- Adds the permission-group subject a table run's cells are gated against, separate from
-- `triggered_by_user_id` (an attribution that substitutes the workspace billed account when the
-- credential names no human). Additive and nullable: NULL means "no acting person, no per-tool
-- gate".
--
-- Rows written before this column existed would all read NULL, which silently drops the
-- triggered-by gate they were running under. That window is NOT short: a dispatch has no time
-- ceiling on the in-process path (`runDispatcherToCompletion` loops until the scope is exhausted,
-- `lib/table/dispatcher.ts`), and the trigger.dev path allows up to 90 minutes, so a queued
-- dispatch can outlive the deploy by hours. The backfill below therefore gives every non-terminal
-- pre-migration row exactly the subject it was already gated on — `triggered_by_user_id` — while
-- rows written by the new code carry the corrected acting-person/attribution distinction.
--
-- Transaction shape: the runner batches every pending file into ONE transaction (drizzle's
-- `session.transaction()`, see packages/db/scripts/migrate.ts), so `NOT VALID` + `VALIDATE` in a
-- single file is inert — the validation scan holds exactly the locks the two-step exists to shed,
-- and holds them until the last pending file commits. The `COMMIT;` breakpoint below ends that
-- batch transaction so the FK is added and validated in their own autocommit statements. From that
-- breakpoint on, this file and every later pending file run in autocommit and a failed run replays
-- unjournaled files from the top, so every statement here is written to survive a second run.
ALTER TABLE "table_run_dispatches" ADD COLUMN IF NOT EXISTS "capability_governed_user_id" text;--> statement-breakpoint
-- migration-safe: bounded backfill over non-terminal dispatches only (status pending/dispatching — a few rows at any instant, indexed by `table_run_dispatches_active_idx`), idempotent under the IS NULL guard, and it preserves rather than changes the gate those rows already had. A replay after the new writers are live could only re-gate a still-queued actorless row, which fails closed.
UPDATE "table_run_dispatches"
SET "capability_governed_user_id" = "triggered_by_user_id"
WHERE "status" IN ('pending', 'dispatching')
  AND "capability_governed_user_id" IS NULL
  AND "triggered_by_user_id" IS NOT NULL;--> statement-breakpoint
-- Ends the runner's batch transaction. Everything above committed together: the column add takes
-- ACCESS EXCLUSIVE on `table_run_dispatches`, and the backfill that follows it is index-driven over
-- the handful of live dispatches, so the exclusive lock is held for milliseconds rather than
-- through the next file's validation scan.
COMMIT;--> statement-breakpoint
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the replay guard is an explicit pg_constraint
-- lookup. Scoped to conrelid so an identically named constraint on another table cannot mask it.
-- NOT VALID keeps this to a metadata change: ACCESS EXCLUSIVE on `table_run_dispatches` and SHARE
-- ROW EXCLUSIVE on `user` (which blocks concurrent writes to `user` — signups included) for this
-- one statement, instead of for the whole batch.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'table_run_dispatches_capability_governed_user_id_user_id_fk'
      AND "conrelid" = '"table_run_dispatches"'::regclass
  ) THEN
    ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_capability_governed_user_id_user_id_fk" FOREIGN KEY ("capability_governed_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
-- Own transaction, which is the entire point of the breakpoint above: VALIDATE takes only SHARE
-- UPDATE EXCLUSIVE on `table_run_dispatches` and ROW SHARE on `user`, so the scan runs alongside
-- ordinary reads and writes. VALIDATE on an already-validated constraint is a no-op, so a replay
-- needs no guard of its own.
ALTER TABLE "table_run_dispatches" VALIDATE CONSTRAINT "table_run_dispatches_capability_governed_user_id_user_id_fk";
