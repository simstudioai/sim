CREATE TYPE "public"."execution_large_value_reference_source" AS ENUM('execution_log', 'paused_snapshot');--> statement-breakpoint
CREATE TABLE "execution_large_value_dependencies" (
	"parent_key" text NOT NULL,
	"child_key" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "execution_large_value_dependencies_parent_key_child_key_pk" PRIMARY KEY("parent_key","child_key")
);
--> statement-breakpoint
CREATE TABLE "execution_large_value_references" (
	"key" text NOT NULL,
	"execution_id" text NOT NULL,
	"source" "execution_large_value_reference_source" NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "execution_large_value_references_key_execution_id_source_pk" PRIMARY KEY("key","execution_id","source")
);
--> statement-breakpoint
CREATE TABLE "execution_large_values" (
	"key" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text,
	"owner_execution_id" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "execution_large_value_dependencies" ADD CONSTRAINT "execution_large_value_dependencies_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_large_value_references" ADD CONSTRAINT "execution_large_value_references_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_large_value_references" ADD CONSTRAINT "execution_large_value_references_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_large_values" ADD CONSTRAINT "execution_large_values_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_large_values" ADD CONSTRAINT "execution_large_values_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_large_value_dependencies_workspace_parent_key_idx" ON "execution_large_value_dependencies" USING btree ("workspace_id","parent_key");--> statement-breakpoint
CREATE INDEX "execution_large_value_dependencies_workspace_child_key_idx" ON "execution_large_value_dependencies" USING btree ("workspace_id","child_key");--> statement-breakpoint
CREATE INDEX "execution_large_value_references_workspace_execution_source_idx" ON "execution_large_value_references" USING btree ("workspace_id","execution_id","source");--> statement-breakpoint
CREATE INDEX "execution_large_values_owner_execution_id_idx" ON "execution_large_values" USING btree ("owner_execution_id");--> statement-breakpoint
CREATE INDEX "execution_large_values_cleanup_idx" ON "execution_large_values" USING btree ("workspace_id","created_at","key") WHERE "execution_large_values"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "execution_large_values_tombstone_cleanup_idx" ON "execution_large_values" USING btree ("workspace_id","deleted_at","key") WHERE "execution_large_values"."deleted_at" IS NOT NULL;