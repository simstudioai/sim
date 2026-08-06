-- Replay-safety: this file ends in a concurrent index build after an embedded COMMIT, so a
-- failure there replays the preceding schema work. Every statement before and after the COMMIT
-- is therefore idempotent.
-- migration-safe: all application columns are additive; existing durable rows retain NULL as
-- their legacy provenance marker, and the new private sidecar tables do not rewrite user data.
CREATE TABLE IF NOT EXISTS "document_secret_provenance" (
	"document_id" text PRIMARY KEY NOT NULL,
	"source_hash" text NOT NULL,
	"status" text NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_secret_provenance_status_check" CHECK ("document_secret_provenance"."status" IN ('exact', 'unknown')),
	CONSTRAINT "document_secret_provenance_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embedding_secret_provenance" (
	"embedding_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_secret_provenance_status_check" CHECK ("embedding_secret_provenance"."status" IN ('exact', 'unknown')),
	CONSTRAINT "embedding_secret_provenance_embedding_id_embedding_id_fk" FOREIGN KEY ("embedding_id") REFERENCES "public"."embedding"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_secret_provenance" (
	"memory_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_secret_provenance_status_check" CHECK ("memory_secret_provenance"."status" IN ('exact', 'unknown')),
	CONSTRAINT "memory_secret_provenance_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_table_row_secret_provenance" (
	"row_id" text PRIMARY KEY NOT NULL,
	"content_updated_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_table_row_secret_provenance_status_check" CHECK ("user_table_row_secret_provenance"."status" IN ('exact', 'unknown')),
	CONSTRAINT "user_table_row_secret_provenance_row_id_user_table_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."user_table_rows"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_file_secret_provenance" (
	"file_id" text PRIMARY KEY NOT NULL,
	"content_updated_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_file_secret_provenance_status_check" CHECK ("workspace_file_secret_provenance"."status" IN ('exact', 'unknown')),
	CONSTRAINT "workspace_file_secret_provenance_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "secret_provenance_version" integer;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN IF NOT EXISTS "secret_provenance_version" integer;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN IF NOT EXISTS "secret_provenance_version" integer;--> statement-breakpoint
ALTER TABLE "sandbox_image" ADD COLUMN IF NOT EXISTS "materialization_generation" bigint;--> statement-breakpoint
ALTER TABLE "user_table_rows" ADD COLUMN IF NOT EXISTS "secret_provenance_version" integer;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "execution_deadline_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN IF NOT EXISTS "secret_provenance_version" integer;--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD COLUMN IF NOT EXISTS "cli_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD COLUMN IF NOT EXISTS "system_packages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- During a rolling deploy, a legacy application process can still mutate durable content without
-- updating the new sidecar. Demoting the marker makes the new application use the established
-- legacy-read behavior instead of trusting a stale sidecar. Provenance-aware writers restore
-- version 1 only after writing the matching sidecar in the same transaction.
CREATE OR REPLACE FUNCTION "demote_secret_provenance_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW."secret_provenance_version" := NULL;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "demote_user_table_row_secret_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW."secret_provenance_version" := NULL;
	NEW."updated_at" := GREATEST(
		date_trunc('milliseconds', NEW."updated_at"),
		date_trunc('milliseconds', OLD."updated_at") + interval '1 millisecond'
	);
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "document_secret_provenance_demote" ON "document";--> statement-breakpoint
CREATE TRIGGER "document_secret_provenance_demote"
BEFORE UPDATE OF "filename", "file_url", "content_hash", "source_url", "tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "number1", "number2", "number3", "number4", "number5", "date1", "date2", "boolean1", "boolean2", "boolean3" ON "document"
FOR EACH ROW
WHEN (ROW(OLD."filename", OLD."file_url", OLD."content_hash", OLD."source_url", OLD."tag1", OLD."tag2", OLD."tag3", OLD."tag4", OLD."tag5", OLD."tag6", OLD."tag7", OLD."number1", OLD."number2", OLD."number3", OLD."number4", OLD."number5", OLD."date1", OLD."date2", OLD."boolean1", OLD."boolean2", OLD."boolean3") IS DISTINCT FROM ROW(NEW."filename", NEW."file_url", NEW."content_hash", NEW."source_url", NEW."tag1", NEW."tag2", NEW."tag3", NEW."tag4", NEW."tag5", NEW."tag6", NEW."tag7", NEW."number1", NEW."number2", NEW."number3", NEW."number4", NEW."number5", NEW."date1", NEW."date2", NEW."boolean1", NEW."boolean2", NEW."boolean3"))
EXECUTE FUNCTION "demote_secret_provenance_version"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "embedding_secret_provenance_demote" ON "embedding";--> statement-breakpoint
CREATE TRIGGER "embedding_secret_provenance_demote"
BEFORE UPDATE OF "content", "chunk_hash" ON "embedding"
FOR EACH ROW
WHEN (ROW(OLD."content", OLD."chunk_hash") IS DISTINCT FROM ROW(NEW."content", NEW."chunk_hash"))
EXECUTE FUNCTION "demote_secret_provenance_version"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "memory_secret_provenance_demote" ON "memory";--> statement-breakpoint
CREATE TRIGGER "memory_secret_provenance_demote"
BEFORE UPDATE OF "data" ON "memory"
FOR EACH ROW
WHEN (OLD."data" IS DISTINCT FROM NEW."data")
EXECUTE FUNCTION "demote_secret_provenance_version"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "user_table_rows_secret_provenance_demote" ON "user_table_rows";--> statement-breakpoint
CREATE TRIGGER "user_table_rows_secret_provenance_demote"
BEFORE UPDATE OF "data" ON "user_table_rows"
FOR EACH ROW
WHEN (OLD."data" IS DISTINCT FROM NEW."data")
EXECUTE FUNCTION "demote_user_table_row_secret_provenance"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_files_secret_provenance_demote" ON "workspace_files";--> statement-breakpoint
CREATE TRIGGER "workspace_files_secret_provenance_demote"
BEFORE UPDATE OF "content_updated_at" ON "workspace_files"
FOR EACH ROW
WHEN (OLD."content_updated_at" IS DISTINCT FROM NEW."content_updated_at")
EXECUTE FUNCTION "demote_secret_provenance_version"();--> statement-breakpoint

-- The execution-log table is live and can be large. End the migration transaction before the
-- index build so writes remain available. A failed build leaves this migration unjournaled; the
-- replay-safe drop removes any INVALID same-name index before rebuilding it.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_running_deadline_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_running_deadline_idx" ON "workflow_execution_logs" USING btree ("execution_deadline_at") WHERE "workflow_execution_logs"."status" = 'running' AND "workflow_execution_logs"."execution_deadline_at" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
