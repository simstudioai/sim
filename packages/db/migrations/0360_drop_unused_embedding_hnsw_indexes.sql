-- Drops the ten unused ANN indexes on "embedding". Approximate retrieval moved to the
-- compact "embedding_search" projection; the only vector ordering left on this table is an
-- exact rerank wrapped as (distance) + 0, which the planner cannot match to an index.
-- The last app version that ordered by a bare distance has drained, so nothing reads these.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_vector_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_384_vector_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_768_vector_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_1024_vector_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_3072_vector_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_384_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_768_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_1024_binary_hnsw_idx";--> statement-breakpoint
-- migration-safe: DROP INDEX CONCURRENTLY IF EXISTS is idempotent on replay and takes no blocking lock.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_3072_binary_hnsw_idx";--> statement-breakpoint
SET lock_timeout = '5s';
