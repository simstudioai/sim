ALTER TABLE "user_table_definitions" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_table_rows" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "job_history" jsonb;--> statement-breakpoint
CREATE INDEX "user_table_rows_table_position_idx" ON "user_table_rows" USING btree ("table_id","position");