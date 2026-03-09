DROP INDEX "doc_file_hash_idx";--> statement-breakpoint
DROP INDEX "emb_chunk_hash_idx";--> statement-breakpoint
DROP INDEX "emb_kb_access_idx";--> statement-breakpoint
DROP INDEX "emb_kb_rank_idx";--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "file_hash";--> statement-breakpoint
ALTER TABLE "embedding" DROP COLUMN "overlap_tokens";--> statement-breakpoint
ALTER TABLE "embedding" DROP COLUMN "search_rank";--> statement-breakpoint
ALTER TABLE "embedding" DROP COLUMN "access_count";--> statement-breakpoint
ALTER TABLE "embedding" DROP COLUMN "last_accessed_at";--> statement-breakpoint
ALTER TABLE "embedding" DROP COLUMN "quality_score";