-- Installed by the registered Project migration after bounded backfill and verification.
COMMIT;
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT pg_try_advisory_lock(hashtextextended('sim:project-backfill-operator', 0)) THEN
    RAISE EXCEPTION 'Project preparation is still running; finish it before enforcement' USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.validate_project_membership() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reachable(id) AS (
      SELECT id FROM workspace WHERE forked_from_workspace_id IS NULL
      UNION
      SELECT w.id FROM workspace w JOIN reachable r ON w.forked_from_workspace_id = r.id
    ) SELECT 1 FROM workspace w LEFT JOIN reachable r ON r.id = w.id WHERE r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Project backfill found a fork cycle or missing parent; reconcile before retrying' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM workspace w WHERE w.project_id IS NULL) THEN
    RAISE EXCEPTION 'Project preparation is incomplete; rerun the Project script migration before enforcement' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM project p LEFT JOIN workspace w ON w.project_id = p.id
    GROUP BY p.id HAVING count(w.id) = 0
      OR (p.archived_at IS NULL AND count(w.id) FILTER (WHERE w.archived_at IS NULL) = 0)
      OR (p.archived_at IS NOT NULL AND count(w.id) FILTER (WHERE w.archived_at IS NULL) > 0)
  ) THEN
    RAISE EXCEPTION 'Project enforcement requires nonempty Projects with consistent archive state; reconcile and retry the migration' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM workspace w JOIN project p ON p.id = w.project_id
    WHERE w.organization_id IS DISTINCT FROM p.organization_id
  ) OR EXISTS (
    SELECT 1 FROM workspace w LEFT JOIN workspace parent ON parent.id = w.forked_from_workspace_id
    WHERE w.forked_from_workspace_id IS NOT NULL AND parent.project_id IS DISTINCT FROM w.project_id
  ) THEN
    RAISE EXCEPTION 'Project enforcement requires reconciled organization scope and fork membership' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM project p JOIN workspace w ON w.project_id = p.id
    JOIN workflow f ON f.workspace_id = w.id
    WHERE (p.archived_at IS NOT NULL OR w.archived_at IS NOT NULL) AND f.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Project enforcement requires archived Projects to have no active workflows' USING ERRCODE = '55000';
  END IF;
END;
$$;
--> statement-breakpoint
SELECT pg_temp.validate_project_membership();
--> statement-breakpoint
SET lock_timeout = '1s';
--> statement-breakpoint
SET statement_timeout = '5s';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace'::regclass
    AND conname = 'workspace_project_id_project_id_fk') THEN
    ALTER TABLE workspace ADD CONSTRAINT workspace_project_id_project_id_fk
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'workspace'::regclass
    AND attname = 'project_id' AND attnotnull)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace'::regclass
      AND conname = 'workspace_project_id_present') THEN
    ALTER TABLE workspace ADD CONSTRAINT workspace_project_id_present CHECK (project_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
ALTER TABLE workspace VALIDATE CONSTRAINT workspace_project_id_project_id_fk;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace'::regclass
    AND conname = 'workspace_project_id_present') THEN
    ALTER TABLE workspace VALIDATE CONSTRAINT workspace_project_id_present;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_assert_project(target_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  record project%ROWTYPE;
  total bigint;
  active bigint;
BEGIN
  SELECT * INTO record FROM project WHERE id = target_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*), count(*) FILTER (WHERE w.archived_at IS NULL)
    INTO total, active FROM workspace w WHERE w.project_id = target_id;
  IF total = 0 OR (record.archived_at IS NULL AND active = 0)
    OR (record.archived_at IS NOT NULL AND active > 0) THEN
    RAISE EXCEPTION 'Project must retain environments with consistent archive state'
      USING ERRCODE = '23514', CONSTRAINT = 'project_environment_lifecycle';
  END IF;
  IF EXISTS (
    SELECT 1 FROM workspace w
    WHERE w.project_id = target_id AND w.organization_id IS DISTINCT FROM record.organization_id
  ) THEN
    RAISE EXCEPTION 'Project and environment organization must agree'
      USING ERRCODE = '23514', CONSTRAINT = 'project_environment_organization';
  END IF;
  IF record.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM workspace w JOIN workflow f ON f.workspace_id = w.id
    WHERE w.project_id = target_id AND f.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Archived Project cannot contain active workflows'
      USING ERRCODE = '23514', CONSTRAINT = 'project_workflow_lifecycle';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_assert_workspace(target_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  parent_id text;
  member_project_id text;
  parent_project_id text;
BEGIN
  SELECT forked_from_workspace_id, project_id INTO parent_id, member_project_id FROM workspace WHERE id = target_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF parent_id IS NOT NULL THEN
    SELECT project_id INTO parent_project_id FROM workspace WHERE id = parent_id;
    IF parent_project_id IS DISTINCT FROM member_project_id THEN
      RAISE EXCEPTION 'Connected fork environments must belong to the same Project'
        USING ERRCODE = '23514', CONSTRAINT = 'workspace_fork_project';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM workspace child
    WHERE child.forked_from_workspace_id = target_id AND child.project_id IS DISTINCT FROM member_project_id
  ) THEN
    RAISE EXCEPTION 'Connected fork environments must belong to the same Project'
      USING ERRCODE = '23514', CONSTRAINT = 'workspace_fork_project';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_lock_projects(target_ids text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target_id text;
BEGIN
  FOR target_id IN SELECT DISTINCT id FROM unnest(target_ids) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    -- BEFORE row triggers already hold row locks; waiting here could invert the application lock order.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('project:' || target_id, 0)) THEN
      RAISE EXCEPTION 'Project is changing; retry the operation' USING ERRCODE = '55P03';
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  previous_id text;
  next_id text;
