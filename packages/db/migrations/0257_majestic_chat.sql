-- Replay-safety: this file ends in CONCURRENTLY index builds below an embedded COMMIT, so a
-- failure there replays the whole file — every statement here is idempotent.
--
-- migration-safe: additive enum value only (no rewrite, no table lock); old app code never
-- reads or writes 'workflow_mcp_server' rows, so it is invisible during cutover
ALTER TYPE "public"."workspace_fork_resource_type" ADD VALUE IF NOT EXISTS 'workflow_mcp_server' BEFORE 'custom_tool';--> statement-breakpoint
-- Expression indexes for listSurfacedBackgroundWork's `metadata ->> …` legs: `->>` equality
-- can't use a GIN index, and one unindexable leg in its `or()` forces a full-table scan of
-- this shared relation on every Activity page load / poll. Built CONCURRENTLY per runner
-- convention (plain CREATE INDEX write-blocks the relation for the build).
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "background_work_status_meta_child_ws_idx" ON "background_work_status" USING btree (("metadata" ->> 'childWorkspaceId'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "background_work_status_meta_other_ws_idx" ON "background_work_status" USING btree (("metadata" ->> 'otherWorkspaceId'));--> statement-breakpoint
SET lock_timeout = '5s';
