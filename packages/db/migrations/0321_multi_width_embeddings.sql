-- Multi-width knowledge-base embeddings (expand phase).
--
-- pgvector fixes a column's dimensionality, so storing models that emit different sizes needs one
-- column per size. `embedding` keeps its bare name and its 1536 width, so every row written so far
-- stays exactly where it is; four sibling columns cover the other widths popular embedding models
-- emit (384 all-minilm, 768 nomic-embed-text/embeddinggemma, 1024 mxbai-embed-large/bge-m3/Voyage,
-- 3072 text-embedding-3-large/gemini-embedding-001). A chunk populates exactly one of the five,
-- chosen by its knowledge base's `embedding_dimension`.
--
-- The old `embedding_not_null_check` asserted the 1536 column specifically, so it is replaced by a
-- width-agnostic one. Both the currently deployed application (which only ever writes `embedding`)
-- and the new one satisfy `num_nonnulls(...) = 1`, so this file is backward-compatible with the
-- running version and the replacement can never reject a write either version makes.
--
-- Transaction shape: the runner batches every pending file into ONE transaction and only an
-- embedded `COMMIT;` ends it (packages/db/scripts/migrate.ts). Everything up to that COMMIT is
-- cheap catalog work — adding a nullable column with no default rewrites nothing, and NOT VALID
-- adds the new check without a scan. Everything after it runs in autocommit and must survive being
-- run twice: the constraint is guarded by a pg_constraint lookup, VALIDATE on an already-validated
-- constraint is a no-op, and each index is dropped concurrently first so a replay cannot inherit an
-- INVALID build from a failed one.
--
-- Cost: the four index builds each scan `embedding` twice under CREATE INDEX CONCURRENTLY. The
-- columns are entirely NULL, so the resulting indexes are empty and the builds take no lock that
-- blocks reads or writes — but on a large table they are not quick. They are built here rather
-- than lazily because a knowledge base created at one of the new widths is searched immediately,
-- and an unindexed vector column means a sequential scan per query.

ALTER TABLE "embedding" ADD COLUMN IF NOT EXISTS "embedding_384" vector(384);--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN IF NOT EXISTS "embedding_768" vector(768);--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN IF NOT EXISTS "embedding_1024" vector(1024);--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN IF NOT EXISTS "embedding_3072" vector(3072);--> statement-breakpoint
-- The replacement is added BEFORE the old check is dropped, so the table is never briefly
-- unguarded. Both hold at once for every write either app version makes: the deployed one only
-- ever populates "embedding", which satisfies `IS NOT NULL` and `num_nonnulls(...) = 1` alike. The
-- reverse order would leave a window in which a vectorless row could be committed, and VALIDATE
-- below would then fail and wedge the migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'embedding_width_check' AND "conrelid" = '"embedding"'::regclass) THEN
    ALTER TABLE "embedding" ADD CONSTRAINT "embedding_width_check" CHECK (num_nonnulls("embedding", "embedding_384", "embedding_768", "embedding_1024", "embedding_3072") = 1) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
-- migration-safe: replaced by embedding_width_check, added above and in force before this runs.
-- The replacement rejects exactly what this rejected for the currently deployed application, which
-- only ever populates "embedding", so no write either app version makes is newly accepted.
ALTER TABLE "embedding" DROP CONSTRAINT IF EXISTS "embedding_not_null_check";--> statement-breakpoint
-- Ends the runner's batch transaction (a redundant COMMIT is a WARNING, not an error). Every
-- statement below runs in autocommit so that no scan or index build holds the batch's locks.
COMMIT;--> statement-breakpoint
-- VALIDATE runs under SHARE UPDATE EXCLUSIVE, which does not block reads or writes. It holds
-- trivially: every existing row has "embedding" set — the constraint dropped above guaranteed it
-- for the table's whole history — and the four new columns are NULL.
ALTER TABLE "embedding" VALIDATE CONSTRAINT "embedding_width_check";--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_384_vector_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_384_vector_hnsw_idx" ON "embedding" USING hnsw ("embedding_384" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_768_vector_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_768_vector_hnsw_idx" ON "embedding" USING hnsw ("embedding_768" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_1024_vector_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_1024_vector_hnsw_idx" ON "embedding" USING hnsw ("embedding_1024" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- pgvector indexes `vector` only up to 2,000 dimensions and `halfvec` up to 4,000, so the 3,072
-- column is indexed through a `halfvec` cast — the recipe pgvector documents for wider vectors.
-- Postgres matches an expression index by its expression, so a query repeats the cast and the
-- comparison is half-precision too; only the stored vector keeps its full width. See the schema
-- comment on this index for the measured cost.
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "embedding_3072_vector_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "embedding_3072_vector_hnsw_idx" ON "embedding" USING hnsw (("embedding_3072"::halfvec(3072)) halfvec_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
SET lock_timeout = '5s';
