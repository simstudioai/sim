-- Each family commits separately; never retain locks across the full backfill.
-- The migration runner serializes runners with its session advisory lock.
COMMIT;
--> statement-breakpoint
SET statement_timeout = '15min';
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS project_backfill_roots (id text PRIMARY KEY) ON COMMIT PRESERVE ROWS;
TRUNCATE project_backfill_roots;
INSERT INTO project_backfill_roots SELECT id FROM workspace WHERE forked_from_workspace_id IS NULL;
--> statement-breakpoint
CREATE OR REPLACE PROCEDURE pg_temp.backfill_project_families() LANGUAGE plpgsql AS $$
DECLARE
  root_id text;
  previous_root text;
  environment_id text;
  family_ids text[];
  current_ids text[];
  project_ids text[];
  target_project text;
  root workspace%ROWTYPE;
  existing project%ROWTYPE;
  archive_time timestamp;
  attempts integer := 0;
  completed integer := 0;
  assigned integer := 0;
  inserted integer;
  retry boolean;
BEGIN
  LOOP
    SELECT id INTO root_id FROM project_backfill_roots
      WHERE previous_root IS NULL OR id > previous_root ORDER BY id LIMIT 1;
    EXIT WHEN root_id IS NULL;
    -- A pathological family cannot hold environment locks indefinitely (PostgreSQL 17+).
    PERFORM set_config('transaction_timeout', '5s', true);
    PERFORM set_config('lock_timeout', '1s', true);
    retry := false;
    BEGIN
      WITH RECURSIVE family(id) AS (
        SELECT id FROM workspace WHERE id = root_id AND forked_from_workspace_id IS NULL
        UNION
        SELECT w.id FROM workspace w JOIN family f ON w.forked_from_workspace_id = f.id
      ) SELECT array_agg(id ORDER BY id) INTO family_ids FROM (SELECT id FROM family LIMIT 1001) bounded;
      IF cardinality(family_ids) > 1000 THEN
        RAISE EXCEPTION 'Project backfill family exceeds 1000 environments' USING ERRCODE = '54000', DETAIL = root_id;
      END IF;
      IF family_ids IS NOT NULL THEN
        -- Application writers take the shared form before reading membership, including absence.
        FOREACH environment_id IN ARRAY family_ids LOOP
          IF NOT pg_try_advisory_xact_lock(hashtextextended('project-backfill:' || environment_id, 0)) THEN
            RAISE EXCEPTION 'Project backfill environment is busy' USING ERRCODE = '55P03';
          END IF;
        END LOOP;
        -- Do not wait while holding a partial lock set; unrelated environments remain writable.
        PERFORM id FROM workspace WHERE id = ANY(family_ids) ORDER BY id FOR NO KEY UPDATE NOWAIT;
        WITH RECURSIVE family(id) AS (
          SELECT id FROM workspace WHERE id = root_id AND forked_from_workspace_id IS NULL
          UNION
          SELECT w.id FROM workspace w JOIN family f ON w.forked_from_workspace_id = f.id
        ) SELECT array_agg(id ORDER BY id) INTO current_ids FROM (SELECT id FROM family LIMIT 1001) bounded;
        IF family_ids IS DISTINCT FROM current_ids THEN
          RAISE EXCEPTION 'Project backfill lineage changed during discovery' USING ERRCODE = '55P03';
        END IF;
        SELECT * INTO STRICT root FROM workspace WHERE id = root_id;
        IF EXISTS (SELECT 1 FROM workspace WHERE id = ANY(family_ids) AND organization_id IS DISTINCT FROM root.organization_id) THEN
          RAISE EXCEPTION 'Project backfill family spans organizations; reconcile before retrying' USING ERRCODE = '55000', DETAIL = root_id;
        END IF;
        SELECT array_agg(DISTINCT project_id ORDER BY project_id) INTO project_ids
          FROM project_workspace WHERE workspace_id = ANY(family_ids);
        IF cardinality(project_ids) > 1 THEN
          RAISE EXCEPTION 'Project backfill family spans Projects; reconcile before retrying' USING ERRCODE = '55000', DETAIL = root_id;
        END IF;
        SELECT CASE WHEN count(*) = count(archived_at) THEN max(archived_at) END INTO archive_time
          FROM workspace WHERE id = ANY(family_ids);
        target_project := project_ids[1];
        IF target_project IS NOT NULL THEN
          IF NOT pg_try_advisory_xact_lock(hashtextextended('project:' || target_project, 0)) THEN
            RAISE EXCEPTION 'Project backfill Project is busy' USING ERRCODE = '55P03';
          END IF;
          SELECT * INTO STRICT existing FROM project WHERE id = target_project FOR UPDATE NOWAIT;
          IF existing.organization_id IS DISTINCT FROM root.organization_id
            OR (existing.archived_at IS NULL) <> (archive_time IS NULL)
            OR EXISTS (SELECT 1 FROM project_workspace WHERE project_id = target_project AND NOT workspace_id = ANY(family_ids)) THEN
            RAISE EXCEPTION 'Project backfill existing assignment has incompatible scope, archive state, or lineage' USING ERRCODE = '55000', DETAIL = root_id;
          END IF;
        ELSE
          target_project := gen_random_uuid()::text;
          INSERT INTO project (id, name, owner_id, organization_id, archived_at)
            VALUES (target_project, left(coalesce(nullif(btrim(root.name), ''), 'Untitled'), 90) || ' - Project', root.owner_id, root.organization_id, archive_time);
        END IF;
        INSERT INTO project_workspace (project_id, workspace_id)
          SELECT target_project, id FROM unnest(family_ids) ids(id)
          WHERE NOT EXISTS (SELECT 1 FROM project_workspace pw WHERE pw.workspace_id = ids.id);
        GET DIAGNOSTICS inserted = ROW_COUNT;
        assigned := assigned + inserted;
      END IF;
    EXCEPTION WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
      retry := true;
    END;
    -- Commit outside the exception subtransaction, releasing every row/advisory lock before retry.
    COMMIT;
    IF retry THEN
      attempts := attempts + 1;
      IF attempts >= 20 THEN
        RAISE EXCEPTION 'Project backfill family remains busy; safe to retry migration' USING ERRCODE = '55P03', DETAIL = root_id;
      END IF;
      PERFORM pg_sleep(0.05 + random() * 0.15);
      COMMIT;
    ELSE
      attempts := 0;
      completed := completed + 1;
      previous_root := root_id;
      IF completed % 100 = 0 THEN
        RAISE NOTICE 'Project backfill: % families processed, % memberships assigned', completed, assigned;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Project backfill complete: % families processed, % memberships assigned', completed, assigned;
