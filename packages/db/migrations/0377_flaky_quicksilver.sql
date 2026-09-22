CREATE TABLE "workspace_file_workflow_budget" (
	"file_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"window_started_at" timestamp DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workspace_file_workflow_budget_file_id_workflow_id_pk" PRIMARY KEY("file_id","workflow_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_file_workflow_input_run" (
	"file_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"audience" text NOT NULL,
	"input_hash" text NOT NULL,
	"execution_id" text NOT NULL,
	"deployment_version_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" text NOT NULL,
	CONSTRAINT "workspace_file_workflow_input_run_pk" PRIMARY KEY("file_id","workflow_id","audience","input_hash")
);
--> statement-breakpoint
ALTER TABLE "workspace_file_workflow_budget" ADD CONSTRAINT "workspace_file_workflow_budget_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_workflow_budget" ADD CONSTRAINT "workspace_file_workflow_budget_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_workflow_input_run" ADD CONSTRAINT "workspace_file_workflow_input_run_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_workflow_input_run" ADD CONSTRAINT "workspace_file_workflow_input_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_file_workflow_input_run_started_idx" ON "workspace_file_workflow_input_run" USING btree ("started_at");
