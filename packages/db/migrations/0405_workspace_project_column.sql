COMMIT;
--> statement-breakpoint
BEGIN;
SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
  THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true);
SET LOCAL statement_timeout = '5s';
LOCK TABLE workspace IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE project IN SHARE ROW EXCLUSIVE MODE NOWAIT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "project_id" text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace'::regclass AND conname = 'workspace_project_id_project_id_fk') THEN
    ALTER TABLE "workspace" ADD CONSTRAINT "workspace_project_id_project_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
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
