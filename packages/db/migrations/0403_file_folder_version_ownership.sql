ALTER TABLE folder ADD COLUMN IF NOT EXISTS project_id text;--> statement-breakpoint
ALTER TABLE folder ALTER COLUMN workspace_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE workspace_file_version ALTER COLUMN workspace_id DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folder_project_id_project_id_fk' AND conrelid = 'folder'::regclass) THEN
    ALTER TABLE folder ADD CONSTRAINT folder_project_id_project_id_fk
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folder_owner_check' AND conrelid = 'folder'::regclass) THEN
    ALTER TABLE folder ADD CONSTRAINT folder_owner_check
      CHECK (num_nonnulls(workspace_id, project_id) = 1 AND (project_id IS NULL OR resource_type = 'file')) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION folder_validate_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hierarchy_changed boolean := true; lock_key text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD.workspace_id, OLD.project_id, OLD.resource_type, OLD.id)
      IS DISTINCT FROM ROW(NEW.workspace_id, NEW.project_id, NEW.resource_type, NEW.id) THEN
      RAISE EXCEPTION 'Folder identity, owner, and resource type cannot be changed' USING ERRCODE = '23514';
    END IF;
    hierarchy_changed := NEW.parent_id IS DISTINCT FROM OLD.parent_id;
  END IF;
  IF hierarchy_changed THEN
    -- Existing workspace writers use this key before taking folder row locks.
    lock_key := 'resource_folders:' || NEW.resource_type::text || ':' ||
      coalesce(NEW.workspace_id, 'project:' || NEW.project_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS folder_validate_owner ON folder;--> statement-breakpoint
CREATE TRIGGER folder_validate_owner
BEFORE INSERT OR UPDATE OF id, workspace_id, project_id, resource_type, parent_id
ON folder FOR EACH ROW EXECUTE FUNCTION folder_validate_owner();--> statement-breakpoint
CREATE OR REPLACE FUNCTION folder_parent_resource_type_match()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  child folder%ROWTYPE;
  ancestor folder%ROWTYPE;
  ancestor_id text;
  seen text[];
BEGIN
  SELECT * INTO child FROM folder WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.parent_id IS NOT DISTINCT FROM child.parent_id
    AND OLD.resource_type = child.resource_type
    AND ROW(OLD.workspace_id, OLD.project_id)
      IS NOT DISTINCT FROM ROW(child.workspace_id, child.project_id) THEN
    RETURN NEW;
  END IF;
  ancestor_id := child.parent_id;
  seen := ARRAY[child.id];
  WHILE ancestor_id IS NOT NULL LOOP
    IF ancestor_id = ANY(seen) THEN
      RAISE EXCEPTION 'Folder hierarchy contains a cycle' USING ERRCODE = '23514';
    END IF;
    seen := array_append(seen, ancestor_id);
    -- Lock every ancestor, so a stale REPEATABLE READ traversal cannot miss a concurrent move.
    SELECT * INTO ancestor FROM folder WHERE id = ancestor_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Folder parent does not exist' USING ERRCODE = '23503'; END IF;
    IF ancestor.resource_type <> child.resource_type
      OR ROW(ancestor.workspace_id, ancestor.project_id)
        IS DISTINCT FROM ROW(child.workspace_id, child.project_id) THEN
      RAISE EXCEPTION 'Folder parent belongs to a different owner or resource type' USING ERRCODE = '23514';
    END IF;
    ancestor_id := ancestor.parent_id;
  END LOOP;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS folder_parent_resource_type_match ON folder;--> statement-breakpoint
-- End-of-statement checks preserve the supported child-before-parent bulk insert order.
CREATE CONSTRAINT TRIGGER folder_parent_resource_type_match
AFTER INSERT OR UPDATE ON folder DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION folder_parent_resource_type_match();--> statement-breakpoint
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
    SELECT entity_type, entity_id INTO previous_type, previous_id
      FROM workspace_file_owner(OLD.context, OLD.workspace_id, OLD.project_id, OLD.organization_id, OLD.user_id);
    IF (ROW(previous_type, previous_id) IS DISTINCT FROM ROW(current_type, current_id)
      OR NEW.context NOT IN ('workspace', 'project'))
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
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_files_validate_relations ON workspace_files;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_files_validate_relations
AFTER INSERT OR UPDATE ON workspace_files DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION workspace_files_validate_relations();--> statement-breakpoint
-- Relationship fences advance the row version without changing durable content or its provenance.
-- Real inserts and metadata/content changes must still normalize before downstream triggers run.
CREATE OR REPLACE FUNCTION workspace_file_content_version_millisecond()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  NEW.content_updated_at := date_trunc('milliseconds', NEW.content_updated_at);
  RETURN NEW;
END;
$$;--> statement-breakpoint
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
  IF parent_type = 'workspace' AND parent.context = 'workspace' THEN
    IF NEW.workspace_id IS NULL THEN NEW.workspace_id := parent_id; END IF;
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
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_file_version_owner_match ON workspace_file_version;--> statement-breakpoint
CREATE TRIGGER workspace_file_version_owner_match
BEFORE INSERT OR UPDATE OF file_id, workspace_id ON workspace_file_version
FOR EACH ROW EXECUTE FUNCTION workspace_file_version_owner_match();--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_file_uploader_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace_files WHERE project_id IS NOT NULL AND user_id = OLD.id)
    OR EXISTS (SELECT 1 FROM folder WHERE project_id IS NOT NULL AND user_id = OLD.id) THEN
    RAISE EXCEPTION 'Project file and folder attribution must be reassigned or retired before deleting its creator'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "folder_project_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "folder_project_id_idx"
ON "folder" USING btree ("project_id", "id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "folder_project_resource_parent_name_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "folder_project_resource_parent_name_active_unique"
ON "folder" USING btree ("project_id", "resource_type", coalesce("parent_id", ''), "name")
WHERE "deleted_at" IS NULL AND "project_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_project_folder_name_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_project_folder_name_active_unique"
ON "workspace_files" USING btree ("project_id", coalesce("folder_id", ''), "original_name")
WHERE "deleted_at" IS NULL AND "project_id" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
