CREATE TYPE "public"."organization_kind" AS ENUM('personal', 'team');--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "kind" "organization_kind" DEFAULT 'team' NOT NULL;
