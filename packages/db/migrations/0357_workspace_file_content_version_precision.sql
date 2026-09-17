ALTER TABLE "workspace_files" ALTER COLUMN "content_updated_at" SET DEFAULT date_trunc('milliseconds', now());--> statement-breakpoint
-- The trigger is the invariant; the truncating default above only keeps the common insert path from
-- paying for it. A default cannot cover the writers that matter here: explicit `CURRENT_TIMESTAMP`
-- expressions and raw SQL inserts.
--
-- It fires on every UPDATE rather than `UPDATE OF content_updated_at`, because a row can enter the
-- search index without its revision being written: materializing a chat upload sets `context` alone, and
-- `workspace_files_search_index_pending` then indexes whatever revision the row already carried. `UPDATE
-- OF` is evaluated against the statement's target columns, so widening it does not make
-- `workspace_files_secret_provenance_demote` fire on those metadata writes — normalizing a legacy row
-- keeps its tracked provenance. The WHEN guard keeps the plpgsql call off the hot path for the compliant
-- writes that are the norm, and the name sorts before both other triggers so they see the normalized
-- value. Rows minted before this runs are retired by script migration
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
BEFORE INSERT OR UPDATE ON workspace_files
FOR EACH ROW
WHEN (NEW.content_updated_at <> date_trunc('milliseconds', NEW.content_updated_at))
EXECUTE FUNCTION workspace_file_content_version_millisecond();
