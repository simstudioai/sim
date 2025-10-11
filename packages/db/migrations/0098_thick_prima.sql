DROP INDEX "workflow_edges_source_block_idx";--> statement-breakpoint
DROP INDEX "workflow_edges_target_block_idx";--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_state_snapshot_id_idx" ON "workflow_execution_logs" USING btree ("state_snapshot_id");