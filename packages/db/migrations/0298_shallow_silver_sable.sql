ALTER TABLE "document" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN "sync_lock_token" text;