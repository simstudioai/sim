CREATE TABLE "workflow_deployment_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"version" integer NOT NULL,
	"state" json NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ADD CONSTRAINT "workflow_deployment_version_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_deployment_version_workflow_id_idx" ON "workflow_deployment_version" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_deployment_version_workflow_version_unique" ON "workflow_deployment_version" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_deployment_version_workflow_active_idx" ON "workflow_deployment_version" USING btree ("workflow_id","is_active");--> statement-breakpoint
CREATE INDEX "workflow_deployment_version_created_at_idx" ON "workflow_deployment_version" USING btree ("created_at");