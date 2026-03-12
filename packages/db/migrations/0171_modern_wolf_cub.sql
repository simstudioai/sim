DROP INDEX "a2a_agent_workspace_workflow_unique";--> statement-breakpoint
DROP INDEX "identifier_idx";--> statement-breakpoint
DROP INDEX "form_identifier_idx";--> statement-breakpoint
DROP INDEX "user_table_def_workspace_name_unique";--> statement-breakpoint
DROP INDEX "path_deployment_unique";--> statement-breakpoint
DROP INDEX "workflow_mcp_tool_server_workflow_unique";--> statement-breakpoint
DROP INDEX "workflow_schedule_workflow_block_deployment_unique";--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "form" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_file" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
CREATE INDEX "a2a_agent_archived_at_idx" ON "a2a_agent" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "chat_archived_at_idx" ON "chat" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "form_archived_at_idx" ON "form" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "user_table_def_archived_at_idx" ON "user_table_definitions" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "webhook_archived_at_idx" ON "webhook" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workflow_archived_at_idx" ON "workflow" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workflow_mcp_tool_archived_at_idx" ON "workflow_mcp_tool" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workflow_schedule_archived_at_idx" ON "workflow_schedule" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workspace_file_deleted_at_idx" ON "workspace_file" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "workspace_files_deleted_at_idx" ON "workspace_files" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "a2a_agent_workspace_workflow_unique" ON "a2a_agent" USING btree ("workspace_id","workflow_id") WHERE "a2a_agent"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "identifier_idx" ON "chat" USING btree ("identifier") WHERE "chat"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "form_identifier_idx" ON "form" USING btree ("identifier") WHERE "form"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_table_def_workspace_name_unique" ON "user_table_definitions" USING btree ("workspace_id","name") WHERE "user_table_definitions"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "path_deployment_unique" ON "webhook" USING btree ("path","deployment_version_id") WHERE "webhook"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_mcp_tool_server_workflow_unique" ON "workflow_mcp_tool" USING btree ("server_id","workflow_id") WHERE "workflow_mcp_tool"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_schedule_workflow_block_deployment_unique" ON "workflow_schedule" USING btree ("workflow_id","block_id","deployment_version_id") WHERE "workflow_schedule"."archived_at" IS NULL;