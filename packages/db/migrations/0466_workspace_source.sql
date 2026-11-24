CREATE TYPE "public"."workspace_resource_kind" AS ENUM('credential', 'knowledge-base', 'knowledge-document', 'table', 'file', 'file-folder', 'mcp-server', 'custom-tool', 'custom-block', 'skill', 'sandbox', 'workflow');--> statement-breakpoint
CREATE TABLE "workflow_source_meta" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"meta" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_resource_key" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "workspace_resource_kind" NOT NULL,
	"key" text NOT NULL,
	"resource_id" text NOT NULL,
	"origin" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_resource_key_key_format" CHECK ("workspace_resource_key"."key" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "workspace_resource_key_origin_check" CHECK ("workspace_resource_key"."origin" IN ('allocated', 'adopted', 'created'))
);
--> statement-breakpoint
CREATE TABLE "workspace_source_apply_lease" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_source_staged_blob" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "file_sha256" text;--> statement-breakpoint
ALTER TABLE "workflow_source_meta" ADD CONSTRAINT "workflow_source_meta_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_resource_key" ADD CONSTRAINT "workspace_resource_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_resource_key" ADD CONSTRAINT "workspace_resource_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_source_apply_lease" ADD CONSTRAINT "workspace_source_apply_lease_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_source_staged_blob" ADD CONSTRAINT "workspace_source_staged_blob_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_resource_key_ws_kind_key_unique" ON "workspace_resource_key" USING btree ("workspace_id","kind","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_resource_key_ws_kind_resource_unique" ON "workspace_resource_key" USING btree ("workspace_id","kind","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_source_staged_blob_scope_hash_unique" ON "workspace_source_staged_blob" USING btree ("workspace_id","scope","sha256");--> statement-breakpoint
CREATE INDEX "workspace_source_staged_blob_expires_at_idx" ON "workspace_source_staged_blob" USING btree ("expires_at");