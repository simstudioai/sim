ALTER TABLE "workflow_schedule" ADD COLUMN "failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "last_failed_at" timestamp;