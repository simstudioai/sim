-- Expand/cutover half of the size_bytes migration. The default lets the new application omit
-- the legacy NOT NULL column, while the trigger keeps both generations compatible throughout
-- the rolling deploy: old writers supply size, and new writers supply size_bytes.
ALTER TABLE "workspace_files" ALTER COLUMN "size" SET DEFAULT 0;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "sync_workspace_file_size_columns"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."size_bytes" IS NULL THEN
			NEW."size_bytes" := NEW."size";
		ELSE
			NEW."size" := LEAST(NEW."size_bytes", 2147483647)::integer;
		END IF;
	ELSIF NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes" THEN
		NEW."size" := LEAST(NEW."size_bytes", 2147483647)::integer;
	ELSIF NEW."size" IS DISTINCT FROM OLD."size" OR NEW."size_bytes" IS NULL THEN
		NEW."size_bytes" := NEW."size";
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "workspace_files_sync_size_columns" ON "workspace_files";--> statement-breakpoint
CREATE TRIGGER "workspace_files_sync_size_columns"
BEFORE INSERT OR UPDATE OF "size", "size_bytes" ON "workspace_files"
FOR EACH ROW EXECUTE FUNCTION "sync_workspace_file_size_columns"();
