COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: new additive processing-probe index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_processing_status_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_processing_status_idx" ON "document" USING btree ("connector_id","processing_status") WHERE "document"."processing_status" IN ('pending', 'processing', 'failed') AND "document"."connector_id" IS NOT NULL AND "document"."user_excluded" = false AND "document"."archived_at" IS NULL AND "document"."deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
