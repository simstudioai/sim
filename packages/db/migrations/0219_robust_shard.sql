ALTER TYPE "public"."usage_log_category" ADD VALUE IF NOT EXISTS 'tool';--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "cost_total" numeric;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "models_used" text[];--> statement-breakpoint
COMMIT;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_execution_id_idx" ON "usage_log" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_workspace_cost_total_idx" ON "workflow_execution_logs" USING btree ("workspace_id","cost_total");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_models_used_idx" ON "workflow_execution_logs" USING gin ("models_used");
