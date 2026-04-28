DROP INDEX "chat_archived_at_idx";--> statement-breakpoint
DROP INDEX "doc_archived_at_idx";--> statement-breakpoint
DROP INDEX "doc_deleted_at_idx";--> statement-breakpoint
DROP INDEX "form_archived_at_idx";--> statement-breakpoint
DROP INDEX "kc_archived_at_idx";--> statement-breakpoint
DROP INDEX "kc_deleted_at_idx";--> statement-breakpoint
DROP INDEX "mcp_servers_workspace_deleted_idx";--> statement-breakpoint
DROP INDEX "webhook_archived_at_idx";--> statement-breakpoint
DROP INDEX "workflow_mcp_tool_archived_at_idx";--> statement-breakpoint
DROP INDEX "workflow_schedule_archived_at_idx";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "log_retention_hours" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "soft_delete_retention_hours" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "task_cleanup_hours" integer;--> statement-breakpoint
CREATE INDEX "a2a_agent_workspace_archived_partial_idx" ON "a2a_agent" USING btree ("workspace_id","archived_at") WHERE "a2a_agent"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_archived_at_partial_idx" ON "chat" USING btree ("archived_at") WHERE "chat"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "doc_archived_at_partial_idx" ON "document" USING btree ("archived_at") WHERE "document"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "doc_deleted_at_partial_idx" ON "document" USING btree ("deleted_at") WHERE "document"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "form_archived_at_partial_idx" ON "form" USING btree ("archived_at") WHERE "form"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_workspace_deleted_partial_idx" ON "knowledge_base" USING btree ("workspace_id","deleted_at") WHERE "knowledge_base"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kc_archived_at_partial_idx" ON "knowledge_connector" USING btree ("archived_at") WHERE "knowledge_connector"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kc_deleted_at_partial_idx" ON "knowledge_connector" USING btree ("deleted_at") WHERE "knowledge_connector"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mcp_servers_workspace_deleted_partial_idx" ON "mcp_servers" USING btree ("workspace_id","deleted_at") WHERE "mcp_servers"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "memory_workspace_deleted_partial_idx" ON "memory" USING btree ("workspace_id","deleted_at") WHERE "memory"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_log_workspace_created_at_idx" ON "usage_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "user_table_def_workspace_archived_partial_idx" ON "user_table_definitions" USING btree ("workspace_id","archived_at") WHERE "user_table_definitions"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "webhook_archived_at_partial_idx" ON "webhook" USING btree ("archived_at") WHERE "webhook"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_workspace_archived_partial_idx" ON "workflow" USING btree ("workspace_id","archived_at") WHERE "workflow"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_folder_workspace_archived_partial_idx" ON "workflow_folder" USING btree ("workspace_id","archived_at") WHERE "workflow_folder"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_mcp_server_workspace_deleted_partial_idx" ON "workflow_mcp_server" USING btree ("workspace_id","deleted_at") WHERE "workflow_mcp_server"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_mcp_tool_archived_at_partial_idx" ON "workflow_mcp_tool" USING btree ("archived_at") WHERE "workflow_mcp_tool"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_schedule_archived_at_partial_idx" ON "workflow_schedule" USING btree ("archived_at") WHERE "workflow_schedule"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_file_workspace_deleted_partial_idx" ON "workspace_file" USING btree ("workspace_id","deleted_at") WHERE "workspace_file"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_files_workspace_deleted_partial_idx" ON "workspace_files" USING btree ("workspace_id","deleted_at") WHERE "workspace_files"."deleted_at" IS NOT NULL;