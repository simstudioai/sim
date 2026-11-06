ALTER TABLE "file_search_dependency" ADD COLUMN IF NOT EXISTS "entity_type" text;
--> statement-breakpoint
ALTER TABLE "file_search_dependency" ADD COLUMN IF NOT EXISTS "entity_id" text;
--> statement-breakpoint
-- The owner is always the build's, so deployed writers that omit it still produce addressable rows.
CREATE OR REPLACE FUNCTION file_search_dependency_bind_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(entity_type, 'workspace'), coalesce(entity_id, workspace_id)
    INTO NEW.entity_type, NEW.entity_id
    FROM workspace_file_search_build WHERE id = NEW.build_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS file_search_dependency_owner ON file_search_dependency;
--> statement-breakpoint
CREATE TRIGGER file_search_dependency_owner BEFORE INSERT OR UPDATE OF build_id, entity_type, entity_id
ON file_search_dependency FOR EACH ROW EXECUTE FUNCTION file_search_dependency_bind_owner();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('file_search_dependency_owner_idx_failed')
      AND (indisvalid OR indrelid <> 'file_search_dependency'::regclass)
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index file_search_dependency_owner_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('file_search_dependency_owner_idx')
      AND indrelid = 'file_search_dependency'::regclass AND NOT indisvalid
  ) THEN
    ALTER INDEX file_search_dependency_owner_idx RENAME TO file_search_dependency_owner_idx_failed;
  END IF;
END $$;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
-- Runs after COMMIT so the table locks above are released first. Every row committed before them
-- is visible here and every later insert passes through the trigger; dependency rows exist only for
-- compiled documents with referenced inputs, so this is one short, replay-safe statement.
UPDATE file_search_dependency dependency
SET entity_type = coalesce(build.entity_type, 'workspace'),
  entity_id = coalesce(build.entity_id, build.workspace_id)
FROM workspace_file_search_build build
WHERE build.id = dependency.build_id
  AND (dependency.entity_type IS NULL OR dependency.entity_id IS NULL);
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "file_search_dependency_owner_idx_failed";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_search_dependency_owner_idx" ON "file_search_dependency" USING btree ("entity_type","entity_id","build_id");
--> statement-breakpoint
SET lock_timeout = '5s';
