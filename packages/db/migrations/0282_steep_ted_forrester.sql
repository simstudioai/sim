-- Replay-safety: this file ends in a CONCURRENTLY index build below an embedded COMMIT, so a
-- failure there replays the whole file — every statement here is idempotent.
-- migration-safe: additive nullable execution deadline and sandbox materialization generation,
-- plus defaulted sandbox package columns, are backward-compatible with both app versions.
ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "execution_deadline_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD COLUMN IF NOT EXISTS "cli_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD COLUMN IF NOT EXISTS "system_packages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sandbox_image" ADD COLUMN IF NOT EXISTS "materialization_generation" bigint;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_running_deadline_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_running_deadline_idx" ON "workflow_execution_logs" USING btree ("execution_deadline_at") WHERE "workflow_execution_logs"."status" = 'running' AND "workflow_execution_logs"."execution_deadline_at" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
