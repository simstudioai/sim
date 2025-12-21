CREATE TYPE "public"."usage_log_category" AS ENUM('model', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."usage_log_source" AS ENUM('workflow', 'wand', 'copilot');--> statement-breakpoint
CREATE TABLE "usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" "usage_log_category" NOT NULL,
	"source" "usage_log_source" NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"cost" numeric NOT NULL,
	"workspace_id" text,
	"workflow_id" text,
	"execution_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_log_user_created_at_idx" ON "usage_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_log_source_idx" ON "usage_log" USING btree ("source");--> statement-breakpoint
CREATE INDEX "usage_log_workspace_id_idx" ON "usage_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_log_workflow_id_idx" ON "usage_log" USING btree ("workflow_id");