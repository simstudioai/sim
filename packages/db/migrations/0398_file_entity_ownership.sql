ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS project_id text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_files_project_id_project_id_fk' AND conrelid = 'workspace_files'::regclass) THEN
    ALTER TABLE workspace_files ADD CONSTRAINT workspace_files_project_id_project_id_fk
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_files_owner_check' AND conrelid = 'workspace_files'::regclass) THEN
    ALTER TABLE workspace_files ADD CONSTRAINT workspace_files_owner_check
      CHECK (num_nonnulls(workspace_id, project_id, organization_id) <= 1) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_files_project_binding_check' AND conrelid = 'workspace_files'::regclass) THEN
    ALTER TABLE workspace_files ADD CONSTRAINT workspace_files_project_binding_check
      CHECK ((project_id IS NOT NULL) = (context = 'project') AND (project_id IS NULL OR chat_id IS NULL)) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_file_owner(
  file_context text, file_workspace_id text, file_project_id text, file_organization_id text, file_user_id text
) RETURNS TABLE (entity_type text, entity_id text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN file_project_id IS NOT NULL AND file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context = 'project' THEN 'project'
    WHEN file_project_id IS NULL AND file_organization_id IS NULL AND file_workspace_id IS NOT NULL
      AND file_context IN ('workspace', 'mothership', 'execution', 'workspace-logos', 'knowledge-base')
      THEN 'workspace'
    WHEN file_project_id IS NULL AND file_workspace_id IS NULL AND file_organization_id IS NOT NULL
      AND file_context = 'knowledge-base' THEN 'organization'
    WHEN file_project_id IS NULL AND file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context IN ('copilot', 'profile-pictures') THEN 'user'
    END,
    CASE
    WHEN file_project_id IS NOT NULL AND file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context = 'project' THEN file_project_id
    WHEN file_project_id IS NULL AND file_organization_id IS NULL AND file_workspace_id IS NOT NULL
      AND file_context IN ('workspace', 'mothership', 'execution', 'workspace-logos', 'knowledge-base')
      THEN file_workspace_id
    WHEN file_project_id IS NULL AND file_workspace_id IS NULL AND file_organization_id IS NOT NULL
      AND file_context = 'knowledge-base' THEN file_organization_id
    WHEN file_project_id IS NULL AND file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context IN ('copilot', 'profile-pictures') THEN file_user_id
    END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_files_preserve_project_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Project file ownership cannot change through a metadata update' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_files_preserve_project_owner ON workspace_files;--> statement-breakpoint
CREATE TRIGGER workspace_files_preserve_project_owner
BEFORE UPDATE OF project_id ON workspace_files
FOR EACH ROW EXECUTE FUNCTION workspace_files_preserve_project_owner();--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_file_uploader_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workspace_files WHERE project_id IS NOT NULL AND user_id = OLD.id
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
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_project_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_project_id_idx"
ON "workspace_files" USING btree ("project_id", "id");--> statement-breakpoint
SET lock_timeout = '5s';
