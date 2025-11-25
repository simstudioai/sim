DROP INDEX "doc_kb_uploaded_at_idx";--> statement-breakpoint
DROP INDEX "workflow_blocks_workflow_type_idx";--> statement-breakpoint
DROP INDEX "workflow_deployment_version_workflow_id_idx";--> statement-breakpoint
DROP INDEX "workflow_execution_logs_execution_id_idx";--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "failed_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "last_failed_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_account_on_account_id_provider_id" ON "account" USING btree ("account_id","provider_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_on_workflow_id_block_id" ON "webhook" USING btree ("workflow_id","block_id");