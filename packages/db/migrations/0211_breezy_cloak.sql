CREATE INDEX "idx_chat_on_workflow_id_archived_at" ON "chat" USING btree ("workflow_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_on_provider_is_active_workflow_id_deploym_bdeed5468" ON "webhook" USING btree ("provider","is_active","workflow_id","deployment_version_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_on_workflow_id_block_id_updated_at_desc" ON "webhook" USING btree ("workflow_id","block_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_workflow_schedule_on_source_workspace_id_source_t_c07f3bba6" ON "workflow_schedule" USING btree ("source_workspace_id","source_type","archived_at","status");
