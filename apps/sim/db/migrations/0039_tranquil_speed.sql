-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create knowledge_base table
CREATE TABLE IF NOT EXISTS "knowledge_base" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"name" text NOT NULL,
	"description" text,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"embedding_dimension" integer DEFAULT 1536 NOT NULL,
	"chunking_config" json DEFAULT '{"maxSize": 1024, "minSize": 100, "overlap": 200}' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create document table
CREATE TABLE IF NOT EXISTS "document" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"file_hash" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"character_count" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);

-- Create embedding table with optimized vector type
CREATE TABLE IF NOT EXISTS "embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_hash" text NOT NULL,
	"content" text NOT NULL,
	"content_length" integer NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536) NOT NULL, -- Optimized for text-embedding-3-small with HNSW support
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"overlap_tokens" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"search_rank" numeric DEFAULT '1.0',
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp,
	"quality_score" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	
	-- Ensure embedding exists (simplified constraint)
	CONSTRAINT "embedding_not_null_check" CHECK ("embedding" IS NOT NULL)
);

-- Add foreign key constraints
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document" ADD CONSTRAINT "document_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_base"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_base"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE cascade ON UPDATE no action;

-- Create indexes for knowledge_base table
CREATE INDEX IF NOT EXISTS "kb_user_id_idx" ON "knowledge_base" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "kb_workspace_id_idx" ON "knowledge_base" USING btree ("workspace_id");
CREATE INDEX IF NOT EXISTS "kb_user_workspace_idx" ON "knowledge_base" USING btree ("user_id","workspace_id");
CREATE INDEX IF NOT EXISTS "kb_deleted_at_idx" ON "knowledge_base" USING btree ("deleted_at");

-- Create indexes for document table
CREATE INDEX IF NOT EXISTS "doc_kb_id_idx" ON "document" USING btree ("knowledge_base_id");
CREATE INDEX IF NOT EXISTS "doc_file_hash_idx" ON "document" USING btree ("file_hash");
CREATE INDEX IF NOT EXISTS "doc_filename_idx" ON "document" USING btree ("filename");
CREATE INDEX IF NOT EXISTS "doc_kb_uploaded_at_idx" ON "document" USING btree ("knowledge_base_id","uploaded_at");

-- Create embedding table indexes
CREATE INDEX IF NOT EXISTS "emb_kb_id_idx" ON "embedding" USING btree ("knowledge_base_id");
CREATE INDEX IF NOT EXISTS "emb_doc_id_idx" ON "embedding" USING btree ("document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "emb_doc_chunk_idx" ON "embedding" USING btree ("document_id","chunk_index");
CREATE INDEX IF NOT EXISTS "emb_kb_model_idx" ON "embedding" USING btree ("knowledge_base_id","embedding_model");
CREATE INDEX IF NOT EXISTS "emb_chunk_hash_idx" ON "embedding" USING btree ("chunk_hash");
CREATE INDEX IF NOT EXISTS "emb_kb_access_idx" ON "embedding" USING btree ("knowledge_base_id","last_accessed_at");
CREATE INDEX IF NOT EXISTS "emb_kb_rank_idx" ON "embedding" USING btree ("knowledge_base_id","search_rank");

-- Create optimized HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS "embedding_vector_hnsw_idx" ON "embedding" 
  USING hnsw ("embedding" vector_cosine_ops) 
  WITH (m = 16, ef_construction = 64);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS "emb_metadata_gin_idx" ON "embedding" USING gin ("metadata");

-- Full-text search support with generated tsvector column
ALTER TABLE "embedding" ADD COLUMN IF NOT EXISTS "content_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
CREATE INDEX IF NOT EXISTS "emb_content_fts_idx" ON "embedding" USING gin ("content_tsv");

-- Performance optimization: Set fillfactor for high-update tables
ALTER TABLE "embedding" SET (fillfactor = 85);
ALTER TABLE "document" SET (fillfactor = 90);

-- Add table comments for documentation
COMMENT ON TABLE "knowledge_base" IS 'Stores knowledge base configurations and settings';
COMMENT ON TABLE "document" IS 'Stores document metadata and processing status';
COMMENT ON TABLE "embedding" IS 'Stores vector embeddings optimized for text-embedding-3-small with HNSW similarity search';
COMMENT ON COLUMN "embedding"."embedding" IS 'Vector embedding using pgvector type optimized for HNSW similarity search';
COMMENT ON COLUMN "embedding"."metadata" IS 'JSONB metadata for flexible filtering (e.g., page numbers, sections, tags)';
COMMENT ON COLUMN "embedding"."search_rank" IS 'Boost factor for search results, higher values appear first'; 