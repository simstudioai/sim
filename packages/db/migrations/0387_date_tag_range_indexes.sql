-- Date tag filters now compile to half-open ranges on the raw timestamp column instead of a
-- `col::date` comparison, so a plain btree on each date slot serves them. Recreates the slot
-- indexes 0386 dropped while no filter could use them.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_date1_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_date1_idx" ON "document" USING btree ("date1");--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_date2_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_date2_idx" ON "document" USING btree ("date2");--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "emb_date1_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_date1_idx" ON "embedding" USING btree ("date1");--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "emb_date2_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_date2_idx" ON "embedding" USING btree ("date2");--> statement-breakpoint
SET lock_timeout = '5s';
