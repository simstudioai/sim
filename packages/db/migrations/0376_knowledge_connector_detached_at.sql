ALTER TABLE "knowledge_connector" ADD COLUMN "detached_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN "detach_reserved_bytes" bigint DEFAULT 0 NOT NULL;