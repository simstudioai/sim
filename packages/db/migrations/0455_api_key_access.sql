CREATE TYPE "public"."api_key_access" AS ENUM('read', 'write');--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "access" "api_key_access" DEFAULT 'write' NOT NULL;