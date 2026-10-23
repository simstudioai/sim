ALTER TABLE "job_execution_logs" ADD COLUMN "occurrence_at" timestamp;--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD COLUMN "billing_request_id" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "run_budget_usd" numeric(12, 4);--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "job_execution_logs_schedule_occurrence_unique" ON "job_execution_logs" USING btree ("schedule_id","occurrence_at");--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "job_execution_logs_billing_request_unique" ON "job_execution_logs" USING btree ("billing_request_id") WHERE "job_execution_logs"."billing_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "job_execution_logs_open_idx" ON "job_execution_logs" USING btree ("started_at") WHERE "job_execution_logs"."status" IN ('queued', 'running');--> statement-breakpoint
SET lock_timeout = '5s';
