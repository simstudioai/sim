CREATE TABLE "workspace_source_apply_lease" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_source_apply_lease" ADD CONSTRAINT "workspace_source_apply_lease_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;