CREATE TYPE "public"."workspace_file_version_source" AS ENUM('upload', 'user', 'api', 'copilot', 'workflow', 'collab', 'revert', 'unknown');--> statement-breakpoint
CREATE TABLE "workspace_file_version" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"content_hash" text,
	"superseded_at" timestamp,
	"source" "workspace_file_version_source" NOT NULL,
	"author_user_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"restored_from_version" integer,
	"secret_provenance_status" text,
	"secret_provenance_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_file_version_provenance_status_check" CHECK ("workspace_file_version"."secret_provenance_status" IS NULL OR "workspace_file_version"."secret_provenance_status" IN ('exact', 'unknown', 'unrecorded'))
);
--> statement-breakpoint
ALTER TABLE "workspace_file_version" ADD CONSTRAINT "workspace_file_version_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_version" ADD CONSTRAINT "workspace_file_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_file_version_file_version_unique" ON "workspace_file_version" USING btree ("file_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_file_version_key_unique" ON "workspace_file_version" USING btree ("key");--> statement-breakpoint
CREATE INDEX "workspace_file_version_workspace_id_idx" ON "workspace_file_version" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "workspace_file_version_workspace_superseded_idx" ON "workspace_file_version" USING btree ("workspace_id","superseded_at") WHERE "workspace_file_version"."superseded_at" IS NOT NULL;