ALTER TABLE "document" ALTER COLUMN "processing_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "processing_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "email_preferences" json DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "doc_processing_status_idx" ON "document" USING btree ("knowledge_base_id","processing_status");