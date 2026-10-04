ALTER TABLE "folder" ADD COLUMN IF NOT EXISTS "original_creator_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN IF NOT EXISTS "original_creator_user_id" text;--> statement-breakpoint
ALTER TABLE "folder" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folder_creator_lifetime_check' AND conrelid = 'folder'::regclass) THEN
    ALTER TABLE folder ADD CONSTRAINT folder_creator_lifetime_check CHECK (
      user_id IS NOT NULL OR coalesce(entity_type = 'project' AND char_length(original_creator_user_id) > 0, false)
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_files_creator_lifetime_check' AND conrelid = 'workspace_files'::regclass) THEN
    ALTER TABLE workspace_files ADD CONSTRAINT workspace_files_creator_lifetime_check CHECK (
      user_id IS NOT NULL OR coalesce(entity_type = 'project' AND char_length(original_creator_user_id) > 0, false)
    ) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_file_creator_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original_creator text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'New file resources require their actual creator' USING ERRCODE = '23514';
    END IF;
    IF NEW.entity_type = 'project' THEN
      IF NEW.original_creator_user_id IS NOT NULL AND NEW.original_creator_user_id IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'Project creator snapshot must match its actual creator' USING ERRCODE = '23514';
      END IF;
      NEW.original_creator_user_id := NEW.user_id;
    ELSIF NEW.original_creator_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Creator snapshots are reserved for Project resources' USING ERRCODE = '23514';
    END IF;
  ELSE
    original_creator := coalesce(OLD.original_creator_user_id,
      CASE WHEN OLD.entity_type = 'project' OR NEW.entity_type = 'project' THEN OLD.user_id ELSE NULL END);
    IF original_creator IS NOT NULL THEN
      IF (OLD.original_creator_user_id IS NOT NULL AND NEW.original_creator_user_id IS DISTINCT FROM OLD.original_creator_user_id)
        OR (NEW.original_creator_user_id IS NOT NULL AND NEW.original_creator_user_id IS DISTINCT FROM original_creator)
        OR (NEW.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM original_creator) THEN
        RAISE EXCEPTION 'Project original creator attribution cannot be changed' USING ERRCODE = '23514';
      END IF;
      NEW.original_creator_user_id := original_creator;
    ELSIF NEW.original_creator_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Project original creator attribution is unavailable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.user_id IS NULL AND (NEW.entity_type IS DISTINCT FROM 'project'
    OR NEW.original_creator_user_id IS NULL OR NEW.original_creator_user_id = '') THEN
    RAISE EXCEPTION 'Only attributed Project resources may outlive their creator account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS folder_creator_lifetime ON folder;--> statement-breakpoint
CREATE TRIGGER folder_creator_lifetime
BEFORE INSERT OR UPDATE OF user_id, original_creator_user_id, entity_type ON folder
FOR EACH ROW EXECUTE FUNCTION project_file_creator_snapshot();--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_files_creator_lifetime ON workspace_files;--> statement-breakpoint
CREATE TRIGGER workspace_files_creator_lifetime
BEFORE INSERT OR UPDATE OF user_id, original_creator_user_id, entity_type ON workspace_files
FOR EACH ROW EXECUTE FUNCTION project_file_creator_snapshot();--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_file_uploader_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Retain original authorship without substituting a new owner, payer, or creator.
  UPDATE workspace_files
    SET original_creator_user_id = coalesce(original_creator_user_id, user_id), user_id = NULL
    WHERE entity_type = 'project' AND user_id = OLD.id;
  UPDATE folder
    SET original_creator_user_id = coalesce(original_creator_user_id, user_id), user_id = NULL
    WHERE entity_type = 'project' AND user_id = OLD.id;
  RETURN OLD;
END;
$$;--> statement-breakpoint
