ALTER TABLE "workspace_files" DROP CONSTRAINT "workspace_files_key_unique";--> statement-breakpoint
ALTER TABLE "document" DROP CONSTRAINT "document_connector_id_knowledge_connector_id_fk";
--> statement-breakpoint
DROP INDEX "a2a_agent_workspace_workflow_unique";--> statement-breakpoint
DROP INDEX "identifier_idx";--> statement-breakpoint
DROP INDEX "form_identifier_idx";--> statement-breakpoint
DROP INDEX "user_table_def_workspace_name_unique";--> statement-breakpoint
DROP INDEX "path_deployment_unique";--> statement-breakpoint
DROP INDEX "workflow_mcp_tool_server_workflow_unique";--> statement-breakpoint
DROP INDEX "workflow_schedule_workflow_block_deployment_unique";--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN "resources" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "form" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_file" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "a2a_agent_archived_at_idx" ON "a2a_agent" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "chat_archived_at_idx" ON "chat" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "doc_archived_at_idx" ON "document" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "doc_deleted_at_idx" ON "document" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "form_archived_at_idx" ON "form" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "kc_archived_at_idx" ON "knowledge_connector" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "kc_deleted_at_idx" ON "knowledge_connector" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "user_table_def_archived_at_idx" ON "user_table_definitions" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "webhook_archived_at_idx" ON "webhook" USING btree ("archived_at");--> statement-breakpoint
-- Deduplicate workflow names within (workspace_id, folder_id) before adding the unique index.
-- Keeps the most recently created workflow with its original name; older duplicates get " (2)", " (3)", etc.
WITH duplicates AS (
  SELECT id, name, workspace_id, folder_id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, COALESCE(folder_id, ''), name
      ORDER BY created_at DESC
    ) AS rn
  FROM workflow
  WHERE archived_at IS NULL
)
UPDATE workflow
SET name = workflow.name || ' (' || duplicates.rn || ')'
FROM duplicates
WHERE workflow.id = duplicates.id
  AND duplicates.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_workspace_folder_name_active_unique" ON "workflow" USING btree ("workspace_id",coalesce("folder_id", ''),"name") WHERE "workflow"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflow_archived_at_idx" ON "workflow" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workflow_mcp_server_deleted_at_idx" ON "workflow_mcp_server" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "workflow_mcp_tool_archived_at_idx" ON "workflow_mcp_tool" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workflow_schedule_archived_at_idx" ON "workflow_schedule" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workspace_file_deleted_at_idx" ON "workspace_file" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_files_key_active_unique" ON "workspace_files" USING btree ("key") WHERE "workspace_files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_files_deleted_at_idx" ON "workspace_files" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "a2a_agent_workspace_workflow_unique" ON "a2a_agent" USING btree ("workspace_id","workflow_id") WHERE "a2a_agent"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "identifier_idx" ON "chat" USING btree ("identifier") WHERE "chat"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "form_identifier_idx" ON "form" USING btree ("identifier") WHERE "form"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_table_def_workspace_name_unique" ON "user_table_definitions" USING btree ("workspace_id","name") WHERE "user_table_definitions"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "path_deployment_unique" ON "webhook" USING btree ("path","deployment_version_id") WHERE "webhook"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_mcp_tool_server_workflow_unique" ON "workflow_mcp_tool" USING btree ("server_id","workflow_id") WHERE "workflow_mcp_tool"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_schedule_workflow_block_deployment_unique" ON "workflow_schedule" USING btree ("workflow_id","block_id","deployment_version_id") WHERE "workflow_schedule"."archived_at" IS NULL;