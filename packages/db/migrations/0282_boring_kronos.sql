-- Replay-safety: this file ends in a CONCURRENTLY index build below an embedded COMMIT, so a
-- failure there replays the whole unjournaled file; every schema statement is idempotent.
-- migration-safe: additive nullable/defaulted columns and a new private table are backward-compatible with both app versions; no existing rows are rewritten
CREATE TABLE IF NOT EXISTS "workspace_file_secret_provenance" (
	"file_id" text PRIMARY KEY NOT NULL,
	"content_updated_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_file_secret_provenance_status_check" CHECK ("workspace_file_secret_provenance"."status" IN ('exact', 'unknown')),
	CONSTRAINT "workspace_file_secret_provenance_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "sandbox_image" ADD COLUMN IF NOT EXISTS "materialization_generation" bigint;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "execution_deadline_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN IF NOT EXISTS "secret_provenance_version" integer;--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD COLUMN IF NOT EXISTS "cli_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD COLUMN IF NOT EXISTS "system_packages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay cleanup for this branch-only index; staging has no deployed index with this name
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_running_deadline_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_running_deadline_idx" ON "workflow_execution_logs" USING btree ("execution_deadline_at") WHERE "workflow_execution_logs"."status" = 'running' AND "workflow_execution_logs"."execution_deadline_at" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
