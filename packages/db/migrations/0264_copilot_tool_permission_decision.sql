CREATE TYPE "public"."copilot_tool_permission_decision" AS ENUM('allow', 'allow_chat', 'always_allow', 'skip');--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "permission_decision" "copilot_tool_permission_decision";--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "permission_decided_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_chats" DROP COLUMN "plan_artifact";