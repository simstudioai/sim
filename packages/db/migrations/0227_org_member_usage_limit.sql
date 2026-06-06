CREATE TABLE "organization_member_usage_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"usage_limit" numeric NOT NULL,
	"set_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD COLUMN "triggered_by_user_id" text;--> statement-breakpoint
ALTER TABLE "organization_member_usage_limit" ADD CONSTRAINT "organization_member_usage_limit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_usage_limit" ADD CONSTRAINT "organization_member_usage_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_usage_limit" ADD CONSTRAINT "organization_member_usage_limit_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_member_usage_limit_org_user_unique" ON "organization_member_usage_limit" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_member_usage_limit_organization_id_idx" ON "organization_member_usage_limit" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;