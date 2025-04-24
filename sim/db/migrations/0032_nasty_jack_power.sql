ALTER TABLE "subscription" RENAME COLUMN "created_at" TO "trial_start";--> statement-breakpoint
ALTER TABLE "subscription" RENAME COLUMN "updated_at" TO "trial_end";