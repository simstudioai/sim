-- Nullable compatibility fields preserve all legacy writers while adding Project file folders.
ALTER TABLE "folder" ADD COLUMN IF NOT EXISTS "entity_type" text;--> statement-breakpoint
ALTER TABLE "folder" ADD COLUMN IF NOT EXISTS "entity_id" text;--> statement-breakpoint
ALTER TABLE "folder" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_file_version" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folder_entity_binding_check'
      AND conrelid = 'folder'::regclass
  ) THEN
    ALTER TABLE folder ADD CONSTRAINT folder_entity_binding_check CHECK (
      (entity_type IS NULL AND entity_id IS NULL AND workspace_id IS NOT NULL)
      OR (entity_type IS NOT NULL AND entity_id IS NOT NULL AND char_length(entity_id) > 0
        AND ((entity_type = 'workspace' AND workspace_id IS NOT NULL AND entity_id = workspace_id)
          OR (entity_type = 'project' AND workspace_id IS NULL AND resource_type = 'file')))
    ) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION folder_sync_entity_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_type text;
  previous_id text;
  hierarchy_changed boolean := true;
  lock_key text;
BEGIN
  IF NEW.workspace_id IS NOT NULL THEN
    IF NEW.entity_type IS NULL AND NEW.entity_id IS NULL THEN
      NEW.entity_type := 'workspace';
      NEW.entity_id := NEW.workspace_id;
    ELSIF NEW.entity_type IS DISTINCT FROM 'workspace' OR NEW.entity_id IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'Folder entity conflicts with its workspace' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.entity_type IS DISTINCT FROM 'project' OR NEW.entity_id IS NULL OR NEW.entity_id = ''
    OR NEW.resource_type <> 'file' THEN
    RAISE EXCEPTION 'Only Project file folders may omit workspace ownership' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    previous_type := coalesce(OLD.entity_type, 'workspace');
    previous_id := coalesce(OLD.entity_id, OLD.workspace_id);
    IF ROW(previous_type, previous_id, OLD.resource_type, OLD.id)
      IS DISTINCT FROM ROW(NEW.entity_type, NEW.entity_id, NEW.resource_type, NEW.id) THEN
      RAISE EXCEPTION 'Folder identity, owner, and resource type cannot be changed' USING ERRCODE = '23514';
    END IF;
    hierarchy_changed := NEW.parent_id IS DISTINCT FROM OLD.parent_id;
  END IF;

  IF NEW.entity_type = 'project' THEN
    IF TG_OP = 'INSERT' THEN
      -- Fence stale-snapshot Project deletion without changing public parent fields.
      UPDATE project SET id = id WHERE id = NEW.entity_id;
    ELSE
      PERFORM 1 FROM project WHERE id = NEW.entity_id FOR KEY SHARE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Project folder owner does not exist' USING ERRCODE = '23503'; END IF;
  END IF;

  IF hierarchy_changed THEN
    -- Existing workspace writers already use this key before taking folder row locks.
    lock_key := 'resource_folders:' || NEW.resource_type::text || ':' ||
      CASE WHEN NEW.entity_type = 'workspace' THEN NEW.entity_id ELSE NEW.entity_type || ':' || NEW.entity_id END;
    PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS folder_entity_binding ON folder;--> statement-breakpoint
CREATE TRIGGER folder_entity_binding
BEFORE INSERT OR UPDATE OF id, entity_type, entity_id, workspace_id, resource_type, parent_id
ON folder FOR EACH ROW EXECUTE FUNCTION folder_sync_entity_binding();--> statement-breakpoint
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
  child.entity_type := coalesce(child.entity_type, 'workspace');
  child.entity_id := coalesce(child.entity_id, child.workspace_id);
  IF TG_OP = 'UPDATE' AND OLD.parent_id IS NOT DISTINCT FROM child.parent_id
    AND OLD.resource_type = child.resource_type
    AND ROW(coalesce(OLD.entity_type, 'workspace'), coalesce(OLD.entity_id, OLD.workspace_id))
      IS NOT DISTINCT FROM ROW(child.entity_type, child.entity_id) THEN
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
      OR ROW(coalesce(ancestor.entity_type, 'workspace'), coalesce(ancestor.entity_id, ancestor.workspace_id))
        IS DISTINCT FROM ROW(child.entity_type, child.entity_id) THEN
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
      OR NEW.chat_id IS NOT NULL THEN
      RAISE EXCEPTION 'Project file binding conflicts with legacy ownership'
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
CREATE OR REPLACE FUNCTION workspace_files_validate_relations()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_type text;
  previous_id text;
  current_type text;
  current_id text;
  target folder%ROWTYPE;
BEGIN
  current_type := NEW.entity_type;
  current_id := NEW.entity_id;
  IF current_type IS NULL AND current_id IS NULL THEN
    SELECT entity_type, entity_id INTO current_type, current_id
      FROM workspace_file_legacy_entity(NEW.context, NEW.workspace_id, NEW.organization_id, NEW.user_id);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    previous_type := OLD.entity_type;
    previous_id := OLD.entity_id;
    IF previous_type IS NULL AND previous_id IS NULL THEN
      SELECT entity_type, entity_id INTO previous_type, previous_id
        FROM workspace_file_legacy_entity(OLD.context, OLD.workspace_id, OLD.organization_id, OLD.user_id);
    END IF;
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
      OR ROW(coalesce(target.entity_type, 'workspace'), coalesce(target.entity_id, target.workspace_id))
        IS DISTINCT FROM ROW(current_type, current_id) THEN
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
  parent_type := parent.entity_type;
  parent_id := parent.entity_id;
  IF parent_type IS NULL AND parent_id IS NULL THEN
    SELECT entity_type, entity_id INTO parent_type, parent_id
      FROM workspace_file_legacy_entity(parent.context, parent.workspace_id, parent.organization_id, parent.user_id);
  END IF;
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
CREATE OR REPLACE FUNCTION project_file_owner_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id = OLD.id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM workspace_files WHERE entity_type = 'project' AND entity_id = OLD.id)
    OR EXISTS (SELECT 1 FROM folder WHERE entity_type = 'project' AND entity_id = OLD.id) THEN
    RAISE EXCEPTION 'Project files and folders must be retired before their owner is removed'
      USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_file_uploader_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace_files WHERE entity_type = 'project' AND user_id = OLD.id)
    OR EXISTS (SELECT 1 FROM folder WHERE entity_type = 'project' AND user_id = OLD.id) THEN
    RAISE EXCEPTION 'Project file and folder attribution must be reassigned or retired before deleting its creator'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "folder_entity_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "folder_entity_id_idx"
ON "folder" USING btree ("entity_type", "entity_id", "id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "folder_entity_resource_parent_name_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "folder_entity_resource_parent_name_active_unique"
ON "folder" USING btree ("entity_type", "entity_id", "resource_type", coalesce("parent_id", ''), "name")
WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_entity_folder_name_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_entity_folder_name_active_unique"
ON "workspace_files" USING btree ("entity_type", "entity_id", coalesce("folder_id", ''), "original_name")
WHERE "deleted_at" IS NULL AND "context" IN ('workspace', 'project');--> statement-breakpoint
SET lock_timeout = '5s';
