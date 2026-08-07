CREATE TYPE "public"."credential_env_visibility" AS ENUM('secret', 'variable');--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "env_visibility" "credential_env_visibility" DEFAULT 'secret' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_env_visibility_scope_check" CHECK ((env_visibility = 'secret') OR (type = 'env_workspace'));