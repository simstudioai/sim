-- The connector sync checks whether a connector still carries a recently deleted or never-hydrated
-- document. With no index matching that predicate the planner scans the whole table for the first
-- match, and a connector with none reads every row on every sync.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_tombstone_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_tombstone_idx" ON "document" USING btree ("connector_id") WHERE "archived_at" IS NULL AND ("deleted_at" IS NOT NULL OR "content_hash" IS NULL);--> statement-breakpoint
SET lock_timeout = '5s';
