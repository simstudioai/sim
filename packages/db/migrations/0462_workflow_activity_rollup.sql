-- The organization activity rollup: hourly workflow-run counts, the maintenance pass's progress,
-- and its two work queues. Expand only: four new tables, no change to an existing table, and no
-- trigger on workflow_execution_logs. Nothing reads or writes them until the
-- activity-rollup-maintenance and organization-activity-rollup-reads flags are turned on, so the
-- deployed app is unaffected. The tables are new, so their indexes build on empty tables inside
-- this migration's transaction.
-- 0461 ends the batch transaction with a concurrent index build; keep these tables and their journal row atomic.
BEGIN;--> statement-breakpoint
CREATE TABLE "activity_rollup_dirty" (
	"workspace_id" text NOT NULL,
	"bucket_start" timestamp NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_rollup_dirty_workspace_id_bucket_start_pk" PRIMARY KEY("workspace_id","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "activity_rollup_inflight" (
	"workspace_id" text NOT NULL,
	"bucket_start" timestamp NOT NULL,
	"next_check_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_rollup_inflight_workspace_id_bucket_start_pk" PRIMARY KEY("workspace_id","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "activity_rollup_state" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"coverage_start" timestamp,
	"fresh_through" timestamp,
	"backfill_completed_at" timestamp with time zone,
	"last_end_scan" timestamp,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"housekeeping_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_activity_hourly" (
	"workspace_id" text NOT NULL,
	"bucket_start" timestamp NOT NULL,
	"workflow_id" text NOT NULL,
	"trigger" text NOT NULL,
	"runs" integer NOT NULL,
	"completed" integer NOT NULL,
	"failed" integer NOT NULL,
	"cancelled" integer NOT NULL,
	"in_flight" integer NOT NULL,
	"duration_sum_ms" bigint NOT NULL,
	"duration_count" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_activity_hourly_pk" PRIMARY KEY("workspace_id","bucket_start","workflow_id","trigger")
);
--> statement-breakpoint
CREATE INDEX "activity_rollup_dirty_due_at_idx" ON "activity_rollup_dirty" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "activity_rollup_inflight_next_check_at_idx" ON "activity_rollup_inflight" USING btree ("next_check_at");--> statement-breakpoint
CREATE INDEX "workflow_activity_hourly_read_idx" ON "workflow_activity_hourly" USING btree ("workspace_id","bucket_start","workflow_id","trigger","runs","completed","failed","cancelled","in_flight","duration_sum_ms","duration_count");--> statement-breakpoint
CREATE INDEX "workflow_activity_hourly_bucket_start_idx" ON "workflow_activity_hourly" USING btree ("bucket_start");--> statement-breakpoint
-- The pass rewrites changed cells in place and deletes emptied ones every few minutes, so the rollup
-- is vacuumed and analyzed at a small share of its rows rather than the default fifth.
ALTER TABLE "workflow_activity_hourly" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);--> statement-breakpoint
-- The state row is rewritten several times a pass, and marks and in-flight checks are inserted and
-- deleted within minutes: these stay tiny, so they are vacuumed after a fixed number of dead rows.
ALTER TABLE "activity_rollup_state" SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 200, autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 200);--> statement-breakpoint
ALTER TABLE "activity_rollup_dirty" SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 1000);--> statement-breakpoint
ALTER TABLE "activity_rollup_inflight" SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 1000);
