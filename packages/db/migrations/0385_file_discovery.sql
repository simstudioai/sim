CREATE TYPE "public"."file_discovery" AS ENUM('listed', 'unlisted');--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "discovery" "file_discovery" DEFAULT 'listed' NOT NULL;
--> statement-breakpoint
/** contract-pending(after discovery-aware writers are fully deployed): remove this rollout bridge. */
CREATE FUNCTION workspace_file_discovery_legacy_writer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.context <> 'workspace' THEN NEW.discovery := 'unlisted'; END IF;
  ELSIF NEW.context IS DISTINCT FROM OLD.context THEN
    NEW.discovery := CASE WHEN NEW.context = 'workspace' THEN 'listed'::file_discovery ELSE 'unlisted'::file_discovery END;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_files_discovery_legacy_writer
BEFORE INSERT OR UPDATE OF context ON workspace_files
FOR EACH ROW EXECUTE FUNCTION workspace_file_discovery_legacy_writer();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_file_search_mark_pending()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE workspace_file_search_build SET expires_at = now() WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = OLD.id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.content_updated_at IS NOT DISTINCT FROM OLD.content_updated_at
      AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
      AND NEW.discovery IS NOT DISTINCT FROM OLD.discovery
      AND NEW.context IS NOT DISTINCT FROM OLD.context
      AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
      RETURN NEW;
    END IF;
    UPDATE workspace_file_search_build SET expires_at = now() WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = NEW.id);
    DELETE FROM workspace_file_search_revision WHERE file_id = NEW.id;
  END IF;

  IF NEW.discovery = 'listed' AND NEW.context = 'workspace' AND NEW.workspace_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    INSERT INTO workspace_file_search_revision (file_id, workspace_id, source_content_updated_at)
    VALUES (NEW.id, NEW.workspace_id, NEW.content_updated_at)
    ON CONFLICT (file_id) DO NOTHING;
    INSERT INTO workspace_file_search_dispatch_queue (workspace_id, enqueued_at, updated_at)
    VALUES (NEW.workspace_id, now(), now())
    ON CONFLICT (workspace_id) DO UPDATE SET updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE TRIGGER workspace_files_search_index_pending
AFTER INSERT OR UPDATE OF content_updated_at, deleted_at, context, workspace_id, discovery ON workspace_files
FOR EACH ROW EXECUTE FUNCTION workspace_file_search_mark_pending();
