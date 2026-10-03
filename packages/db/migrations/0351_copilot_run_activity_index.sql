COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "copilot_runs_chat_started_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_runs_chat_started_at_idx" ON "copilot_runs" USING btree ("chat_id","started_at");
--> statement-breakpoint
SET lock_timeout = '5s';
