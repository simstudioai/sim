CREATE TYPE "public"."copilot_async_tool_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'resume_enqueued', 'resumed');--> statement-breakpoint
CREATE TYPE "public"."copilot_run_status" AS ENUM('active', 'paused_waiting_for_tool', 'resuming', 'complete', 'error', 'cancelled');--> statement-breakpoint
CREATE TABLE "copilot_async_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"checkpoint_id" uuid,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"args" jsonb DEFAULT '{}' NOT NULL,
	"status" "copilot_async_tool_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"claimed_at" timestamp,
	"claimed_by" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_run_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"pending_tool_call_id" text NOT NULL,
	"conversation_snapshot" jsonb DEFAULT '{}' NOT NULL,
	"agent_state" jsonb DEFAULT '{}' NOT NULL,
	"provider_request" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" text NOT NULL,
	"parent_run_id" uuid,
	"chat_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workflow_id" text,
	"workspace_id" text,
	"stream_id" text NOT NULL,
	"agent" text,
	"model" text,
	"provider" text,
	"status" "copilot_run_status" DEFAULT 'active' NOT NULL,
	"request_context" jsonb DEFAULT '{}' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "copilot_workflow_read_hashes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"workflow_id" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD CONSTRAINT "copilot_async_tool_calls_run_id_copilot_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."copilot_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD CONSTRAINT "copilot_async_tool_calls_checkpoint_id_copilot_run_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."copilot_run_checkpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_run_checkpoints" ADD CONSTRAINT "copilot_run_checkpoints_run_id_copilot_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."copilot_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD CONSTRAINT "copilot_runs_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD CONSTRAINT "copilot_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD CONSTRAINT "copilot_runs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD CONSTRAINT "copilot_runs_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_workflow_read_hashes" ADD CONSTRAINT "copilot_workflow_read_hashes_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_workflow_read_hashes" ADD CONSTRAINT "copilot_workflow_read_hashes_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_async_tool_calls_run_id_idx" ON "copilot_async_tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "copilot_async_tool_calls_checkpoint_id_idx" ON "copilot_async_tool_calls" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE INDEX "copilot_async_tool_calls_tool_call_id_idx" ON "copilot_async_tool_calls" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "copilot_async_tool_calls_status_idx" ON "copilot_async_tool_calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "copilot_async_tool_calls_run_status_idx" ON "copilot_async_tool_calls" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_async_tool_calls_tool_call_id_unique" ON "copilot_async_tool_calls" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "copilot_run_checkpoints_run_id_idx" ON "copilot_run_checkpoints" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "copilot_run_checkpoints_pending_tool_call_id_idx" ON "copilot_run_checkpoints" USING btree ("pending_tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_run_checkpoints_run_pending_tool_unique" ON "copilot_run_checkpoints" USING btree ("run_id","pending_tool_call_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_execution_id_idx" ON "copilot_runs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_parent_run_id_idx" ON "copilot_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_chat_id_idx" ON "copilot_runs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_user_id_idx" ON "copilot_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_workflow_id_idx" ON "copilot_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_workspace_id_idx" ON "copilot_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_status_idx" ON "copilot_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "copilot_runs_chat_execution_idx" ON "copilot_runs" USING btree ("chat_id","execution_id");--> statement-breakpoint
CREATE INDEX "copilot_runs_execution_started_at_idx" ON "copilot_runs" USING btree ("execution_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_runs_stream_id_unique" ON "copilot_runs" USING btree ("stream_id");--> statement-breakpoint
CREATE INDEX "copilot_workflow_read_hashes_chat_id_idx" ON "copilot_workflow_read_hashes" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "copilot_workflow_read_hashes_workflow_id_idx" ON "copilot_workflow_read_hashes" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_workflow_read_hashes_chat_workflow_unique" ON "copilot_workflow_read_hashes" USING btree ("chat_id","workflow_id");--> statement-breakpoint
-- Dedupe blocks prepended after `bunx drizzle-kit generate` so partial unique indexes can apply.
--
-- Knowledge bases: one active name per workspace (see schema `kb_workspace_name_active_unique`).
-- Keeps the most recently updated row with its original name; older duplicates get " (2)", " (3)", etc.
WITH kb_duplicates AS (
  SELECT id, name, workspace_id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, name
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM knowledge_base
  WHERE deleted_at IS NULL
    AND workspace_id IS NOT NULL
)
UPDATE knowledge_base
SET name = knowledge_base.name || ' (' || kb_duplicates.rn || ')'
FROM kb_duplicates
WHERE knowledge_base.id = kb_duplicates.id
  AND kb_duplicates.rn > 1;--> statement-breakpoint
--
-- Workspace files: one active display name per workspace for context `workspace`
-- (`workspace_files_workspace_name_active_unique`). Keeps the most recently uploaded row; others
-- get " (2)", " (3)", etc.
WITH file_name_duplicates AS (
  SELECT id, original_name, workspace_id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, original_name
      ORDER BY uploaded_at DESC
    ) AS rn
  FROM workspace_files
  WHERE deleted_at IS NULL
    AND context = 'workspace'
    AND workspace_id IS NOT NULL
)
UPDATE workspace_files
SET original_name = workspace_files.original_name || ' (' || file_name_duplicates.rn || ')'
FROM file_name_duplicates
WHERE workspace_files.id = file_name_duplicates.id
  AND file_name_duplicates.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_workspace_name_active_unique" ON "knowledge_base" USING btree ("workspace_id","name") WHERE "knowledge_base"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_files_workspace_name_active_unique" ON "workspace_files" USING btree ("workspace_id","original_name") WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;