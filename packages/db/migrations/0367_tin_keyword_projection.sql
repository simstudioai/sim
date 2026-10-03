-- Keyword ranking for organization search indexes moves to the Tin text index where the database
-- provides it. This creates only the plain projection table; script migration
-- `0019_tin_keyword_projection` installs the `tin` extension, the index, and the trigger that fills
-- the table, and does nothing where `tin` is unavailable, so self-hosted databases keep an empty
-- table and the GIN keyword path. The table is new, so neither statement touches existing rows.
CREATE TABLE "embedding_keyword_tin" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"document_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embedding_keyword_tin" ADD CONSTRAINT "embedding_keyword_tin_id_embedding_id_fk" FOREIGN KEY ("id") REFERENCES "public"."embedding"("id") ON DELETE cascade ON UPDATE no action;