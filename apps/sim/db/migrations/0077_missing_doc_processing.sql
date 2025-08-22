ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_status" text DEFAULT 'pending' NOT NULL;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_completed_at" timestamp;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "processing_error" text;
CREATE INDEX IF NOT EXISTS "doc_processing_status_idx" ON "document" USING btree ("knowledge_base_id","processing_status");
