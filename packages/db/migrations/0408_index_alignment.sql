-- Retires doc_connector_reconciliation_idx, superseded in 0388: keying on source_seen_at makes every
-- connector listing's seen stamp a non-HOT update that rewrites every document index. Adds a partial
-- index for the sync-log retention prune, which filters on started_at without a leading connector_id.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: contract of 0388 (#8334, shipped in v0.9.4): the reconciliation walks page by id on doc_connector_reconciliation_v2_idx and no deployed query orders by COALESCE(source_seen_at, '-infinity').
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_reconciliation_idx";--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "kcsl_terminal_started_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kcsl_terminal_started_at_idx" ON "knowledge_connector_sync_log" USING btree ("started_at") WHERE "knowledge_connector_sync_log"."status" IN ('completed', 'failed');--> statement-breakpoint
SET lock_timeout = '5s';
