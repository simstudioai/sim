CREATE TYPE "public"."workspace_mode" AS ENUM('personal', 'organization', 'grandfathered_shared');--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "workspace_mode" "workspace_mode" DEFAULT 'grandfathered_shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_owner_id_idx" ON "workspace" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workspace_organization_id_idx" ON "workspace" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workspace_mode_idx" ON "workspace" USING btree ("workspace_mode");