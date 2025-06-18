ALTER TABLE "workflow" ADD COLUMN "deployed_hash" text;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD COLUMN "deploy_hash" text;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD COLUMN "deploy_hash" text;--> statement-breakpoint
ALTER TABLE "workflow_subflows" ADD COLUMN "deploy_hash" text;--> statement-breakpoint
CREATE INDEX "workflow_blocks_deploy_hash_idx" ON "workflow_blocks" USING btree ("deploy_hash");--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_deploy_idx" ON "workflow_blocks" USING btree ("workflow_id","deploy_hash");--> statement-breakpoint
CREATE INDEX "workflow_edges_deploy_hash_idx" ON "workflow_edges" USING btree ("deploy_hash");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_deploy_idx" ON "workflow_edges" USING btree ("workflow_id","deploy_hash");--> statement-breakpoint
CREATE INDEX "workflow_subflows_deploy_hash_idx" ON "workflow_subflows" USING btree ("deploy_hash");--> statement-breakpoint
CREATE INDEX "workflow_subflows_workflow_deploy_idx" ON "workflow_subflows" USING btree ("workflow_id","deploy_hash");