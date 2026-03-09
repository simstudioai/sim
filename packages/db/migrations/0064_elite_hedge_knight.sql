DROP INDEX "workflow_execution_logs_cost_idx";--> statement-breakpoint
DROP INDEX "workflow_execution_logs_duration_idx";--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workflow_started_at_idx" ON "workflow_execution_logs" USING btree ("workflow_id","started_at");