CREATE TABLE "organization_search_integration" (
	"organization_id" text NOT NULL,
	"connector_type" text NOT NULL,
	"approved" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_search_integration_organization_id_connector_type_pk" PRIMARY KEY("organization_id","connector_type")
);
--> statement-breakpoint
ALTER TABLE "organization_search_integration" ADD CONSTRAINT "organization_search_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;