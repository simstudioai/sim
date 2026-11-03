CREATE TABLE "people_directory_scim_change" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people_directory_scim_change" ADD CONSTRAINT "people_directory_scim_change_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;