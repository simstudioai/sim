ALTER TABLE "table_run_dispatches" ADD COLUMN "limit" jsonb;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD COLUMN "processed_count" integer DEFAULT 0 NOT NULL;