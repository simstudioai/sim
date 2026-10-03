/** New secondary indexes are built after the bulk load in script migration 0016. */
CREATE TABLE IF NOT EXISTS "embedding_keyword_search" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"document_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"content_tsv" "tsvector" NOT NULL,
	CONSTRAINT "embedding_keyword_search_id_embedding_id_fk" FOREIGN KEY ("id") REFERENCES "public"."embedding"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector" halfvec(1536);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_384" halfvec(384);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_512" halfvec(512);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_768" halfvec(768);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_1024" halfvec(1024);--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN IF NOT EXISTS "vector_3072" halfvec(3072);