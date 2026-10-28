ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "executable_name" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "target_workspace_id" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "approved_args" jsonb;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_retryable" boolean DEFAULT true NOT NULL;