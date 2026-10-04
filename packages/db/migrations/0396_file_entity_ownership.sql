-- Additive ownership metadata. Legacy columns/FKs remain authoritative for legacy writers.
ALTER TABLE "workspace_files" ADD COLUMN IF NOT EXISTS "entity_type" text;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN IF NOT EXISTS "entity_id" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_files_entity_binding_check'
      AND conrelid = 'workspace_files'::regclass
  ) THEN
    ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_entity_binding_check"
      CHECK (
        (entity_type IS NULL AND entity_id IS NULL)
        OR (entity_type IS NOT NULL AND entity_id IS NOT NULL
          AND entity_type IN ('workspace', 'project', 'organization', 'user')
          AND char_length(entity_id) > 0)
      ) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
-- This mapping is deliberately incomplete. Unknown legacy contexts stay unbound until audited.
CREATE OR REPLACE FUNCTION workspace_file_legacy_entity(
  file_context text, file_workspace_id text, file_organization_id text, file_user_id text
) RETURNS TABLE (entity_type text, entity_id text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN file_organization_id IS NULL AND file_workspace_id IS NOT NULL
      AND file_context IN ('workspace', 'mothership', 'execution', 'workspace-logos', 'knowledge-base')
      THEN 'workspace'
    WHEN file_workspace_id IS NULL AND file_organization_id IS NOT NULL
      AND file_context = 'knowledge-base' THEN 'organization'
    WHEN file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context IN ('copilot', 'profile-pictures') THEN 'user'
    END,
    CASE
    WHEN file_organization_id IS NULL AND file_workspace_id IS NOT NULL
      AND file_context IN ('workspace', 'mothership', 'execution', 'workspace-logos', 'knowledge-base')
      THEN file_workspace_id
    WHEN file_workspace_id IS NULL AND file_organization_id IS NOT NULL
      AND file_context = 'knowledge-base' THEN file_organization_id
    WHEN file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context IN ('copilot', 'profile-pictures') THEN file_user_id
    END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_files_sync_entity_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_type text;
  expected_id text;
  legacy_changed boolean := false;
  pair_changed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    legacy_changed := ROW(NEW.context, NEW.workspace_id, NEW.organization_id, NEW.user_id)
      IS DISTINCT FROM ROW(OLD.context, OLD.workspace_id, OLD.organization_id, OLD.user_id);
    pair_changed := ROW(NEW.entity_type, NEW.entity_id)
      IS DISTINCT FROM ROW(OLD.entity_type, OLD.entity_id);
    IF OLD.entity_type = 'project' AND pair_changed THEN
      RAISE EXCEPTION 'Project file ownership cannot change through a metadata update'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.entity_type = 'project' THEN
    IF NEW.entity_id IS NULL OR NEW.entity_id = '' OR NEW.context <> 'project'
      OR NEW.workspace_id IS NOT NULL OR NEW.organization_id IS NOT NULL
      OR NEW.chat_id IS NOT NULL OR NEW.folder_id IS NOT NULL THEN
      RAISE EXCEPTION 'Project file binding conflicts with legacy ownership or an unsupported folder'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' OR OLD.entity_type IS DISTINCT FROM 'project' THEN
      -- A new row version fences parent deletion from an older REPEATABLE READ snapshot.
      -- A read-only parent lock cannot make that snapshot see this newly inserted child.
      UPDATE project SET id = id WHERE id = NEW.entity_id;
    ELSE
      PERFORM 1 FROM project WHERE id = NEW.entity_id FOR KEY SHARE;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Project file owner does not exist' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;

  SELECT entity_type, entity_id INTO expected_type, expected_id
    FROM workspace_file_legacy_entity(NEW.context, NEW.workspace_id, NEW.organization_id, NEW.user_id);

  IF (NEW.entity_type IS NULL AND NEW.entity_id IS NULL)
    OR (TG_OP = 'UPDATE' AND legacy_changed AND NOT pair_changed) THEN
    NEW.entity_type := expected_type;
    NEW.entity_id := expected_id;
  ELSIF ROW(NEW.entity_type, NEW.entity_id) IS DISTINCT FROM ROW(expected_type, expected_id) THEN
    RAISE EXCEPTION 'File entity binding conflicts with its legacy owner or context'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.context = 'project' THEN
    RAISE EXCEPTION 'Project files require explicit Project ownership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_files_sync_entity_binding ON workspace_files;--> statement-breakpoint
CREATE TRIGGER workspace_files_sync_entity_binding
BEFORE INSERT OR UPDATE OF entity_type, entity_id, workspace_id, organization_id, user_id, context, folder_id, chat_id
ON workspace_files FOR EACH ROW EXECUTE FUNCTION workspace_files_sync_entity_binding();--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_file_owner_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id = OLD.id THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM workspace_files WHERE entity_type = 'project' AND entity_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Project files must be retired before their owner is removed'
      USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS project_file_owner_delete_guard ON project;--> statement-breakpoint
CREATE TRIGGER project_file_owner_delete_guard
BEFORE DELETE OR UPDATE OF id ON project
FOR EACH ROW EXECUTE FUNCTION project_file_owner_delete_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_file_uploader_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workspace_files WHERE entity_type = 'project' AND user_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Project file attribution must be reassigned or retired before deleting its uploader'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS project_file_uploader_delete_guard ON "user";--> statement-breakpoint
CREATE TRIGGER project_file_uploader_delete_guard
BEFORE DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION project_file_uploader_delete_guard();--> statement-breakpoint
-- A failed concurrent build is replayable; do not retain an invalid same-name index.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_entity_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_entity_id_idx"
ON "workspace_files" USING btree ("entity_type", "entity_id", "id");--> statement-breakpoint
SET lock_timeout = '5s';
