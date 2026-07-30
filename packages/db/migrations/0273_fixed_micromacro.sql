CREATE TABLE "workflow_publication" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"organization_id" text,
	"published" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"summary" text,
	"description" text,
	"field_overlay" json,
	"expose_trace" text DEFAULT 'off' NOT NULL,
	"expose_blocks" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'org' NOT NULL,
	"allowlist_workspace_ids" json,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_publication" ADD CONSTRAINT "workflow_publication_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication" ADD CONSTRAINT "workflow_publication_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication" ADD CONSTRAINT "workflow_publication_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication" ADD CONSTRAINT "workflow_publication_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_publication_workflow_id_unique" ON "workflow_publication" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_workspace_id_idx" ON "workflow_publication" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_organization_id_idx" ON "workflow_publication" USING btree ("organization_id");