CREATE TABLE IF NOT EXISTS "embedding_search" (
	"id" text PRIMARY KEY NOT NULL CONSTRAINT "embedding_search_id_embedding_id_fk" REFERENCES "public"."embedding"("id") ON DELETE cascade,
	"knowledge_base_id" text NOT NULL,
	"document_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"binary" bit(1536),
	"binary_384" bit(384),
	"binary_768" bit(768),
	"binary_1024" bit(1024),
	"binary_3072" bit(3072),
	CONSTRAINT "embedding_search_width_check" CHECK (num_nonnulls("binary", "binary_384", "binary_768", "binary_1024", "binary_3072") = 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_search_kb_idx" ON "embedding_search" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_search_binary_hnsw_idx" ON "embedding_search" USING hnsw ("binary" bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_search_384_binary_hnsw_idx" ON "embedding_search" USING hnsw ("binary_384" bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_search_768_binary_hnsw_idx" ON "embedding_search" USING hnsw ("binary_768" bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_search_1024_binary_hnsw_idx" ON "embedding_search" USING hnsw ("binary_1024" bit_hamming_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_search_3072_binary_hnsw_idx" ON "embedding_search" USING hnsw ("binary_3072" bit_hamming_ops) WITH (m=16,ef_construction=64);
