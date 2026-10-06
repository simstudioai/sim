ALTER TABLE "public_share" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "public_share" ADD COLUMN IF NOT EXISTS "entity_type" text;--> statement-breakpoint
ALTER TABLE "public_share" ADD COLUMN IF NOT EXISTS "entity_id" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_share_entity_binding_check' AND conrelid = 'public_share'::regclass) THEN
ALTER TABLE "public_share" ADD CONSTRAINT "public_share_entity_binding_check" CHECK (
      ("public_share"."entity_type" IS NULL AND "public_share"."entity_id" IS NULL AND "public_share"."workspace_id" IS NOT NULL)
      OR ("public_share"."entity_type" IS NOT NULL AND "public_share"."entity_id" IS NOT NULL AND char_length("public_share"."entity_id") > 0
        AND (("public_share"."entity_type" = 'workspace' AND "public_share"."workspace_id" IS NOT NULL AND "public_share"."entity_id" = "public_share"."workspace_id")
          OR ("public_share"."entity_type" = 'project' AND "public_share"."workspace_id" IS NULL AND "public_share"."resource_type" = 'file')))
    ) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public_share_sync_entity_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target workspace_files%ROWTYPE;
  target_type text;
  target_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.resource_type, NEW.resource_id, NEW.workspace_id)
      IS DISTINCT FROM ROW(OLD.resource_type, OLD.resource_id, OLD.workspace_id)
      OR (OLD.entity_type IS NOT NULL AND ROW(NEW.entity_type, NEW.entity_id)
        IS DISTINCT FROM ROW(OLD.entity_type, OLD.entity_id)) THEN
      RAISE EXCEPTION 'A public share cannot change its resource or owner' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.entity_type IS NULL AND NEW.entity_id IS NULL AND NEW.workspace_id IS NOT NULL THEN
    NEW.entity_type := 'workspace';
    NEW.entity_id := NEW.workspace_id;
  END IF;
  IF NOT coalesce(
    (NEW.entity_type = 'workspace' AND NEW.workspace_id IS NOT NULL AND NEW.entity_id = NEW.workspace_id)
    OR (NEW.entity_type = 'project' AND NEW.entity_id <> '' AND NEW.workspace_id IS NULL AND NEW.resource_type = 'file'),
    false
  ) THEN
    RAISE EXCEPTION 'Public share requires a compatible workspace or Project owner' USING ERRCODE = '23514';
  END IF;
  IF NEW.resource_type = 'file' THEN
    -- A parent row version also fences deletion from an older REPEATABLE READ snapshot.
    UPDATE workspace_files SET id = id WHERE id = NEW.resource_id RETURNING * INTO target;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Public share file does not exist' USING ERRCODE = '23503';
    END IF;
    SELECT entity_type, entity_id INTO target_type, target_id
      FROM workspace_file_owner(target.context, target.workspace_id, target.project_id, target.organization_id, target.user_id);
    IF ROW(NEW.entity_type, NEW.entity_id) IS DISTINCT FROM ROW(target_type, target_id) THEN
      RAISE EXCEPTION 'Public share file belongs to a different or unknown owner' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS public_share_entity_binding ON public_share;--> statement-breakpoint
-- Configuration updates do not reacquire the parent after locking the share row.
CREATE TRIGGER public_share_entity_binding
BEFORE INSERT OR UPDATE OF resource_type, resource_id, workspace_id, entity_type, entity_id
ON public_share FOR EACH ROW EXECUTE FUNCTION public_share_sync_entity_binding();--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_file_retire_public_shares()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_type text;
  previous_id text;
  current_type text;
  current_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public_share WHERE resource_type = 'file' AND resource_id = OLD.id;
    RETURN OLD;
  END IF;
  SELECT entity_type, entity_id INTO previous_type, previous_id
    FROM workspace_file_owner(OLD.context, OLD.workspace_id, OLD.project_id, OLD.organization_id, OLD.user_id);
  SELECT entity_type, entity_id INTO current_type, current_id
    FROM workspace_file_owner(NEW.context, NEW.workspace_id, NEW.project_id, NEW.organization_id, NEW.user_id);
  IF NEW.id IS DISTINCT FROM OLD.id
    OR ROW(previous_type, previous_id) IS DISTINCT FROM ROW(current_type, current_id) THEN
    DELETE FROM public_share WHERE resource_type = 'file' AND resource_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_file_retire_public_shares ON workspace_files;--> statement-breakpoint
CREATE TRIGGER workspace_file_retire_public_shares
AFTER DELETE OR UPDATE OF id, project_id, workspace_id, organization_id, user_id, context
ON workspace_files FOR EACH ROW EXECUTE FUNCTION workspace_file_retire_public_shares();--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "public_share_entity_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "public_share_entity_id_idx" ON "public_share" USING btree ("entity_type","entity_id","resource_type");
--> statement-breakpoint
SET lock_timeout = '5s';
