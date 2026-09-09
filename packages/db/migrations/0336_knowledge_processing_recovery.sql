ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_recovery_after" timestamp;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: new additive recovery index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "doc_processing_recovery_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_processing_recovery_idx" ON "document" USING btree ("uploaded_at","id") WHERE "document"."processing_status" IN ('pending', 'processing', 'failed') AND "document"."connector_id" IS NOT NULL AND "document"."content_hash" IS NOT NULL AND "document"."storage_key" IS NOT NULL AND "document"."user_excluded" = false AND "document"."archived_at" IS NULL AND "document"."deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
