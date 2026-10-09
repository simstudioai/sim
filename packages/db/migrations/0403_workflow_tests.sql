ALTER TYPE "public"."usage_log_source" ADD VALUE 'workflow-test';--> statement-breakpoint
CREATE TABLE "workflow_test" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"body_file_id" text NOT NULL,
	"cases" jsonb DEFAULT '[]' NOT NULL,
	"source_hash" text NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_test_run" (
	"id" text PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"error" text,
	"source_hash" text,
	"ran_against" jsonb,
	"progress" jsonb,
	"triggered_by_actor" jsonb NOT NULL,
	"triggered_by_user_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "workflow_test_run_version_check" CHECK ("workflow_test_run"."version" IN ('draft', 'deployed')),
	CONSTRAINT "workflow_test_run_status_check" CHECK ("workflow_test_run"."status" IN ('running', 'passed', 'failed', 'error')),
	CONSTRAINT "workflow_test_run_completed_check" CHECK (("workflow_test_run"."status" = 'running') = ("workflow_test_run"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "workflow_test" ADD CONSTRAINT "workflow_test_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_test" ADD CONSTRAINT "workflow_test_body_file_id_workspace_files_id_fk" FOREIGN KEY ("body_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_test" ADD CONSTRAINT "workflow_test_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_test_run" ADD CONSTRAINT "workflow_test_run_test_id_workflow_test_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."workflow_test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_test_run" ADD CONSTRAINT "workflow_test_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_test_run" ADD CONSTRAINT "workflow_test_run_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_test_workspace_name_unique" ON "workflow_test" USING btree ("workspace_id","name") WHERE "workflow_test"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_test_body_file_unique" ON "workflow_test" USING btree ("body_file_id");--> statement-breakpoint
CREATE INDEX "workflow_test_run_test_version_started_idx" ON "workflow_test_run" USING btree ("test_id","version","started_at");