END;
$$;
--> statement-breakpoint
CALL pg_temp.backfill_project_families();
--> statement-breakpoint
DROP PROCEDURE pg_temp.backfill_project_families();
-- migration-safe: session-local scratch table created above; no application readers or persistent data.
DROP TABLE pg_temp.project_backfill_roots;
--> statement-breakpoint
SET statement_timeout = '60s';
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
  IF EXISTS (SELECT 1 FROM workspace w LEFT JOIN project_workspace pw ON pw.workspace_id = w.id WHERE pw.workspace_id IS NULL) THEN
    RAISE EXCEPTION 'Project enforcement found environments unreachable from a valid fork root or concurrently detached; reconcile and retry' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM project p LEFT JOIN project_workspace pw ON pw.project_id = p.id
    LEFT JOIN workspace w ON w.id = pw.workspace_id
    GROUP BY p.id HAVING count(w.id) = 0
      OR (p.archived_at IS NULL AND count(w.id) FILTER (WHERE w.archived_at IS NULL) = 0)
      OR (p.archived_at IS NOT NULL AND count(w.id) FILTER (WHERE w.archived_at IS NULL) > 0)
  ) THEN
    RAISE EXCEPTION 'Project enforcement requires nonempty Projects with consistent archive state; reconcile and retry the migration' USING ERRCODE = '55000';
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
SELECT pg_temp.validate_project_membership();
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
BEGIN;
--> statement-breakpoint
SET LOCAL lock_timeout = '1s';
--> statement-breakpoint
SET LOCAL statement_timeout = '5s';
--> statement-breakpoint
-- Only trigger installation holds table locks. Both data scans run outside this transaction.
LOCK TABLE workspace, project, project_workspace, workflow IN ACCESS EXCLUSIVE MODE NOWAIT;
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
--> statement-breakpoint
-- Installed triggers keep new writes valid while this read-only scan checks existing rows.
SELECT pg_temp.validate_project_membership();
--> statement-breakpoint
DROP FUNCTION pg_temp.validate_project_membership();
--> statement-breakpoint
SET statement_timeout = 0;
