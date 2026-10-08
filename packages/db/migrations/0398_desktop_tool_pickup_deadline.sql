ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "pickup_deadline_at" timestamp with time zone;
