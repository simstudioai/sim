ALTER TABLE "workspace_files"
	ADD CONSTRAINT "workspace_files_size_bytes_not_null_check"
	CHECK ("size_bytes" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "workspace_files"
	VALIDATE CONSTRAINT "workspace_files_size_bytes_not_null_check";--> statement-breakpoint
-- migration-safe: contract of #7112 and #7123 — application reads and writes use size_bytes, the backfill is complete, and this PR must merge only after the compatibility release fully drains
ALTER TABLE "workspace_files" ALTER COLUMN "size_bytes" SET NOT NULL;--> statement-breakpoint
-- migration-safe: removes the temporary proof constraint created and validated above after PostgreSQL records the equivalent column-level NOT NULL invariant
ALTER TABLE "workspace_files"
	DROP CONSTRAINT "workspace_files_size_bytes_not_null_check";--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_files_sync_size_columns" ON "workspace_files";--> statement-breakpoint
DROP FUNCTION IF EXISTS "sync_workspace_file_size_columns"();--> statement-breakpoint
-- migration-safe: contract of #7112 and #7123 — no deployed application reader or writer depends on size, and this PR must merge only after the compatibility release fully drains
ALTER TABLE "workspace_files" DROP COLUMN "size";
