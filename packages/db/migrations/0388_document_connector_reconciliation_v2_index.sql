-- Connector listings stamp source_seen_at on every listed document. Keying the reconciliation index
-- on it makes each stamp a non-HOT update that rewrites every document index. The absence and
-- resurrection walks now page by id, so this index leaves source_seen_at out of the key; the old
-- doc_connector_reconciliation_idx is dropped in a later release, once no deployed code orders by it.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_reconciliation_v2_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_reconciliation_v2_idx" ON "document" USING btree ("connector_id","id") WHERE "user_excluded" = false AND "archived_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
