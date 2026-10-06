CREATE TABLE IF NOT EXISTS "file_search_dependency" (
	"build_id" text NOT NULL,
	"file_id" text NOT NULL,
	"key" text NOT NULL,
	"source_content_updated_at" timestamp NOT NULL,
	CONSTRAINT "file_search_dependency_build_id_file_id_pk" PRIMARY KEY("build_id","file_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_search_dispatch_queue" (
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"enqueued_at" timestamp DEFAULT now() NOT NULL,
	"last_dispatched_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "file_search_dispatch_queue_entity_type_entity_id_pk" PRIMARY KEY("entity_type","entity_id"),
	CONSTRAINT "file_search_dispatch_owner_check" CHECK ("file_search_dispatch_queue"."entity_type" IN ('workspace', 'project') AND length("file_search_dispatch_queue"."entity_id") > 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_file_search_build" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_chunk" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_revision" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_backfill" ADD COLUMN IF NOT EXISTS "after_entity_type" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_backfill" ADD COLUMN IF NOT EXISTS "after_entity_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_build" ADD COLUMN IF NOT EXISTS "artifact_key" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_build" ADD COLUMN IF NOT EXISTS "entity_type" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_build" ADD COLUMN IF NOT EXISTS "entity_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_chunk" ADD COLUMN IF NOT EXISTS "entity_type" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_chunk" ADD COLUMN IF NOT EXISTS "entity_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_revision" ADD COLUMN IF NOT EXISTS "entity_type" text;
--> statement-breakpoint
ALTER TABLE "workspace_file_search_revision" ADD COLUMN IF NOT EXISTS "entity_id" text;
--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_search_dependency_build_id_workspace_file_search_build_id_fk' AND conrelid = 'file_search_dependency'::regclass) THEN
ALTER TABLE "file_search_dependency" ADD CONSTRAINT "file_search_dependency_build_id_workspace_file_search_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."workspace_file_search_build"("id") ON DELETE cascade ON UPDATE no action;
END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_search_dependency_file_idx" ON "file_search_dependency" USING btree ("file_id","build_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_search_dispatch_schedule_idx" ON "file_search_dispatch_queue" USING btree ("last_dispatched_at" NULLS FIRST,"enqueued_at","entity_type","entity_id");
--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_search_build_owner_check' AND conrelid = 'workspace_file_search_build'::regclass) THEN
ALTER TABLE "workspace_file_search_build" ADD CONSTRAINT "file_search_build_owner_check" CHECK (("workspace_file_search_build"."entity_type" IS NULL AND "workspace_file_search_build"."entity_id" IS NULL AND "workspace_file_search_build"."workspace_id" IS NOT NULL) OR ("workspace_file_search_build"."entity_type" = 'workspace' AND "workspace_file_search_build"."entity_id" = "workspace_file_search_build"."workspace_id") OR ("workspace_file_search_build"."entity_type" = 'project' AND length("workspace_file_search_build"."entity_id") > 0 AND "workspace_file_search_build"."workspace_id" IS NULL)) NOT VALID;
END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_search_chunk_owner_check' AND conrelid = 'workspace_file_search_chunk'::regclass) THEN
ALTER TABLE "workspace_file_search_chunk" ADD CONSTRAINT "file_search_chunk_owner_check" CHECK (("workspace_file_search_chunk"."entity_type" IS NULL AND "workspace_file_search_chunk"."entity_id" IS NULL AND "workspace_file_search_chunk"."workspace_id" IS NOT NULL) OR ("workspace_file_search_chunk"."entity_type" = 'workspace' AND "workspace_file_search_chunk"."entity_id" = "workspace_file_search_chunk"."workspace_id") OR ("workspace_file_search_chunk"."entity_type" = 'project' AND length("workspace_file_search_chunk"."entity_id") > 0 AND "workspace_file_search_chunk"."workspace_id" IS NULL)) NOT VALID;
END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_search_revision_owner_check' AND conrelid = 'workspace_file_search_revision'::regclass) THEN
ALTER TABLE "workspace_file_search_revision" ADD CONSTRAINT "file_search_revision_owner_check" CHECK (("workspace_file_search_revision"."entity_type" IS NULL AND "workspace_file_search_revision"."entity_id" IS NULL AND "workspace_file_search_revision"."workspace_id" IS NOT NULL) OR ("workspace_file_search_revision"."entity_type" = 'workspace' AND "workspace_file_search_revision"."entity_id" = "workspace_file_search_revision"."workspace_id") OR ("workspace_file_search_revision"."entity_type" = 'project' AND length("workspace_file_search_revision"."entity_id") > 0 AND "workspace_file_search_revision"."workspace_id" IS NULL)) NOT VALID;
END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION file_search_bind_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_type text; target_id text;
BEGIN
  IF NEW.entity_type IS NULL AND NEW.entity_id IS NULL AND NEW.workspace_id IS NOT NULL THEN
    NEW.entity_type := 'workspace'; NEW.entity_id := NEW.workspace_id;
  END IF;
  IF NOT coalesce((NEW.entity_type = 'workspace' AND NEW.workspace_id IS NOT NULL AND NEW.entity_id = NEW.workspace_id)
    OR (NEW.entity_type = 'project' AND NEW.workspace_id IS NULL AND length(NEW.entity_id) > 0), false) THEN
    RAISE EXCEPTION 'File search requires a supported canonical owner' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'workspace_file_search_chunk' THEN
    SELECT coalesce(entity_type, 'workspace'), coalesce(entity_id, workspace_id)
      INTO target_type, target_id FROM workspace_file_search_build WHERE id = NEW.build_id;
  ELSE
    SELECT CASE WHEN project_id IS NOT NULL THEN 'project' ELSE 'workspace' END, coalesce(project_id, workspace_id)
      INTO target_type, target_id FROM workspace_files
      WHERE id = NEW.file_id AND context IN ('workspace', 'project') FOR SHARE;
  END IF;
  IF NOT FOUND OR ROW(NEW.entity_type, NEW.entity_id) IS DISTINCT FROM ROW(target_type, target_id) THEN
    RAISE EXCEPTION 'File search scope does not match its canonical parent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS file_search_build_owner ON workspace_file_search_build;
--> statement-breakpoint
CREATE TRIGGER file_search_build_owner BEFORE INSERT OR UPDATE OF entity_type, entity_id, workspace_id, file_id
ON workspace_file_search_build FOR EACH ROW EXECUTE FUNCTION file_search_bind_owner();
--> statement-breakpoint
DROP TRIGGER IF EXISTS file_search_revision_owner ON workspace_file_search_revision;
--> statement-breakpoint
CREATE TRIGGER file_search_revision_owner BEFORE INSERT OR UPDATE OF entity_type, entity_id, workspace_id, file_id
ON workspace_file_search_revision FOR EACH ROW EXECUTE FUNCTION file_search_bind_owner();
--> statement-breakpoint
DROP TRIGGER IF EXISTS file_search_chunk_owner ON workspace_file_search_chunk;
--> statement-breakpoint
CREATE TRIGGER file_search_chunk_owner BEFORE INSERT OR UPDATE OF entity_type, entity_id, workspace_id, build_id
ON workspace_file_search_chunk FOR EACH ROW EXECUTE FUNCTION file_search_bind_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_file_search_mark_pending()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_type text; owner_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE workspace_file_search_build SET expires_at = now()
      WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = OLD.id);
    owner_type := CASE WHEN OLD.project_id IS NOT NULL THEN 'project' WHEN OLD.context = 'workspace' THEN 'workspace' END;
    owner_id := coalesce(OLD.project_id, OLD.workspace_id);
    IF owner_type IN ('workspace', 'project') AND OLD.context = owner_type AND owner_id IS NOT NULL THEN
      INSERT INTO file_search_dispatch_queue (entity_type, entity_id) VALUES (owner_type, owner_id)
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET updated_at = now();
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.content_updated_at, NEW.deleted_at, NEW.context, NEW.workspace_id, NEW.project_id)
      IS NOT DISTINCT FROM ROW(OLD.content_updated_at, OLD.deleted_at, OLD.context, OLD.workspace_id, OLD.project_id) THEN
      RETURN NEW;
    END IF;
    UPDATE workspace_file_search_build SET expires_at = now()
      WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = NEW.id);
    DELETE FROM workspace_file_search_revision WHERE file_id = NEW.id;
    IF ROW(NEW.context, NEW.workspace_id, NEW.project_id)
      IS DISTINCT FROM ROW(OLD.context, OLD.workspace_id, OLD.project_id) THEN
      owner_type := CASE WHEN OLD.project_id IS NOT NULL THEN 'project' WHEN OLD.context = 'workspace' THEN 'workspace' END;
      owner_id := coalesce(OLD.project_id, OLD.workspace_id);
      IF owner_type IN ('workspace', 'project') AND OLD.context = owner_type AND owner_id IS NOT NULL THEN
        INSERT INTO file_search_dispatch_queue (entity_type, entity_id) VALUES (owner_type, owner_id)
          ON CONFLICT (entity_type, entity_id) DO UPDATE SET updated_at = now();
      END IF;
    END IF;
  END IF;
  owner_type := CASE WHEN NEW.project_id IS NOT NULL THEN 'project' WHEN NEW.context = 'workspace' THEN 'workspace' END;
  owner_id := coalesce(NEW.project_id, NEW.workspace_id);
  IF owner_type IN ('workspace', 'project') AND NEW.context = owner_type AND owner_id IS NOT NULL THEN
    -- Waking the owner also reconciles bounded dependent builds without rewriting their sources here.
    INSERT INTO file_search_dispatch_queue (entity_type, entity_id) VALUES (owner_type, owner_id)
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET updated_at = now();
    IF NEW.deleted_at IS NULL THEN
      INSERT INTO workspace_file_search_revision (file_id, workspace_id, entity_type, entity_id, source_content_updated_at)
      VALUES (NEW.id, NEW.workspace_id, owner_type, owner_id, NEW.content_updated_at)
      ON CONFLICT (file_id) DO NOTHING;
      IF owner_type = 'workspace' THEN
        INSERT INTO workspace_file_search_dispatch_queue (workspace_id, enqueued_at, updated_at)
        VALUES (owner_id, now(), now()) ON CONFLICT (workspace_id) DO UPDATE SET updated_at = now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_search_chunk_owner_content_idx" ON "workspace_file_search_chunk" USING gin ("entity_type" text_ops,"entity_id" text_ops,"content" gin_trgm_ops) WITH (fastupdate=off) WHERE "workspace_file_search_chunk"."entity_type" = 'project';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_search_revision_owner_pending_idx" ON "workspace_file_search_revision" USING btree (coalesce("entity_type", 'workspace'),coalesce("entity_id", "workspace_id"),"updated_at","file_id","source_content_updated_at") WHERE "workspace_file_search_revision"."status" = 'pending' AND "workspace_file_search_revision"."dispatched_at" IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_search_revision_owner_status_idx" ON "workspace_file_search_revision" USING btree (coalesce("entity_type", 'workspace'),coalesce("entity_id", "workspace_id"),"status","dispatched_at");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_search_owner_keyset_idx" ON "workspace_files" USING btree ((CASE WHEN "project_id" IS NOT NULL THEN 'project' ELSE 'workspace' END),coalesce("project_id", "workspace_id"),"id") WHERE "workspace_files"."deleted_at" IS NULL AND (("workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL) OR ("workspace_files"."context" = 'project' AND "workspace_files"."project_id" IS NOT NULL));
--> statement-breakpoint
SET lock_timeout = '5s';
