ALTER TABLE "permissions" ALTER COLUMN "permission_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "permissions" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "permissions" SET DEFAULT 'admin'::text;--> statement-breakpoint
DROP TYPE "public"."permission_type";--> statement-breakpoint
CREATE TYPE "public"."permission_type" AS ENUM('admin', 'write', 'read');--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "permission_type" SET DATA TYPE "public"."permission_type" USING "permission_type"::"public"."permission_type";--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "permissions" SET DEFAULT 'admin'::"public"."permission_type";--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "permissions" SET DATA TYPE "public"."permission_type" USING "permissions"::"public"."permission_type";--> statement-breakpoint
DROP INDEX "permissions_unique_constraint";--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "permissions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "permissions" SET DATA TYPE "public"."permission_type" USING "permissions"::text::"public"."permission_type";--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "permissions" SET DEFAULT 'admin';--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_unique_constraint" ON "permissions" USING btree ("user_id","entity_type","entity_id");