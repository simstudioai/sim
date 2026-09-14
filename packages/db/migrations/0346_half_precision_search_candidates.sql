ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector" halfvec(1536);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_384" halfvec(384);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_512" halfvec(512);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_768" halfvec(768);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_1024" halfvec(1024);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_3072" halfvec(3072);--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
-- migration-safe: new additive candidate index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_cosine_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_search_cosine_hnsw_idx" ON "embedding_search" USING hnsw ("vector" halfvec_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: new additive candidate index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_512_cosine_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_search_512_cosine_hnsw_idx" ON "embedding_search" USING hnsw ("vector_512" halfvec_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: new additive candidate index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_384_cosine_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_search_384_cosine_hnsw_idx" ON "embedding_search" USING hnsw ("vector_384" halfvec_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: new additive candidate index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_768_cosine_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_search_768_cosine_hnsw_idx" ON "embedding_search" USING hnsw ("vector_768" halfvec_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: new additive candidate index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_1024_cosine_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_search_1024_cosine_hnsw_idx" ON "embedding_search" USING hnsw ("vector_1024" halfvec_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: new additive candidate index has no deployed readers; discard an interrupted unjournaled build before concurrent replay.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_3072_cosine_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_search_3072_cosine_hnsw_idx" ON "embedding_search" USING hnsw ("vector_3072" halfvec_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
SET lock_timeout = '5s';
