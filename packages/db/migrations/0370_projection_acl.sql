ALTER TABLE "embedding_keyword_tin" ADD COLUMN "connector_id" text;--> statement-breakpoint
ALTER TABLE "embedding_keyword_tin" ADD COLUMN "acl" text[];--> statement-breakpoint
ALTER TABLE "embedding_search" ADD COLUMN "acl" text[];