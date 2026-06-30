ALTER TABLE "workflow_schedule" ADD COLUMN "contexts" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "excluded_dates" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "ends_at" timestamp;