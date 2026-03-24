ALTER TABLE "copilot_async_tool_calls" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."copilot_async_tool_status";--> statement-breakpoint
CREATE TYPE "public"."copilot_async_tool_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'delivered');--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."copilot_async_tool_status";--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ALTER COLUMN "status" SET DATA TYPE "public"."copilot_async_tool_status" USING "status"::"public"."copilot_async_tool_status";