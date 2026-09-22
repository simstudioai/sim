CREATE TABLE "workspace_file_workflow_run" (
	"file_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"audience" text NOT NULL,
	"deployment_version_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" text NOT NULL,
	CONSTRAINT "workspace_file_workflow_run_file_id_workflow_id_pk" PRIMARY KEY("file_id","workflow_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "workflow_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "workflow_config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_file_workflow_run" ADD CONSTRAINT "workspace_file_workflow_run_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_workflow_run" ADD CONSTRAINT "workspace_file_workflow_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
