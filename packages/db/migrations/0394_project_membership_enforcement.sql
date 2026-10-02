BEGIN;
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
LOCK TABLE workspace, project, project_workspace, workflow IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace w LEFT JOIN project_workspace pw ON pw.workspace_id = w.id WHERE pw.workspace_id IS NULL) THEN
    RAISE EXCEPTION 'Project enforcement requires the reviewed Project backfill: missing environment memberships' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM project p LEFT JOIN project_workspace pw ON pw.project_id = p.id
    LEFT JOIN workspace w ON w.id = pw.workspace_id
    GROUP BY p.id HAVING count(w.id) = 0
      OR (p.archived_at IS NULL AND count(w.id) FILTER (WHERE w.archived_at IS NULL) = 0)
      OR (p.archived_at IS NOT NULL AND count(w.id) FILTER (WHERE w.archived_at IS NULL) > 0)
  ) THEN
    RAISE EXCEPTION 'Project enforcement requires nonempty Projects with consistent archive state; reconcile and verify the backfill' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM project_workspace pw JOIN project p ON p.id = pw.project_id
    JOIN workspace w ON w.id = pw.workspace_id WHERE w.organization_id IS DISTINCT FROM p.organization_id
  ) OR EXISTS (
    SELECT 1 FROM workspace w JOIN project_workspace child ON child.workspace_id = w.id
    LEFT JOIN project_workspace parent ON parent.workspace_id = w.forked_from_workspace_id
    WHERE w.forked_from_workspace_id IS NOT NULL AND parent.project_id IS DISTINCT FROM child.project_id
  ) THEN
    RAISE EXCEPTION 'Project enforcement requires reconciled organization scope and fork membership' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM project p JOIN project_workspace pw ON pw.project_id = p.id
    JOIN workflow f ON f.workspace_id = pw.workspace_id
    WHERE p.archived_at IS NOT NULL AND f.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Project enforcement requires archived Projects to have no active workflows' USING ERRCODE = '55000';
  END IF;
END;
$$;
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
    INTO total, active FROM project_workspace pw JOIN workspace w ON w.id = pw.workspace_id
    WHERE pw.project_id = target_id;
  IF total = 0 OR (record.archived_at IS NULL AND active = 0)
    OR (record.archived_at IS NOT NULL AND active > 0) THEN
    RAISE EXCEPTION 'Project must retain environments with consistent archive state'
      USING ERRCODE = '23514', CONSTRAINT = 'project_environment_lifecycle';
  END IF;
  IF EXISTS (
    SELECT 1 FROM project_workspace pw JOIN workspace w ON w.id = pw.workspace_id
    WHERE pw.project_id = target_id AND w.organization_id IS DISTINCT FROM record.organization_id
  ) THEN
    RAISE EXCEPTION 'Project and environment organization must agree'
      USING ERRCODE = '23514', CONSTRAINT = 'project_environment_organization';
  END IF;
  IF record.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM project_workspace pw JOIN workflow f ON f.workspace_id = pw.workspace_id
    WHERE pw.project_id = target_id AND f.archived_at IS NULL
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
  SELECT forked_from_workspace_id INTO parent_id FROM workspace WHERE id = target_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT project_id INTO member_project_id FROM project_workspace WHERE workspace_id = target_id;
  IF member_project_id IS NULL THEN
    RAISE EXCEPTION 'Environment must belong to exactly one Project'
      USING ERRCODE = '23514', CONSTRAINT = 'workspace_project_required';
  END IF;
  IF parent_id IS NOT NULL THEN
    SELECT project_id INTO parent_project_id FROM project_workspace WHERE workspace_id = parent_id;
    IF parent_project_id IS DISTINCT FROM member_project_id THEN
      RAISE EXCEPTION 'Connected fork environments must belong to the same Project'
        USING ERRCODE = '23514', CONSTRAINT = 'workspace_fork_project';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM workspace child LEFT JOIN project_workspace pw ON pw.workspace_id = child.id
    WHERE child.forked_from_workspace_id = target_id AND pw.project_id IS DISTINCT FROM member_project_id
  ) THEN
    RAISE EXCEPTION 'Connected fork environments must belong to the same Project'
      USING ERRCODE = '23514', CONSTRAINT = 'workspace_fork_project';
  END IF;
  PERFORM project_contract_assert_project(member_project_id);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_lock_projects(target_ids text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target_id text;
BEGIN
  FOR target_id IN SELECT DISTINCT id FROM unnest(target_ids) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('project:' || target_id, 0));
    -- Touch the row so repeatable-read transactions serialize rather than accepting a stale environment count.
    UPDATE project SET updated_at = updated_at WHERE id = target_id;
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  previous_id text;
  next_id text;
  owners text[];
