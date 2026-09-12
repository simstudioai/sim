-- Additive indexes; existing cosine indexes remain available to deployed and unfiltered search.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes only this new candidate index so an interrupted concurrent build cannot remain invalid.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_binary_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_binary_hnsw_idx" ON "embedding" USING hnsw ((binary_quantize("embedding")::bit(1536)) bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: replay removes only this new candidate index so an interrupted concurrent build cannot remain invalid.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_384_binary_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_384_binary_hnsw_idx" ON "embedding" USING hnsw ((binary_quantize("embedding_384")::bit(384)) bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: replay removes only this new candidate index so an interrupted concurrent build cannot remain invalid.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_768_binary_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_768_binary_hnsw_idx" ON "embedding" USING hnsw ((binary_quantize("embedding_768")::bit(768)) bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: replay removes only this new candidate index so an interrupted concurrent build cannot remain invalid.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_1024_binary_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_1024_binary_hnsw_idx" ON "embedding" USING hnsw ((binary_quantize("embedding_1024")::bit(1024)) bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: replay removes only this new candidate index so an interrupted concurrent build cannot remain invalid.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_3072_binary_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_3072_binary_hnsw_idx" ON "embedding" USING hnsw ((binary_quantize("embedding_3072")::bit(3072)) bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
SET lock_timeout = '5s';
