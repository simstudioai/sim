-- The document ACL trigger fans a document's source and ACL out to the keyword projection by
-- document id; with no index on that column every ACL change scanned the whole projection.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_keyword_tin_document_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_keyword_tin_document_idx" ON "embedding_keyword_tin" USING btree ("document_id");--> statement-breakpoint
SET lock_timeout = '5s';
