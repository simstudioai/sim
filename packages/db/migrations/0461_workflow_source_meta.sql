CREATE TABLE "workflow_source_meta" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"meta" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_source_meta" ADD CONSTRAINT "workflow_source_meta_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;