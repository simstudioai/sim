BEGIN;--> statement-breakpoint
SET LOCAL lock_timeout = '100ms';--> statement-breakpoint
-- Take parent locks without queueing ingestion behind a waiting DDL lock.
LOCK TABLE "public"."knowledge_base", "public"."embedding" IN ACCESS EXCLUSIVE MODE NOWAIT;--> statement-breakpoint
DROP TRIGGER IF EXISTS "embedding_keyword_search_sync" ON "public"."embedding";--> statement-breakpoint
DROP TRIGGER IF EXISTS "knowledge_base_keyword_search_sync" ON "public"."knowledge_base";--> statement-breakpoint
DROP FUNCTION IF EXISTS "public"."sync_embedding_keyword_search"(), "public"."sync_knowledge_base_keyword_search"() RESTRICT;--> statement-breakpoint
-- migration-safe: contract of indexed Search removal #8528, shipped in v0.9.16; ordinary KB keyword queries read embedding.content_tsv and no deployed app reads or writes this projection.
DROP TABLE IF EXISTS "public"."embedding_keyword_search" RESTRICT;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = '100ms';--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "public"."embedding_keyword_tin_content_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "public"."embedding_keyword_tin_acl_gin_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "public"."embedding_keyword_tin_acl_unfilled_idx";--> statement-breakpoint
SET lock_timeout = '5s';
