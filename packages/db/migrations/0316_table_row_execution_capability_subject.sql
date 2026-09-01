-- Adds the permission-group subject a queued cell is gated against to the cell sidecar, repeats
-- 0315's dispatch backfill, and adds the index the account-deletion cancel needs.
--
-- The cell column exists because a dispatcher pre-stamp outlives the worker that wrote it: a cell
-- task that finds the row's cascade lock held bails, and whoever owns the lock drains the marker.
-- Without the subject on the marker that drain runs someone else's request under its own subject.
-- Additive and nullable; NULL means "no acting person, no per-tool gate", which is exactly what a
-- marker written before this column existed was already doing.
ALTER TABLE "table_row_executions" ADD COLUMN "capability_governed_user_id" text;--> statement-breakpoint
ALTER TABLE "table_row_executions" ADD CONSTRAINT "table_row_executions_capability_governed_user_id_user_id_fk" FOREIGN KEY ("capability_governed_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "table_row_executions" VALIDATE CONSTRAINT "table_row_executions_capability_governed_user_id_user_id_fk";--> statement-breakpoint
-- Repeat of 0315's backfill, deliberately.
--
-- 0315 ran at ITS deploy, while instances of the previous release were still serving. Those
-- instances insert dispatches without the column, so a run they started in that window carries a
-- NULL subject and reads as actorless — ungated — even when a person triggered it. Nothing in a
-- read-side compatibility rule can repair that: treating "NULL subject, non-null triggered_by" as
-- governed re-applies the workspace billed account to workspace-key runs, which is the exact
-- bystander substitution 0315 exists to remove, and "only for rows older than the new writers" is
-- not a predicate this schema can express.
--
-- Repeating the backfill one migration later closes the 0315 window at the next deploy boundary,
-- because by then every writer of those rows was the old release. It does not close its own: rows
-- inserted by an old instance during THIS deploy stay NULL until they go terminal. That residue is
-- bounded by one deploy's drain rather than by a dispatch's lifetime, and it fails toward the
-- behavior those rows had before the column existed.
-- migration-safe: bounded backfill over non-terminal dispatches only (status pending/dispatching — a few rows at any instant, indexed by `table_run_dispatches_active_idx`), idempotent under the IS NULL guard, and it preserves rather than changes the gate those rows already had. A replay after the new writers are live could only re-gate a still-queued actorless row, which fails closed.
UPDATE "table_run_dispatches"
SET "capability_governed_user_id" = "triggered_by_user_id"
WHERE "status" IN ('pending', 'dispatching')
  AND "capability_governed_user_id" IS NULL
  AND "triggered_by_user_id" IS NOT NULL;--> statement-breakpoint
-- Concurrent index operations cannot run inside the migration runner's transaction.
COMMIT;--> statement-breakpoint
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
