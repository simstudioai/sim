ALTER TYPE "public"."chat_type" ADD VALUE IF NOT EXISTS 'fullstack';
--> statement-breakpoint
CREATE TYPE "public"."app_release_state" AS ENUM('prepared', 'published', 'revoked');
--> statement-breakpoint
CREATE TYPE "public"."app_release_revoked_reason" AS ENUM('vacated', 'manual');
--> statement-breakpoint
CREATE TYPE "public"."app_build_status" AS ENUM('queued', 'running', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."app_deployment_pin_kind" AS ENUM('release', 'preview');
--> statement-breakpoint
CREATE TABLE "app_project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"public_id" text NOT NULL,
	"slug" text NOT NULL,
	"draft_revision_id" text,
	"published_release_id" text,
	"created_from_chat_id" uuid,
	"last_builder_chat_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_source_blob" (
	"hash" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_source_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_revision_id" text,
	"source_tree_hash" text NOT NULL,
	"action_manifest_hash" text NOT NULL,
	"template_version" text NOT NULL,
	"sdk_version" text NOT NULL,
	"lockfile_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_source_file" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"path" text NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_revision_action" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"action_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"deployment_version_id" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execution_policy" text DEFAULT 'sync' NOT NULL,
	"schema_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_build" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"status" "app_build_status" DEFAULT 'queued' NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artifact_manifest_hash" text,
	"build_image_digest" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app_artifact_blob" (
	"hash" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_release" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"build_id" text,
	"state" "app_release_state" DEFAULT 'prepared' NOT NULL,
	"artifact_manifest_hash" text NOT NULL,
	"template_version" text NOT NULL,
	"sdk_version" text NOT NULL,
	"published_at" timestamp,
	"revoked_at" timestamp,
	"revoked_reason" "app_release_revoked_reason",
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_release_state_timestamps_check" CHECK ((
        ("state" = 'prepared' AND "published_at" IS NULL AND "revoked_at" IS NULL AND "revoked_reason" IS NULL) OR
        ("state" = 'published' AND "published_at" IS NOT NULL AND "revoked_at" IS NULL AND "revoked_reason" IS NULL) OR
        ("state" = 'revoked' AND "published_at" IS NOT NULL AND "revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "app_release_action" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"action_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"deployment_version_id" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execution_policy" text DEFAULT 'sync' NOT NULL,
	"schema_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_deployment_pin" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "app_deployment_pin_kind" NOT NULL,
	"project_id" text NOT NULL,
	"release_id" text,
	"preview_session_id" text,
	"revision_id" text,
	"workflow_id" text NOT NULL,
	"deployment_version_id" text NOT NULL,
	"expires_at" timestamp,
	"session_started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_deployment_pin_kind_check" CHECK ((
        ("kind" = 'release' AND "release_id" IS NOT NULL AND "preview_session_id" IS NULL AND "revision_id" IS NULL AND "expires_at" IS NULL AND "session_started_at" IS NULL) OR
        ("kind" = 'preview' AND "release_id" IS NULL AND "preview_session_id" IS NOT NULL AND "revision_id" IS NOT NULL AND "expires_at" IS NOT NULL AND "session_started_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "app_preview_session" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_nonce" text NOT NULL,
	"build_id" text,
	"artifact_manifest_hash" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"stopped_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "app_project" ADD CONSTRAINT "app_project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_project" ADD CONSTRAINT "app_project_created_from_chat_id_copilot_chats_id_fk" FOREIGN KEY ("created_from_chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_project" ADD CONSTRAINT "app_project_last_builder_chat_id_copilot_chats_id_fk" FOREIGN KEY ("last_builder_chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_project" ADD CONSTRAINT "app_project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_source_revision" ADD CONSTRAINT "app_source_revision_project_id_app_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."app_project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_source_revision" ADD CONSTRAINT "app_source_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_source_file" ADD CONSTRAINT "app_source_file_revision_id_app_source_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."app_source_revision"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_source_file" ADD CONSTRAINT "app_source_file_content_hash_app_source_blob_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."app_source_blob"("hash") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_revision_action" ADD CONSTRAINT "app_revision_action_revision_id_app_source_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."app_source_revision"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_build" ADD CONSTRAINT "app_build_project_id_app_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."app_project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_build" ADD CONSTRAINT "app_build_revision_id_app_source_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."app_source_revision"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_release" ADD CONSTRAINT "app_release_project_id_app_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."app_project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_release" ADD CONSTRAINT "app_release_revision_id_app_source_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."app_source_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_release" ADD CONSTRAINT "app_release_build_id_app_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."app_build"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_release" ADD CONSTRAINT "app_release_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_release_action" ADD CONSTRAINT "app_release_action_release_id_app_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."app_release"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_deployment_pin" ADD CONSTRAINT "app_deployment_pin_project_id_app_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."app_project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_deployment_pin" ADD CONSTRAINT "app_deployment_pin_release_id_app_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."app_release"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_deployment_pin" ADD CONSTRAINT "app_deployment_pin_preview_session_id_app_preview_session_id_fk" FOREIGN KEY ("preview_session_id") REFERENCES "public"."app_preview_session"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_deployment_pin" ADD CONSTRAINT "app_deployment_pin_revision_id_app_source_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."app_source_revision"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_deployment_pin" ADD CONSTRAINT "app_deployment_pin_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_deployment_pin" ADD CONSTRAINT "app_deployment_pin_deployment_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."workflow_deployment_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_preview_session" ADD CONSTRAINT "app_preview_session_project_id_app_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."app_project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_preview_session" ADD CONSTRAINT "app_preview_session_revision_id_app_source_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."app_source_revision"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_preview_session" ADD CONSTRAINT "app_preview_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_preview_session" ADD CONSTRAINT "app_preview_session_build_id_app_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."app_build"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "app_project_public_id_unique" ON "app_project" USING btree ("public_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "app_project_workspace_slug_unique" ON "app_project" USING btree ("workspace_id","slug") WHERE "archived_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "app_project_active_created_from_chat_unique" ON "app_project" USING btree ("created_from_chat_id") WHERE "created_from_chat_id" IS NOT NULL AND "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "app_project_workspace_idx" ON "app_project" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "app_project_archived_at_idx" ON "app_project" USING btree ("archived_at");
--> statement-breakpoint
CREATE INDEX "app_source_blob_created_at_idx" ON "app_source_blob" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "app_source_revision_project_created_idx" ON "app_source_revision" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "app_source_file_revision_path_unique" ON "app_source_file" USING btree ("revision_id","path");
--> statement-breakpoint
CREATE UNIQUE INDEX "app_revision_action_revision_action_unique" ON "app_revision_action" USING btree ("revision_id","action_id");
--> statement-breakpoint
CREATE INDEX "app_build_project_created_idx" ON "app_build" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX "app_build_status_created_idx" ON "app_build" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "app_artifact_blob_created_at_idx" ON "app_artifact_blob" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "app_release_project_state_idx" ON "app_release" USING btree ("project_id","state");
--> statement-breakpoint
CREATE UNIQUE INDEX "app_release_action_release_action_unique" ON "app_release_action" USING btree ("release_id","action_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "app_deployment_pin_release_unique" ON "app_deployment_pin" USING btree ("release_id","deployment_version_id") WHERE "kind" = 'release';
--> statement-breakpoint
CREATE UNIQUE INDEX "app_deployment_pin_preview_unique" ON "app_deployment_pin" USING btree ("preview_session_id","deployment_version_id") WHERE "kind" = 'preview';
--> statement-breakpoint
CREATE INDEX "app_deployment_pin_expires_at_idx" ON "app_deployment_pin" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "app_deployment_pin_version_idx" ON "app_deployment_pin" USING btree ("deployment_version_id");
--> statement-breakpoint
CREATE INDEX "app_deployment_pin_workflow_idx" ON "app_deployment_pin" USING btree ("workflow_id");
--> statement-breakpoint
CREATE INDEX "app_preview_session_project_idx" ON "app_preview_session" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "app_preview_session_expires_at_idx" ON "app_preview_session" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "app_preview_session_active_user_project_unique" ON "app_preview_session" USING btree ("project_id","user_id") WHERE "stopped_at" IS NULL;
