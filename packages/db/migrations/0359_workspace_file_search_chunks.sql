CREATE TABLE "workspace_file_search_build" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_content_updated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workspace_file_search_chunk" (
	"build_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"line_start" integer NOT NULL,
	"fragment" boolean NOT NULL,
	"overlap" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	CONSTRAINT "workspace_file_search_chunk_pk" PRIMARY KEY("build_id","ordinal"),
	CONSTRAINT "workspace_file_search_chunk_content_size" CHECK (octet_length("workspace_file_search_chunk"."content") <= 8192),
	CONSTRAINT "workspace_file_search_chunk_position" CHECK ("workspace_file_search_chunk"."ordinal" >= 0 AND "workspace_file_search_chunk"."line_start" > 0 AND "workspace_file_search_chunk"."overlap" BETWEEN 0 AND 2)
);
--> statement-breakpoint
CREATE TABLE "workspace_file_search_revision" (
	"file_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_content_updated_at" timestamp NOT NULL,
	"status" "workspace_file_search_index_status" DEFAULT 'pending' NOT NULL,
	"build_id" text,
	"failure_reason" text,
	"line_count" integer DEFAULT 0 NOT NULL,
	"indexed_bytes" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"dispatched_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_file_search_chunk" ADD CONSTRAINT "workspace_file_search_chunk_build_id_workspace_file_search_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."workspace_file_search_build"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_search_revision" ADD CONSTRAINT "workspace_file_search_revision_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_search_revision" ADD CONSTRAINT "workspace_file_search_revision_build_id_workspace_file_search_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."workspace_file_search_build"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_file_search_build_file_idx" ON "workspace_file_search_build" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "workspace_file_search_build_cleanup_idx" ON "workspace_file_search_build" USING btree ("expires_at","id") WHERE "workspace_file_search_build"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_file_search_chunk_line_idx" ON "workspace_file_search_chunk" USING btree ("build_id","line_start","ordinal");--> statement-breakpoint
CREATE INDEX "workspace_file_search_chunk_content_idx" ON "workspace_file_search_chunk" USING gin ("workspace_id" text_ops,"content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "workspace_file_search_revision_workspace_status_idx" ON "workspace_file_search_revision" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "workspace_file_search_revision_build_idx" ON "workspace_file_search_revision" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "workspace_file_search_revision_pending_idx" ON "workspace_file_search_revision" USING btree ("workspace_id","updated_at","file_id","source_content_updated_at") WHERE "workspace_file_search_revision"."status" = 'pending' AND "workspace_file_search_revision"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_file_search_revision_active_idx" ON "workspace_file_search_revision" USING btree ("dispatched_at","workspace_id") WHERE "workspace_file_search_revision"."status" = 'pending' AND "workspace_file_search_revision"."dispatched_at" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_file_search_mark_pending()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE workspace_file_search_build SET expires_at = now() WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = OLD.id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.content_updated_at IS NOT DISTINCT FROM OLD.content_updated_at
      AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
      AND NEW.context IS NOT DISTINCT FROM OLD.context
      AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
      RETURN NEW;
    END IF;
    UPDATE workspace_file_search_build SET expires_at = now() WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = NEW.id);
    DELETE FROM workspace_file_search_revision WHERE file_id = NEW.id;
  END IF;

  IF NEW.context = 'workspace' AND NEW.workspace_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    INSERT INTO workspace_file_search_revision (file_id, workspace_id, source_content_updated_at)
    VALUES (NEW.id, NEW.workspace_id, NEW.content_updated_at)
    ON CONFLICT (file_id) DO NOTHING;
    INSERT INTO workspace_file_search_dispatch_queue (workspace_id, enqueued_at, updated_at)
    VALUES (NEW.workspace_id, now(), now())
    ON CONFLICT (workspace_id) DO UPDATE SET updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_files_search_index_deleted
BEFORE DELETE ON workspace_files FOR EACH ROW EXECUTE FUNCTION workspace_file_search_mark_pending();
