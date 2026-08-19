CREATE TYPE "public"."secret_usage_scope" AS ENUM('workspace', 'personal');--> statement-breakpoint
CREATE TYPE "public"."secret_usage_source" AS ENUM('workflow', 'copilot', 'mcp');--> statement-breakpoint
CREATE TABLE "secret_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"secret_name" text NOT NULL,
	"secret_scope" "secret_usage_scope" NOT NULL,
	"secret_owner_user_id" text DEFAULT '' NOT NULL,
	"source" "secret_usage_source" NOT NULL,
	"workflow_id" text DEFAULT '' NOT NULL,
	"actor_user_id" text DEFAULT '' NOT NULL,
	"usage_date" date NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp NOT NULL,
	"last_execution_id" text,
	"last_trigger" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_usage" ADD CONSTRAINT "secret_usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secret_usage_bucket_unique" ON "secret_usage" USING btree ("workspace_id","secret_name","secret_scope","secret_owner_user_id","source","workflow_id","actor_user_id","usage_date");--> statement-breakpoint
CREATE INDEX "secret_usage_secret_recent_idx" ON "secret_usage" USING btree ("workspace_id","secret_name","secret_scope","secret_owner_user_id","last_used_at" DESC NULLS LAST);