ALTER TABLE "workspace_files" ALTER COLUMN "content_updated_at" SET DEFAULT date_trunc('milliseconds', now());--> statement-breakpoint
-- The trigger is the invariant; the truncating default above only keeps the common insert path from
-- paying for it. A default cannot cover the writers that matter here: explicit `CURRENT_TIMESTAMP`
-- expressions, raw SQL inserts, and any UPDATE. The name sorts before
-- `workspace_files_secret_provenance_demote` so that trigger's WHEN clause compares the normalized value,
-- and the WHEN guard keeps the plpgsql call off the hot insert path for already-compliant writes.
-- Rows minted before this runs are retired by script migration
-- `0018_repair_workspace_file_content_revision`, which the runner applies after every SQL migration.
CREATE OR REPLACE FUNCTION workspace_file_content_version_millisecond()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.content_updated_at := date_trunc('milliseconds', NEW.content_updated_at);
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_files_content_version_millisecond ON workspace_files;--> statement-breakpoint
CREATE TRIGGER workspace_files_content_version_millisecond
BEFORE INSERT OR UPDATE OF content_updated_at ON workspace_files
FOR EACH ROW
WHEN (NEW.content_updated_at <> date_trunc('milliseconds', NEW.content_updated_at))
EXECUTE FUNCTION workspace_file_content_version_millisecond();
