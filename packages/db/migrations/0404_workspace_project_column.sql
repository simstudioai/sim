COMMIT;
--> statement-breakpoint
BEGIN;
SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
  THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true);
SET LOCAL statement_timeout = '5s';
-- Install both directions together, without queuing behind a live writer.
LOCK TABLE workspace IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE project_workspace IN SHARE ROW EXCLUSIVE MODE NOWAIT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "project_id" text;

CREATE OR REPLACE FUNCTION workspace_sync_project_membership_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id THEN
    RETURN NEW;
  END IF;
  IF NEW.project_id IS NULL THEN
    DELETE FROM project_workspace WHERE workspace_id = NEW.id;
  ELSE
    INSERT INTO project_workspace (project_id, workspace_id) VALUES (NEW.project_id, NEW.id)
      ON CONFLICT (workspace_id) DO UPDATE SET project_id = EXCLUDED.project_id
      WHERE project_workspace.project_id IS DISTINCT FROM EXCLUDED.project_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER workspace_sync_project_membership
  AFTER INSERT OR UPDATE OF project_id ON workspace
  FOR EACH ROW EXECUTE FUNCTION workspace_sync_project_membership_fn();

CREATE OR REPLACE FUNCTION project_workspace_sync_column_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE workspace SET project_id = NULL WHERE id = OLD.workspace_id AND project_id IS NOT NULL;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'Project membership workspace identity cannot change' USING ERRCODE = '55000';
  END IF;
  UPDATE workspace SET project_id = NEW.project_id
    WHERE id = NEW.workspace_id AND project_id IS DISTINCT FROM NEW.project_id;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER project_workspace_sync_column
  AFTER INSERT OR UPDATE OR DELETE ON project_workspace
  FOR EACH ROW EXECUTE FUNCTION project_workspace_sync_column_fn();
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
SET lock_timeout = '1s';
--> statement-breakpoint
CREATE OR REPLACE PROCEDURE pg_temp.copy_workspace_projects() LANGUAGE plpgsql AS $$
DECLARE
  previous_id text;
  batch_ids text[];
  attempts integer := 0;
  copied integer := 0;
  changed integer;
  retry boolean;
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id COLLATE "C") INTO batch_ids FROM (
      SELECT w.id FROM workspace w JOIN project_workspace pw ON pw.workspace_id = w.id
      WHERE (previous_id IS NULL OR w.id COLLATE "C" > previous_id COLLATE "C")
        AND w.project_id IS DISTINCT FROM pw.project_id
      ORDER BY w.id COLLATE "C" LIMIT 100
    ) batch;
    EXIT WHEN batch_ids IS NULL;
    PERFORM set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
      THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true);
    retry := false;
    BEGIN
      PERFORM id FROM workspace WHERE id = ANY(batch_ids) ORDER BY id COLLATE "C"
        FOR NO KEY UPDATE NOWAIT;
      -- Old writers can hold connector rows first: release the entire batch instead of waiting.
      PERFORM workspace_id FROM project_workspace WHERE workspace_id = ANY(batch_ids)
        ORDER BY workspace_id COLLATE "C" FOR UPDATE NOWAIT;
      -- Read again after locking so a concurrent detach cannot be overwritten by discovery's snapshot.
      UPDATE workspace w SET project_id = pw.project_id FROM project_workspace pw
        WHERE w.id = ANY(batch_ids) AND pw.workspace_id = w.id
          AND w.project_id IS DISTINCT FROM pw.project_id;
      GET DIAGNOSTICS changed = ROW_COUNT;
      copied := copied + changed;
    EXCEPTION WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
      retry := true;
    END;
    COMMIT;
    IF retry THEN
      attempts := attempts + 1;
      IF attempts >= 20 THEN
        RAISE EXCEPTION 'Project column copy remains busy; safe to retry migration'
          USING ERRCODE = '55P03', DETAIL = batch_ids[1];
      END IF;
      PERFORM pg_sleep(0.05 + random() * 0.15);
      COMMIT;
    ELSE
      attempts := 0;
      previous_id := batch_ids[cardinality(batch_ids)];
    END IF;
  END LOOP;
  RAISE NOTICE 'Project column copy complete: % environments copied', copied;
END;
$$;
--> statement-breakpoint
-- Older servers need a whole-CALL bound; committed batches survive a timeout and replay.
SELECT set_config('statement_timeout', CASE WHEN current_setting('transaction_timeout', true) IS NULL
  THEN '5s' ELSE '15min' END, false);
--> statement-breakpoint
CALL pg_temp.copy_workspace_projects();
--> statement-breakpoint
DROP PROCEDURE pg_temp.copy_workspace_projects();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM workspace w LEFT JOIN project_workspace pw ON pw.workspace_id = w.id
    WHERE w.project_id IS DISTINCT FROM pw.project_id
  ) THEN
    RAISE EXCEPTION 'Project column and connector assignments disagree; reconcile before retrying'
      USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
SET lock_timeout = '5s';
--> statement-breakpoint
SET statement_timeout = 0;
