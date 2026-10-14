CREATE OR REPLACE FUNCTION project_file_uploader_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace_files WHERE user_id = OLD.id AND project_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM folder WHERE user_id = OLD.id AND project_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Project resource creators must be handed to a successor before account deletion' USING ERRCODE = '23514', CONSTRAINT = 'project_resource_creator_handoff';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS project_file_uploader_delete_guard ON "user";--> statement-breakpoint
CREATE TRIGGER project_file_uploader_delete_guard
BEFORE DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION project_file_uploader_delete_guard();
