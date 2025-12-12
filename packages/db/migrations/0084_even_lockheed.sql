ALTER TABLE "user_rate_limits" RENAME COLUMN "user_id" TO "reference_id";--> statement-breakpoint
ALTER TABLE "user_rate_limits" DROP CONSTRAINT "user_rate_limits_user_id_user_id_fk";
