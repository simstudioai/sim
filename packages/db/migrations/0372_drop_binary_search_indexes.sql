-- Drops the five binary-quantized ANN indexes on "embedding_search". Ranking walks the
-- half-precision graphs; no reader has ordered by a hamming distance on this projection since
-- half-precision search shipped, so each index was maintained on every chunk write for nothing,
-- and the populated one doubled the cost of filling the projection's source and ACL columns.
-- The binary columns stay for now: the projection sync trigger still writes them.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_384_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_768_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_1024_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_search_3072_binary_hnsw_idx";--> statement-breakpoint
SET lock_timeout = '5s';
