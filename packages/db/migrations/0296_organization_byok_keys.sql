CREATE TABLE "organization_byok_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"name" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_byok_keys" ADD CONSTRAINT "organization_byok_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_byok_keys" ADD CONSTRAINT "organization_byok_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_byok_organization_provider_idx" ON "organization_byok_keys" USING btree ("organization_id","provider_id");