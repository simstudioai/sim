-- migration-safe: additive nullable queue-generation metadata is ignored by released application versions.
ALTER TABLE "document" ADD COLUMN "processing_queue_token" text;--> statement-breakpoint
-- migration-safe: additive nullable quota-deferral metadata is ignored by released application versions.
ALTER TABLE "document" ADD COLUMN "processing_deferred_until" timestamp;--> statement-breakpoint
-- migration-safe: the additive non-null counter has a constant default and preserves the released zero-skips behavior.
ALTER TABLE "knowledge_connector_sync_log" ADD COLUMN "docs_skipped" integer DEFAULT 0 NOT NULL;
