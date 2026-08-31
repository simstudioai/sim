CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;--> statement-breakpoint
CREATE TYPE "public"."workspace_file_search_index_status" AS ENUM('pending', 'ready', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "workspace_file_search_backfill" (
	"id" text PRIMARY KEY NOT NULL,
	"after_workspace_id" text,
	"after_file_id" text,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_file_search_dispatch_queue" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"enqueued_at" timestamp DEFAULT now() NOT NULL,
	"last_dispatched_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_file_search_index" (
	"file_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_content_updated_at" timestamp NOT NULL,
	"status" "workspace_file_search_index_status" DEFAULT 'pending' NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"line_count" integer DEFAULT 0 NOT NULL,
	"indexed_bytes" integer DEFAULT 0 NOT NULL,
	"dispatched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_file_search_index_pk" PRIMARY KEY("file_id","source_content_updated_at")
);
--> statement-breakpoint
CREATE TABLE "workspace_file_search_segment" (
	"file_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_content_updated_at" timestamp NOT NULL,
	"line_number" integer NOT NULL,
	"segment_number" integer NOT NULL,
	"segment_start" integer NOT NULL,
	"line_length" integer NOT NULL,
	"content" text NOT NULL,
	CONSTRAINT "workspace_file_search_segment_pk" PRIMARY KEY("file_id","source_content_updated_at","line_number","segment_number")
);
--> statement-breakpoint
ALTER TABLE "workspace_file_search_dispatch_queue" ADD CONSTRAINT "workspace_file_search_queue_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_search_index" ADD CONSTRAINT "workspace_file_search_index_file_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_search_index" ADD CONSTRAINT "workspace_file_search_index_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_search_segment" ADD CONSTRAINT "workspace_file_search_segment_file_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_search_segment" ADD CONSTRAINT "workspace_file_search_segment_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_file_search_dispatch_queue_schedule_idx" ON "workspace_file_search_dispatch_queue" USING btree ("last_dispatched_at" ASC NULLS FIRST,"enqueued_at","workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_file_search_index_workspace_status_idx" ON "workspace_file_search_index" USING btree ("workspace_id","status","source_content_updated_at");--> statement-breakpoint
CREATE INDEX "workspace_file_search_index_pending_dispatch_idx" ON "workspace_file_search_index" USING btree ("workspace_id","updated_at","file_id","source_content_updated_at") WHERE "workspace_file_search_index"."status" = 'pending' AND "workspace_file_search_index"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_file_search_index_active_dispatch_idx" ON "workspace_file_search_index" USING btree ("workspace_id","dispatched_at") WHERE "workspace_file_search_index"."status" = 'pending' AND "workspace_file_search_index"."dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_file_search_segment_workspace_revision_idx" ON "workspace_file_search_segment" USING btree ("workspace_id","file_id","source_content_updated_at");--> statement-breakpoint
CREATE INDEX "workspace_file_search_segment_workspace_content_trgm_idx" ON "workspace_file_search_segment" USING gin ("workspace_id" text_ops,"content" gin_trgm_ops);--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_file_search_mark_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (TG_OP = 'UPDATE' AND (
		NEW.context IS DISTINCT FROM OLD.context
		OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
	))
		OR NEW.context <> 'workspace'
		OR NEW.workspace_id IS NULL
		OR NEW.deleted_at IS NOT NULL THEN
		DELETE FROM workspace_file_search_segment
		WHERE file_id = NEW.id;

		DELETE FROM workspace_file_search_index
		WHERE file_id = NEW.id;
	END IF;

	IF NEW.context = 'workspace'
		AND NEW.workspace_id IS NOT NULL
		AND NEW.deleted_at IS NULL
		AND (TG_OP = 'INSERT'
		OR NEW.content_updated_at IS DISTINCT FROM OLD.content_updated_at
		OR OLD.deleted_at IS NOT NULL
		OR NEW.context IS DISTINCT FROM OLD.context
		OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
		DELETE FROM workspace_file_search_segment AS segment
		USING workspace_file_search_index AS search_index
		WHERE segment.file_id = NEW.id
			AND segment.file_id = search_index.file_id
			AND segment.source_content_updated_at = search_index.source_content_updated_at
			AND segment.source_content_updated_at IS DISTINCT FROM NEW.content_updated_at
			AND (search_index.status <> 'pending' OR search_index.dispatched_at IS NULL);

		DELETE FROM workspace_file_search_index
		WHERE file_id = NEW.id
			AND source_content_updated_at IS DISTINCT FROM NEW.content_updated_at
			AND (status <> 'pending' OR dispatched_at IS NULL);

		INSERT INTO workspace_file_search_index (
			file_id,
			workspace_id,
			source_content_updated_at,
			status,
			partial,
			failure_reason,
			line_count,
			indexed_bytes,
			dispatched_at,
			updated_at
		)
		VALUES (
			NEW.id,
			NEW.workspace_id,
			NEW.content_updated_at,
			'pending',
			false,
			NULL,
			0,
			0,
			NULL,
			now()
		)
		ON CONFLICT (file_id, source_content_updated_at)
		DO UPDATE SET
			workspace_id = EXCLUDED.workspace_id,
			status = 'pending',
			partial = false,
			failure_reason = NULL,
			line_count = 0,
			indexed_bytes = 0,
			dispatched_at = NULL,
			updated_at = now();

		INSERT INTO workspace_file_search_dispatch_queue (
			workspace_id,
			enqueued_at,
			updated_at
		)
		VALUES (NEW.workspace_id, now(), now())
		ON CONFLICT (workspace_id)
		DO UPDATE SET updated_at = now();
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER workspace_files_search_index_pending
AFTER INSERT OR UPDATE OF content_updated_at, deleted_at, context, workspace_id ON workspace_files
FOR EACH ROW
EXECUTE FUNCTION workspace_file_search_mark_pending();
