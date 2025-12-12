ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_processing_status_idx" ON "document" USING btree ("knowledge_base_id","processing_status");