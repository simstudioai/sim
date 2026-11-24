CREATE TABLE "workflow_build_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"notes_file_id" text NOT NULL,
	"baseline_file_id" text,
	"evaluated_notes_hash" text,
	"evaluated_operations_hash" text,
	"baseline_workflow_updated_at" timestamp,
	"created_by_user_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_build_notes" ADD CONSTRAINT "workflow_build_notes_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_build_notes" ADD CONSTRAINT "workflow_build_notes_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_build_notes" ADD CONSTRAINT "workflow_build_notes_notes_file_id_workspace_files_id_fk" FOREIGN KEY ("notes_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_build_notes" ADD CONSTRAINT "workflow_build_notes_baseline_file_id_workspace_files_id_fk" FOREIGN KEY ("baseline_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_build_notes" ADD CONSTRAINT "workflow_build_notes_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_build_notes_workflow_unique" ON "workflow_build_notes" USING btree ("workflow_id") WHERE "workflow_build_notes"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_build_notes_notes_file_unique" ON "workflow_build_notes" USING btree ("notes_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_build_notes_baseline_file_unique" ON "workflow_build_notes" USING btree ("baseline_file_id");--> statement-breakpoint
CREATE INDEX "workflow_build_notes_workspace_idx" ON "workflow_build_notes" USING btree ("workspace_id");--> statement-breakpoint
-- Build-notes files are workspace-owned files with retained history, like test files and release bodies.
CREATE OR REPLACE FUNCTION workspace_file_owner(
  file_context text, file_workspace_id text, file_project_id text, file_organization_id text, file_user_id text
) RETURNS TABLE (entity_type text, entity_id text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN file_project_id IS NOT NULL AND file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context = 'project' THEN 'project'
    WHEN file_project_id IS NULL AND file_organization_id IS NULL AND file_workspace_id IS NOT NULL
      AND file_context IN ('workspace', 'chat', 'mothership', 'execution', 'workspace-logos', 'knowledge-base', 'test', 'changelog', 'build_notes')
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
      AND file_context IN ('workspace', 'chat', 'mothership', 'execution', 'workspace-logos', 'knowledge-base', 'test', 'changelog', 'build_notes')
      THEN file_workspace_id
    WHEN file_project_id IS NULL AND file_workspace_id IS NULL AND file_organization_id IS NOT NULL
      AND file_context = 'knowledge-base' THEN file_organization_id
    WHEN file_project_id IS NULL AND file_workspace_id IS NULL AND file_organization_id IS NULL
      AND file_context IN ('copilot', 'profile-pictures') THEN file_user_id
    END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_files_validate_relations()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_type text;
  previous_id text;
  current_type text;
  current_id text;
  target folder%ROWTYPE;
BEGIN
  SELECT entity_type, entity_id INTO current_type, current_id
    FROM workspace_file_owner(NEW.context, NEW.workspace_id, NEW.project_id, NEW.organization_id, NEW.user_id);
  IF TG_OP = 'UPDATE' THEN
    IF OLD.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'Project file ownership cannot change through a metadata update' USING ERRCODE = '23514';
    END IF;
    SELECT entity_type, entity_id INTO previous_type, previous_id
      FROM workspace_file_owner(OLD.context, OLD.workspace_id, OLD.project_id, OLD.organization_id, OLD.user_id);
    IF (ROW(previous_type, previous_id) IS DISTINCT FROM ROW(current_type, current_id)
      OR NEW.context NOT IN ('workspace', 'project', 'test', 'changelog', 'build_notes'))
      AND EXISTS (SELECT 1 FROM workspace_file_version WHERE file_id = NEW.id) THEN
      RAISE EXCEPTION 'A file with retained history cannot change its owner' USING ERRCODE = '23514';
    END IF;
    IF OLD.folder_id IS NOT DISTINCT FROM NEW.folder_id
      AND ROW(previous_type, previous_id) IS NOT DISTINCT FROM ROW(current_type, current_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.folder_id IS NOT NULL THEN
    SELECT * INTO target FROM folder WHERE id = NEW.folder_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'File folder does not exist' USING ERRCODE = '23503'; END IF;
    IF target.resource_type <> 'file' OR current_type IS NULL OR current_id IS NULL
      OR ROW(target.workspace_id, target.project_id)
        IS DISTINCT FROM ROW(NEW.workspace_id, NEW.project_id) THEN
      RAISE EXCEPTION 'File folder belongs to a different owner or resource type' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_file_version_owner_match()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent workspace_files%ROWTYPE;
  parent_type text;
  parent_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.file_id IS DISTINCT FROM OLD.file_id THEN
    RAISE EXCEPTION 'A retained version cannot be moved to another file' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Fence owner changes against versions committed after an older transaction snapshot.
    UPDATE workspace_files SET id = id WHERE id = NEW.file_id RETURNING * INTO parent;
  ELSE
    SELECT * INTO parent FROM workspace_files WHERE id = NEW.file_id FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version file does not exist' USING ERRCODE = '23503'; END IF;
  SELECT entity_type, entity_id INTO parent_type, parent_id
    FROM workspace_file_owner(parent.context, parent.workspace_id, parent.project_id, parent.organization_id, parent.user_id);
  IF parent_type = 'workspace' AND parent.context IN ('workspace', 'test', 'changelog', 'build_notes') THEN
    IF NEW.workspace_id IS DISTINCT FROM parent_id THEN
      RAISE EXCEPTION 'Version workspace differs from its file owner' USING ERRCODE = '23514';
    END IF;
  ELSIF parent_type = 'project' AND parent.context = 'project' AND NEW.workspace_id IS NULL THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'File version has an unsupported or conflicting owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
