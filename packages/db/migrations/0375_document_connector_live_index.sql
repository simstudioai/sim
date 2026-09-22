-- Every sync completion counts the live documents a connector owns. The reconciliation index keeps
-- tombstones on purpose, so without a live-only index that count walks the connector's heap tuples
-- and a large connector cannot finish inside the statement timeout.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_live_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_live_idx" ON "document" USING btree ("connector_id") WHERE "user_excluded" = false AND "archived_at" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
