ALTER TABLE "workflow" DROP CONSTRAINT "workflow_pinned_api_key_id_api_key_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "billed_account_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "allow_personal_api_keys" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "workspace" SET "billed_account_user_id" = "owner_id" WHERE "billed_account_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "billed_account_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_billed_account_user_id_user_id_fk" FOREIGN KEY ("billed_account_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "deployed_state";--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "pinned_api_key_id";--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "collaborators";--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "is_published";--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "marketplace_data";