BEGIN
  IF TG_TABLE_NAME = 'project' THEN
    IF TG_OP <> 'INSERT' THEN previous_id := OLD.id; END IF;
    IF TG_OP <> 'DELETE' THEN next_id := NEW.id; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('project:' || coalesce(next_id, previous_id), 0));
  ELSIF TG_TABLE_NAME = 'project_workspace' THEN
    IF TG_OP <> 'INSERT' THEN previous_id := OLD.project_id; END IF;
    IF TG_OP <> 'DELETE' THEN next_id := NEW.project_id; END IF;
    PERFORM project_contract_lock_projects(ARRAY[previous_id, next_id]);
  ELSE
    IF TG_TABLE_NAME = 'workspace' THEN
      IF TG_OP <> 'INSERT' THEN previous_id := OLD.id; END IF;
      IF TG_OP <> 'DELETE' THEN next_id := NEW.id; END IF;
    ELSE
      IF TG_OP <> 'INSERT' THEN previous_id := OLD.workspace_id; END IF;
      IF TG_OP <> 'DELETE' THEN next_id := NEW.workspace_id; END IF;
    END IF;
    SELECT array_agg(project_id ORDER BY workspace_id) INTO owners FROM project_workspace WHERE workspace_id IN (previous_id, next_id);
    PERFORM project_contract_lock_projects(owners);
    IF owners IS DISTINCT FROM (
      SELECT array_agg(project_id ORDER BY workspace_id) FROM project_workspace
      WHERE workspace_id IN (previous_id, next_id)
    ) THEN
      RAISE EXCEPTION 'Environment changed Projects while acquiring its lifecycle lock; retry the transaction'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_contract_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'project' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM project_contract_assert_project(OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM project_contract_assert_project(NEW.id); END IF;
  ELSIF TG_TABLE_NAME = 'project_workspace' THEN
    IF TG_OP <> 'INSERT' THEN
      PERFORM project_contract_assert_project(OLD.project_id);
      PERFORM project_contract_assert_workspace(OLD.workspace_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM project_contract_assert_project(NEW.project_id);
      PERFORM project_contract_assert_workspace(NEW.workspace_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'workspace' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM project_contract_assert_workspace(OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM project_contract_assert_workspace(NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM project_contract_assert_workspace(OLD.workspace_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM project_contract_assert_workspace(NEW.workspace_id); END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_contract_lock ON project;
CREATE TRIGGER project_contract_lock BEFORE INSERT OR UPDATE OR DELETE ON project
FOR EACH ROW EXECUTE FUNCTION project_contract_before_write();
DROP TRIGGER IF EXISTS project_contract_check ON project;
CREATE CONSTRAINT TRIGGER project_contract_check AFTER INSERT OR UPDATE OR DELETE ON project
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_contract_after_write();
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_contract_lock ON project_workspace;
CREATE TRIGGER project_contract_lock BEFORE INSERT OR UPDATE OR DELETE ON project_workspace
FOR EACH ROW EXECUTE FUNCTION project_contract_before_write();
DROP TRIGGER IF EXISTS project_contract_check ON project_workspace;
CREATE CONSTRAINT TRIGGER project_contract_check AFTER INSERT OR UPDATE OR DELETE ON project_workspace
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_contract_after_write();
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_contract_lock ON workspace;
CREATE TRIGGER project_contract_lock BEFORE INSERT OR UPDATE OF id, archived_at, organization_id, forked_from_workspace_id OR DELETE ON workspace
FOR EACH ROW EXECUTE FUNCTION project_contract_before_write();
DROP TRIGGER IF EXISTS project_contract_check ON workspace;
CREATE CONSTRAINT TRIGGER project_contract_check AFTER INSERT OR UPDATE OF id, archived_at, organization_id, forked_from_workspace_id OR DELETE ON workspace
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_contract_after_write();
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_contract_lock ON workflow;
CREATE TRIGGER project_contract_lock BEFORE INSERT OR UPDATE OF workspace_id, archived_at OR DELETE ON workflow
FOR EACH ROW EXECUTE FUNCTION project_contract_before_write();
DROP TRIGGER IF EXISTS project_contract_check ON workflow;
CREATE CONSTRAINT TRIGGER project_contract_check AFTER INSERT OR UPDATE OF workspace_id, archived_at OR DELETE ON workflow
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_contract_after_write();
--> statement-breakpoint
COMMIT;
