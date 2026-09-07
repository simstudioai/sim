ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_owner_token" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_revoked_at" timestamp with time zone;