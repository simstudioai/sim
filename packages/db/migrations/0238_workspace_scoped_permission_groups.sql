CREATE TABLE "permission_group_workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"permission_group_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "permission_group_member_organization_user_unique";--> statement-breakpoint
ALTER TABLE "permission_group" ADD COLUMN "applies_to_all_workspaces" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group_workspace" ADD CONSTRAINT "permission_group_workspace_permission_group_id_permission_group_id_fk" FOREIGN KEY ("permission_group_id") REFERENCES "public"."permission_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_workspace" ADD CONSTRAINT "permission_group_workspace_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_workspace" ADD CONSTRAINT "permission_group_workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permission_group_workspace_group_id_idx" ON "permission_group_workspace" USING btree ("permission_group_id");--> statement-breakpoint
CREATE INDEX "permission_group_workspace_workspace_id_idx" ON "permission_group_workspace" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_workspace_group_workspace_unique" ON "permission_group_workspace" USING btree ("permission_group_id","workspace_id");--> statement-breakpoint
CREATE INDEX "permission_group_member_organization_user_idx" ON "permission_group_member" USING btree ("organization_id","user_id");