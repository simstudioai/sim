CREATE TABLE "deleted_account_identity" (
	"identity_hash" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "free_tier_eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "deleted_account_identity_expires_at_idx" ON "deleted_account_identity" USING btree ("expires_at");