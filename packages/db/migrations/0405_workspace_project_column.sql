COMMIT;
--> statement-breakpoint
BEGIN;
SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
  THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true);
SET LOCAL statement_timeout = '5s';
LOCK TABLE workspace IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE project IN SHARE ROW EXCLUSIVE MODE NOWAIT;
CREATE TABLE IF NOT EXISTS "project_membership_rollout" (
  "id" text PRIMARY KEY,
  "phase" text DEFAULT 'connector' NOT NULL,
  CONSTRAINT "project_membership_rollout_singleton" CHECK ("id" = 'membership'),
  CONSTRAINT "project_membership_rollout_phase" CHECK ("phase" IN ('connector', 'column'))
);
DO $$
DECLARE had_column boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'workspace'::regclass
    AND attname = 'project_id' AND NOT attisdropped) INTO had_column;
  ALTER TABLE workspace ADD COLUMN IF NOT EXISTS project_id text;
  IF NOT EXISTS (SELECT 1 FROM project_membership_rollout WHERE id = 'membership') THEN
    IF had_column THEN
      IF EXISTS (SELECT 1 FROM workspace WHERE project_id IS DISTINCT FROM NULL) THEN
        RAISE EXCEPTION 'Populated Project columns require explicit authority reconciliation before rollout initialization' USING ERRCODE = '55000';
      END IF;
    END IF;
    INSERT INTO project_membership_rollout (id, phase) VALUES ('membership', 'connector');
  END IF;
END $$;
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
