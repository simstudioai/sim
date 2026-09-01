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
ALTER TABLE "table_run_dispatches" ADD COLUMN "capability_governed_user_id" text;--> statement-breakpoint
-- migration-safe: bounded backfill over non-terminal dispatches only (status pending/dispatching — a few rows at any instant, indexed by `table_run_dispatches_active_idx`), idempotent under the IS NULL guard, and it preserves rather than changes the gate those rows already had. A replay after the new writers are live could only re-gate a still-queued actorless row, which fails closed.
UPDATE "table_run_dispatches"
SET "capability_governed_user_id" = "triggered_by_user_id"
WHERE "status" IN ('pending', 'dispatching')
  AND "capability_governed_user_id" IS NULL
  AND "triggered_by_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_capability_governed_user_id_user_id_fk" FOREIGN KEY ("capability_governed_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" VALIDATE CONSTRAINT "table_run_dispatches_capability_governed_user_id_user_id_fk";
