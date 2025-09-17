CREATE INDEX "workflow_user_id_idx" ON "workflow" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_workspace_id_idx" ON "workflow" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_user_workspace_idx" ON "workflow" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_logs_workflow_id_idx" ON "workflow_logs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_logs_workflow_created_idx" ON "workflow_logs" USING btree ("workflow_id","created_at");