-- Replay-safety: this file ends in a CONCURRENTLY index build below an embedded COMMIT, so a
-- failure there replays the whole file — every statement here is idempotent.
ALTER TABLE "copilot_chats" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
-- Partial index backing the Recently Deleted listing of soft-deleted chats (queried by
-- user + workspace equality). Built CONCURRENTLY per runner convention (plain CREATE
-- INDEX write-blocks the relation).
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_chats_user_workspace_deleted_partial_idx" ON "copilot_chats" USING btree ("user_id","workspace_id") WHERE "copilot_chats"."deleted_at" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
