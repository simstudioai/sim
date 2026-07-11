ALTER TABLE "paused_executions" ADD COLUMN "automatic_resume_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "organization_assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_storage_used_bytes_non_negative" CHECK ("workspace"."storage_used_bytes" >= 0) NOT VALID;--> statement-breakpoint