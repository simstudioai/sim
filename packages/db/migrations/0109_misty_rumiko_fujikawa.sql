CREATE TYPE "public"."mcp_server_deployment_status" AS ENUM('pending', 'deploying', 'active', 'failed', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."mcp_server_kind" AS ENUM('external', 'hosted');--> statement-breakpoint
CREATE TYPE "public"."mcp_server_project_status" AS ENUM('draft', 'building', 'deploying', 'active', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."mcp_server_project_visibility" AS ENUM('private', 'workspace', 'public');--> statement-breakpoint
CREATE TYPE "public"."mcp_server_token_scope" AS ENUM('deploy', 'runtime', 'logs');--> statement-breakpoint
CREATE TYPE "public"."mcp_server_version_status" AS ENUM('queued', 'building', 'ready', 'failed', 'deprecated');--> statement-breakpoint
CREATE TABLE "mcp_server_deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version_id" text,
	"server_id" text,
	"workspace_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"region" text,
	"endpoint_url" text,
	"status" "mcp_server_deployment_status" DEFAULT 'pending' NOT NULL,
	"logs_url" text,
	"deployed_by" text,
	"deployed_at" timestamp,
	"rolled_back_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_server_project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"visibility" "mcp_server_project_visibility" DEFAULT 'workspace' NOT NULL,
	"runtime" text DEFAULT 'node' NOT NULL,
	"entry_point" text DEFAULT 'index.ts' NOT NULL,
	"template" text,
	"source_type" text DEFAULT 'inline' NOT NULL,
	"repository_url" text,
	"repository_branch" text,
	"environment_variables" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"status" "mcp_server_project_status" DEFAULT 'draft' NOT NULL,
	"current_version_number" integer,
	"last_deployed_version_id" text,
	"last_deployed_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_server_token" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"hashed_token" text NOT NULL,
	"scope" "mcp_server_token_scope" DEFAULT 'runtime' NOT NULL,
	"created_by" text,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_server_version" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"source_hash" text,
	"manifest" jsonb DEFAULT '{}' NOT NULL,
	"build_config" jsonb DEFAULT '{}' NOT NULL,
	"artifact_url" text,
	"runtime_metadata" jsonb DEFAULT '{}' NOT NULL,
	"status" "mcp_server_version_status" DEFAULT 'queued' NOT NULL,
	"build_logs_url" text,
	"changelog" text,
	"promoted_by" text,
	"promoted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "kind" "mcp_server_kind" DEFAULT 'external' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_server_deployment" ADD CONSTRAINT "mcp_server_deployment_project_id_mcp_server_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mcp_server_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_deployment" ADD CONSTRAINT "mcp_server_deployment_version_id_mcp_server_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."mcp_server_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_deployment" ADD CONSTRAINT "mcp_server_deployment_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_deployment" ADD CONSTRAINT "mcp_server_deployment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_deployment" ADD CONSTRAINT "mcp_server_deployment_deployed_by_user_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_project" ADD CONSTRAINT "mcp_server_project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_project" ADD CONSTRAINT "mcp_server_project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_token" ADD CONSTRAINT "mcp_server_token_project_id_mcp_server_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mcp_server_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_token" ADD CONSTRAINT "mcp_server_token_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_version" ADD CONSTRAINT "mcp_server_version_project_id_mcp_server_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mcp_server_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_version" ADD CONSTRAINT "mcp_server_version_promoted_by_user_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_server_deployment_workspace_environment_idx" ON "mcp_server_deployment" USING btree ("workspace_id","environment");--> statement-breakpoint
CREATE INDEX "mcp_server_deployment_project_status_idx" ON "mcp_server_deployment" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_project_workspace_slug_unique" ON "mcp_server_project" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "mcp_server_project_workspace_status_idx" ON "mcp_server_project" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "mcp_server_project_visibility_idx" ON "mcp_server_project" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "mcp_server_token_project_scope_idx" ON "mcp_server_token" USING btree ("project_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_token_hash_unique" ON "mcp_server_token" USING btree ("hashed_token");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_version_project_version_unique" ON "mcp_server_version" USING btree ("project_id","version_number");--> statement-breakpoint
CREATE INDEX "mcp_server_version_project_status_idx" ON "mcp_server_version" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_project_id_mcp_server_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mcp_server_project"("id") ON DELETE set null ON UPDATE no action;