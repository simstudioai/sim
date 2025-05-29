ALTER TABLE "embedding" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "embedding" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "embedding_model" SET DEFAULT 'text-embedding-3-small';--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "metadata" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "metadata" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "embedding"."content")) STORED;--> statement-breakpoint
CREATE INDEX "emb_kb_enabled_idx" ON "embedding" USING btree ("knowledge_base_id","enabled");--> statement-breakpoint
CREATE INDEX "emb_doc_enabled_idx" ON "embedding" USING btree ("document_id","enabled");--> statement-breakpoint
CREATE INDEX "embedding_vector_hnsw_idx" ON "embedding" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "emb_metadata_gin_idx" ON "embedding" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "emb_content_fts_idx" ON "embedding" USING gin ("content_tsv");--> statement-breakpoint
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_not_null_check" CHECK ("embedding" IS NOT NULL);