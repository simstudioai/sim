CREATE SEQUENCE IF NOT EXISTS "public"."copilot_async_tool_calls_persist_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
-- Added without a default, then given one: a volatile default on ADD COLUMN would rewrite every
-- existing row, while SET DEFAULT applies only to new rows. Existing rows keep a NULL position.
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "persist_seq" bigint;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ALTER COLUMN "persist_seq" SET DEFAULT nextval('copilot_async_tool_calls_persist_seq');--> statement-breakpoint
ALTER SEQUENCE "public"."copilot_async_tool_calls_persist_seq" OWNED BY "copilot_async_tool_calls"."persist_seq";
