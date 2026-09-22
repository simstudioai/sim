CREATE TABLE "organization_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"owner_user_id" text,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_secret_source" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_secret_source_mode_check" CHECK ("organization_secret_source"."mode" IN ('organization', 'member'))
);
--> statement-breakpoint
ALTER TABLE "organization_secret" ADD CONSTRAINT "organization_secret_source_id_organization_secret_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."organization_secret_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_secret" ADD CONSTRAINT "organization_secret_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_secret_source" ADD CONSTRAINT "organization_secret_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_secret_shared_unique" ON "organization_secret" USING btree ("source_id","name") WHERE "organization_secret"."owner_user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_secret_member_unique" ON "organization_secret" USING btree ("source_id","owner_user_id","name") WHERE "organization_secret"."owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_secret_owner_idx" ON "organization_secret" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_secret_source_org_unique" ON "organization_secret_source" USING btree ("organization_id");