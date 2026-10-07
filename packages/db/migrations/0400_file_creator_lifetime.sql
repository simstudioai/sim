DROP TRIGGER IF EXISTS project_file_uploader_delete_guard ON "user";--> statement-breakpoint
DROP FUNCTION IF EXISTS project_file_uploader_delete_guard();--> statement-breakpoint
ALTER TABLE "folder" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folder_creator_lifetime_check' AND conrelid = 'folder'::regclass) THEN
    ALTER TABLE folder ADD CONSTRAINT folder_creator_lifetime_check CHECK (
      user_id IS NOT NULL OR (resource_type = 'file' AND num_nonnulls(workspace_id, project_id) = 1)
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_files_creator_lifetime_check' AND conrelid = 'workspace_files'::regclass) THEN
    ALTER TABLE workspace_files ADD CONSTRAINT workspace_files_creator_lifetime_check CHECK (
      user_id IS NOT NULL OR (context IN ('workspace', 'project') AND num_nonnulls(workspace_id, project_id) = 1 AND organization_id IS NULL)
    ) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION file_require_creator()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'New file resources require their actual creator' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS folder_require_creator ON folder;--> statement-breakpoint
CREATE TRIGGER folder_require_creator
BEFORE INSERT ON folder
FOR EACH ROW EXECUTE FUNCTION file_require_creator();--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_files_require_creator ON workspace_files;--> statement-breakpoint
CREATE TRIGGER workspace_files_require_creator
BEFORE INSERT ON workspace_files
FOR EACH ROW EXECUTE FUNCTION file_require_creator();--> statement-breakpoint
CREATE OR REPLACE FUNCTION shared_file_creator_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE workspace_files SET user_id = NULL
    WHERE user_id = OLD.id AND context IN ('workspace', 'project')
      AND num_nonnulls(workspace_id, project_id) = 1 AND organization_id IS NULL;
  UPDATE folder SET user_id = NULL
    WHERE user_id = OLD.id AND resource_type = 'file'
      AND num_nonnulls(workspace_id, project_id) = 1;
  RETURN OLD;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS shared_file_creator_delete ON "user";--> statement-breakpoint
CREATE TRIGGER shared_file_creator_delete
BEFORE DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION shared_file_creator_delete();
