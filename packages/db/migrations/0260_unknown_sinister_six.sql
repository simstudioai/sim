ALTER TABLE "paused_executions" ADD COLUMN IF NOT EXISTS "automatic_resume_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "organization_assigned_at" timestamp;--> statement-breakpoint
-- migration-safe: replay-only cleanup of the constraint this same migration adds on the next line; no deployed code knows it yet. A failed concurrent index build below leaves this file unjournaled, and the rerun must not fail on ADD CONSTRAINT already-exists.
ALTER TABLE "workspace" DROP CONSTRAINT IF EXISTS "workspace_storage_used_bytes_non_negative";--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_storage_used_bytes_non_negative" CHECK ("workspace"."storage_used_bytes" >= 0) NOT VALID;--> statement-breakpoint

-- These tables are live and potentially large. End the migration transaction
-- before building their indexes so writes remain available during deployment.
-- Every statement in this file is idempotent, so a failed concurrent build
-- (which leaves this migration unjournaled and an INVALID same-name index
-- behind) replays safely from the top: the drop clears any INVALID leftover
-- before each rebuild.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "copilot_messages_user_created_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_messages_user_created_at_idx" ON "copilot_messages" USING btree ("created_at","chat_id","message_id") WHERE "copilot_messages"."role" = 'user' AND "copilot_messages"."deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "outbox_event_type_created_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_event_type_created_idx" ON "outbox_event" USING btree ("event_type","created_at");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_completed_ended_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_completed_ended_at_idx" ON "workflow_execution_logs" USING btree ("ended_at","workspace_id","execution_id") WHERE "workflow_execution_logs"."status" = 'completed' AND "workflow_execution_logs"."level" = 'info' AND "workflow_execution_logs"."ended_at" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
