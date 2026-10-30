-- 0446 ends the batch transaction with a concurrent index build; keep this table and its journal row atomic.
BEGIN;--> statement-breakpoint
CREATE TABLE "sim_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"url" text NOT NULL,
	"default_url" text,
	"description" text,
	"unlisted" boolean DEFAULT false NOT NULL,
	"restrict_edit" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sim_link" ADD CONSTRAINT "sim_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_link" ADD CONSTRAINT "sim_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sim_link_organization_name_unique" ON "sim_link" USING btree ("organization_id","normalized_name");--> statement-breakpoint
CREATE INDEX "sim_link_created_by_idx" ON "sim_link" USING btree ("created_by");