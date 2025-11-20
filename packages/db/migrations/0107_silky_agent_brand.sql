CREATE TYPE "public"."template_creator_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "template_creators" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_type" "template_creator_type" NOT NULL,
	"reference_id" text NOT NULL,
	"name" text NOT NULL,
	"profile_image_url" text,
	"details" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT "templates_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT "templates_workflow_id_workflow_id_fk";
--> statement-breakpoint
DROP INDEX "templates_workflow_id_idx";--> statement-breakpoint
DROP INDEX "templates_user_id_idx";--> statement-breakpoint
DROP INDEX "templates_category_idx";--> statement-breakpoint
DROP INDEX "templates_category_views_idx";--> statement-breakpoint
DROP INDEX "templates_category_stars_idx";--> statement-breakpoint
DROP INDEX "templates_user_category_idx";--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "super_user_mode_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "creator_id" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "status" "template_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "required_credentials" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_super_user" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "template_creators" ADD CONSTRAINT "template_creators_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_creators_reference_idx" ON "template_creators" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "template_creators_reference_id_idx" ON "template_creators" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "template_creators_created_by_idx" ON "template_creators" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_creator_id_template_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."template_creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "templates_status_idx" ON "templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "templates_creator_id_idx" ON "templates" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "templates_status_views_idx" ON "templates" USING btree ("status","views");--> statement-breakpoint
CREATE INDEX "templates_status_stars_idx" ON "templates" USING btree ("status","stars");--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "author";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "color";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "icon";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "category";