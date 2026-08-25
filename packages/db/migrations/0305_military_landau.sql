ALTER TABLE "document" ADD COLUMN "processing_queue_token" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector_sync_log" ADD COLUMN "docs_skipped" integer DEFAULT 0 NOT NULL;