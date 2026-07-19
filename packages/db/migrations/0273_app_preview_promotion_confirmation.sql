ALTER TABLE "app_preview_session" ADD COLUMN "lifecycle" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_release_action" ADD COLUMN "read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_revision_action" ADD COLUMN "read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_preview_session" ADD CONSTRAINT "app_preview_session_lifecycle_check" CHECK ("app_preview_session"."lifecycle" IN ('primary', 'candidate', 'displaced')) NOT VALID;--> statement-breakpoint
ALTER TABLE "app_preview_session" VALIDATE CONSTRAINT "app_preview_session_lifecycle_check";--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "app_preview_session_active_user_project_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "app_preview_session_active_candidate_user_project_unique" ON "app_preview_session" USING btree ("project_id","user_id") WHERE "app_preview_session"."stopped_at" IS NULL AND "app_preview_session"."lifecycle" = 'candidate';--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "app_preview_session_active_displaced_user_project_unique" ON "app_preview_session" USING btree ("project_id","user_id") WHERE "app_preview_session"."stopped_at" IS NULL AND "app_preview_session"."lifecycle" = 'displaced';--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "app_preview_session_active_user_project_unique" ON "app_preview_session" USING btree ("project_id","user_id") WHERE "app_preview_session"."stopped_at" IS NULL AND "app_preview_session"."lifecycle" = 'primary';--> statement-breakpoint
SET lock_timeout = '5s';