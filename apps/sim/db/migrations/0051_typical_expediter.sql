CREATE TABLE "docs_embeddings" (
	"chunk_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_text" text NOT NULL,
	"source_document" text NOT NULL,
	"source_link" text NOT NULL,
	"header_text" text NOT NULL,
	"header_level" integer NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"chunk_text_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "docs_embeddings"."chunk_text")) STORED,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "docs_embedding_not_null_check" CHECK ("embedding" IS NOT NULL),
	CONSTRAINT "docs_header_level_check" CHECK ("header_level" >= 1 AND "header_level" <= 6)
);
--> statement-breakpoint
CREATE INDEX "docs_emb_source_document_idx" ON "docs_embeddings" USING btree ("source_document");--> statement-breakpoint
CREATE INDEX "docs_emb_header_level_idx" ON "docs_embeddings" USING btree ("header_level");--> statement-breakpoint
CREATE INDEX "docs_emb_source_header_idx" ON "docs_embeddings" USING btree ("source_document","header_level");--> statement-breakpoint
CREATE INDEX "docs_emb_model_idx" ON "docs_embeddings" USING btree ("embedding_model");--> statement-breakpoint
CREATE INDEX "docs_emb_created_at_idx" ON "docs_embeddings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "docs_embedding_vector_hnsw_idx" ON "docs_embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "docs_emb_metadata_gin_idx" ON "docs_embeddings" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "docs_emb_chunk_text_fts_idx" ON "docs_embeddings" USING gin ("chunk_text_tsv");