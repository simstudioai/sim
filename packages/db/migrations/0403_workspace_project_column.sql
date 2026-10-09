ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "project_id" text;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET statement_timeout = '15min';
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
-- Rebuild on replay so an interrupted concurrent build cannot leave an INVALID index behind.
DROP INDEX CONCURRENTLY IF EXISTS "workspace_project_id_id_idx";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_project_id_id_idx" ON "workspace" USING btree ("project_id","id");
--> statement-breakpoint
SET lock_timeout = '5s';
--> statement-breakpoint
SET statement_timeout = 0;
