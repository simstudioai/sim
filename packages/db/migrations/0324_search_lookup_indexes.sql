COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_source_lookup_idx" ON "document" USING btree ("connector_id","external_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_reconciliation_idx" ON "document" USING btree ("connector_id",COALESCE("source_seen_at", '-infinity'::timestamp),"id") WHERE "document"."user_excluded" = false AND "document"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag1_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag1"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag2_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag2"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag3_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag3"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag4_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag4"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag5_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag5"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag6_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag6"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag7_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag7"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag1_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag1"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag2_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag2"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag3_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag3"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag4_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag4"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag5_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag5"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag6_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag6"));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag7_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag7"));--> statement-breakpoint
-- migration-safe: the replacement's connector_id prefix serves the deployed application's historical and live source lookups; no data or constraint is removed.
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_id_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag1_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag2_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag3_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag4_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag5_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag6_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag7_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag1_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag2_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag3_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag4_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag5_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag6_idx";--> statement-breakpoint
-- migration-safe: deployed document and search text filters use KB scope and LOWER(tag); the replacement expression index matches those predicates. This non-unique index is not used for a constraint or named by application SQL.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag7_idx";
