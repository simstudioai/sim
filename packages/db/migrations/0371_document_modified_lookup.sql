COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_kb_source_modified_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_source_modified_idx" ON "document" USING btree ("knowledge_base_id","source_modified_at") WHERE "document"."deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
