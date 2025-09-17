-- Add enabled field to embedding table
ALTER TABLE "embedding" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;

-- Composite index for knowledge base + enabled chunks (for search optimization)
CREATE INDEX IF NOT EXISTS "emb_kb_enabled_idx" ON "embedding" USING btree ("knowledge_base_id", "enabled");

-- Composite index for document + enabled chunks (for document chunk listings)
CREATE INDEX IF NOT EXISTS "emb_doc_enabled_idx" ON "embedding" USING btree ("document_id", "enabled"); 