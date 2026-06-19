ALTER TABLE "public_share" ADD COLUMN "auth_type" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_share" ADD COLUMN "password" text;