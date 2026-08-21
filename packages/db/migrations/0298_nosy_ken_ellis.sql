ALTER TABLE "document" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN "sync_lock_token" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN "sync_lock_lease_at" timestamp;--> statement-breakpoint
-- knowledge_connector_sync_log is an append-only, never-pruned history that the
-- five-minute scheduler tick now scans for orphaned `started` rows. Build the
-- partial index without taking a table-wide write lock: the runner opens a
-- transaction per pending batch, so end it before CONCURRENTLY. Everything below
-- is replayable even when a failed concurrent build left an INVALID same-named
-- index behind.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay cleanup for the index introduced by this same migration; CONCURRENTLY preserves sync-log writes
DROP INDEX CONCURRENTLY IF EXISTS "kcsl_started_at_partial_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kcsl_started_at_partial_idx" ON "knowledge_connector_sync_log" USING btree ("started_at") WHERE "knowledge_connector_sync_log"."status" = 'started';--> statement-breakpoint
SET lock_timeout = '5s';
