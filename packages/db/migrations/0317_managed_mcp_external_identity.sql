ALTER TABLE "credential" ADD CONSTRAINT "credential_creator_source_check" CHECK ((type::text = 'managed_mcp') OR created_by IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_creator_source_check";--> statement-breakpoint
ALTER TABLE "credential" ALTER COLUMN "created_by" DROP NOT NULL;