BEGIN
  IF TG_TABLE_NAME = 'project' THEN
    IF TG_OP <> 'INSERT' THEN previous_id := OLD.id; END IF;
    IF TG_OP <> 'DELETE' THEN next_id := NEW.id; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN previous_id := OLD.project_id; END IF;
    IF TG_OP <> 'DELETE' THEN next_id := NEW.project_id; END IF;
  END IF;
  PERFORM project_contract_lock_projects(ARRAY[previous_id, next_id]);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  previous_id text;
  next_id text;
  target_ids text[];
  workspace_ids text[];
  target_id text;
BEGIN
  IF TG_TABLE_NAME = 'project' THEN
    -- Only the final row version needs a full scan; earlier deferred events describe superseded states.
    IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM project WHERE id = NEW.id AND ctid = NEW.ctid) THEN
      PERFORM project_contract_assert_project(NEW.id);
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN previous_id := OLD.project_id; END IF;
  IF TG_OP <> 'DELETE' THEN next_id := NEW.project_id; END IF;
  target_ids := ARRAY[previous_id, next_id];
  previous_id := NULL;
  next_id := NULL;
  IF TG_OP <> 'INSERT' THEN previous_id := OLD.id; END IF;
  IF TG_OP <> 'DELETE' THEN next_id := NEW.id; END IF;
  workspace_ids := ARRAY[previous_id, next_id];
  FOR target_id IN SELECT DISTINCT id FROM unnest(target_ids) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    -- Touch after the mutation: immediate constraints must see it too, and repeatable-read must detect stale snapshots.
    UPDATE project SET updated_at = updated_at WHERE id = target_id;
  END LOOP;
  FOR target_id IN SELECT DISTINCT id FROM unnest(workspace_ids) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM project_contract_assert_workspace(target_id);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
BEGIN;
--> statement-breakpoint
-- PG17 caps the transaction; PG16 caps idle time, with each statement bounded below.
SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
  THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true);
--> statement-breakpoint
SET LOCAL lock_timeout = '1s';
--> statement-breakpoint
SET LOCAL statement_timeout = '5s';
--> statement-breakpoint
-- Keep enforcement and bridge retirement atomic; data scans run outside this transaction.
LOCK TABLE workspace, project IN ACCESS EXCLUSIVE MODE NOWAIT;
--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('project_workspace') IS NOT NULL THEN
    LOCK TABLE project_workspace IN ACCESS EXCLUSIVE MODE NOWAIT;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safe: contract of #8830, gated on its column-only release being fully deployed and all pre-8830 servers/workers having drained; the validated check proves existing rows.
ALTER TABLE workspace ALTER COLUMN project_id SET NOT NULL;
-- migration-safe: the required column now enforces the validated helper check's invariant.
ALTER TABLE workspace DROP CONSTRAINT IF EXISTS workspace_project_id_present;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_contract_lock ON project;
CREATE TRIGGER project_contract_lock BEFORE INSERT OR UPDATE OR DELETE ON project
FOR EACH ROW EXECUTE FUNCTION project_contract_before_write();
DROP TRIGGER IF EXISTS project_contract_check ON project;
CREATE CONSTRAINT TRIGGER project_contract_check AFTER INSERT OR UPDATE OR DELETE ON project
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_contract_after_write();
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_contract_lock ON workspace;
CREATE TRIGGER project_contract_lock BEFORE INSERT OR UPDATE OF id, project_id, archived_at, organization_id, forked_from_workspace_id OR DELETE ON workspace
FOR EACH ROW EXECUTE FUNCTION project_contract_before_write();
DROP TRIGGER IF EXISTS project_contract_check ON workspace;
CREATE CONSTRAINT TRIGGER project_contract_check AFTER INSERT OR UPDATE OF id, project_id, archived_at, organization_id, forked_from_workspace_id OR DELETE ON workspace
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_contract_after_write();
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_sync_project_membership ON workspace;
-- migration-safe: contract of #8830, gated on its column-only release being fully deployed and all pre-8830 servers/workers having drained; no supported application reader or writer then needs this connector.
DROP TABLE IF EXISTS project_workspace;
DROP FUNCTION IF EXISTS workspace_sync_project_membership_fn();
DROP FUNCTION IF EXISTS project_workspace_sync_column_fn();
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
-- Membership triggers and compatible workspace-guarded writers protect new writes during validation.
SELECT pg_temp.validate_project_membership();
--> statement-breakpoint
DROP FUNCTION pg_temp.validate_project_membership();
--> statement-breakpoint
SET statement_timeout = 0;
--> statement-breakpoint
SET lock_timeout = '5s';
