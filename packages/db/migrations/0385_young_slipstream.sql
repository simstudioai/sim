COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_kb_source_url_hash_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_source_url_hash_idx" ON "document" USING btree ("knowledge_base_id",md5("source_url")) WHERE "document"."deleted_at" IS NULL AND "document"."source_url" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
