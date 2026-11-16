CREATE TABLE "workflow_code_meta" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"meta" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_code_meta" ADD CONSTRAINT "workflow_code_meta_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;