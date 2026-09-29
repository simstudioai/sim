-- Stored-document recovery pages each eligible source by upload time. The global upload-time
-- index put retained inputs of paused sources ahead of recoverable ones, and every call read
-- through them before rejecting them on the source's status.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_processing_recovery_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_processing_recovery_idx" ON "document" USING btree ("connector_id","uploaded_at","id") WHERE "document"."processing_status" IN ('pending', 'processing', 'failed') AND "document"."connector_id" IS NOT NULL AND "document"."content_hash" IS NOT NULL AND "document"."storage_key" IS NOT NULL AND "document"."user_excluded" = false AND "document"."archived_at" IS NULL AND "document"."deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
