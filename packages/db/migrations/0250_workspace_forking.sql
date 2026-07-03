-- Replay-safety: this file ends in a CONCURRENTLY index op below an embedded COMMIT,
-- so a failure there replays the whole file from the top — every statement here is idempotent.
DO $$ BEGIN
	CREATE TYPE "public"."workspace_fork_promote_direction" AS ENUM('push', 'pull');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."workspace_fork_resource_type" AS ENUM('workflow', 'oauth_credential', 'service_account_credential', 'env_var', 'table', 'knowledge_base', 'knowledge_document', 'file', 'mcp_server', 'custom_tool', 'skill');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_fork_promote_run" (
	"id" text PRIMARY KEY NOT NULL,
	"child_workspace_id" text NOT NULL,
	"source_workspace_id" text NOT NULL,
	"target_workspace_id" text NOT NULL,
	"direction" "workspace_fork_promote_direction" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_fork_resource_map" (
	"id" text PRIMARY KEY NOT NULL,
	"child_workspace_id" text NOT NULL,
	"resource_type" "workspace_fork_resource_type" NOT NULL,
	"parent_resource_id" text NOT NULL,
	"child_resource_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "forked_from_workspace_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_fork_promote_run" ADD CONSTRAINT "workspace_fork_promote_run_child_workspace_id_workspace_id_fk" FOREIGN KEY ("child_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_fork_promote_run" ADD CONSTRAINT "workspace_fork_promote_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_fork_resource_map" ADD CONSTRAINT "workspace_fork_resource_map_child_workspace_id_workspace_id_fk" FOREIGN KEY ("child_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_fork_resource_map" ADD CONSTRAINT "workspace_fork_resource_map_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace" ADD CONSTRAINT "workspace_forked_from_workspace_id_workspace_id_fk" FOREIGN KEY ("forked_from_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_fork_promote_run_child_ws_target_unique" ON "workspace_fork_promote_run" USING btree ("child_workspace_id","target_workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_fork_promote_run_target_ws_idx" ON "workspace_fork_promote_run" USING btree ("target_workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_fork_resource_map_child_ws_idx" ON "workspace_fork_resource_map" USING btree ("child_workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_fork_resource_map_child_ws_type_idx" ON "workspace_fork_resource_map" USING btree ("child_workspace_id","resource_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_fork_resource_map_child_type_parent_unique" ON "workspace_fork_resource_map" USING btree ("child_workspace_id","resource_type","parent_resource_id");--> statement-breakpoint
-- workspace is an existing table: build its new index CONCURRENTLY so the build never
-- write-locks the relation (runner convention — plain CREATE INDEX takes ACCESS EXCLUSIVE).
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_forked_from_workspace_id_idx" ON "workspace" USING btree ("forked_from_workspace_id");--> statement-breakpoint
SET lock_timeout = '5s';
