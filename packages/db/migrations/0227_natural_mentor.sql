DROP TABLE "form" CASCADE;--> statement-breakpoint
DROP TABLE "template_creators" CASCADE;--> statement-breakpoint
DROP TABLE "template_stars" CASCADE;--> statement-breakpoint
DROP TABLE "templates" CASCADE;--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "color";--> statement-breakpoint
DROP TYPE "public"."template_creator_type";--> statement-breakpoint
DROP TYPE "public"."template_status";