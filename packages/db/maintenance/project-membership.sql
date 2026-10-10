-- Installed by the registered Project migration after bounded backfill and verification.
COMMIT;
--> statement-breakpoint
-- Validation scans and concurrent index builds have a separate 60-second budget.
SET statement_timeout = '60s';
--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('public.project_membership_rollout') IS NULL THEN
    IF to_regclass('public.project_workspace') IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.workspace'::regclass
        AND attname = 'project_id' AND attnotnull AND NOT attisdropped)
      OR (SELECT count(*) FROM pg_constraint
        WHERE conrelid = 'public.workspace'::regclass AND contype = 'f' AND convalidated
        AND conname IN ('workspace_project_id_project_id_fk',
          'workspace_project_organization_fk', 'workspace_fork_project_fk')) <> 3 THEN
      RAISE EXCEPTION 'Project membership rollout marker is missing before completed contraction' USING ERRCODE = '55000';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.project_membership_rollout WHERE id = 'membership' AND phase = 'column') THEN
    RAISE EXCEPTION 'Project membership authority must switch before enforcement' USING ERRCODE = '55000';
  END IF;
  IF NOT pg_try_advisory_lock(hashtextextended('sim:project-backfill-operator', 0)) THEN
    RAISE EXCEPTION 'Project preparation is still running; finish it before enforcement' USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.validate_project_membership() RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
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
-- The generated expression always returns non-NULL, including personal scope; writers cannot override it.
-- Stored generated columns rewrite existing rows on PG16/17. Bound the rewrite and lock wait;
-- a timeout rolls this phase back and leaves the connector intact for a later retry.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
LOCK TABLE project, workspace IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $$ BEGIN
  IF to_regclass('project_workspace') IS NOT NULL THEN
    LOCK TABLE project_workspace IN ACCESS EXCLUSIVE MODE NOWAIT;
  END IF;
END $$;
ALTER TABLE project ADD COLUMN IF NOT EXISTS organization_scope_key text
  GENERATED ALWAYS AS (CASE WHEN organization_id IS NULL THEN 'personal' ELSE 'organization:' || organization_id END) STORED;
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS organization_scope_key text
  GENERATED ALWAYS AS (CASE WHEN organization_id IS NULL THEN 'personal' ELSE 'organization:' || organization_id END) STORED;
COMMIT;
--> statement-breakpoint
SET statement_timeout = '5s';
--> statement-breakpoint
-- Only invalid, unreferenced indexes from interrupted builds are removed. Valid indexes survive
-- replay, including when the final foreign keys already depend on them.
DO $$ DECLARE target_name text; BEGIN
  FOR target_name IN SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relnamespace = 'public'::regnamespace AND NOT i.indisvalid
      AND c.relname IN ('project_id_organization_scope_unique', 'workspace_id_project_unique')
  LOOP
    EXECUTE format('DROP INDEX %I', target_name);
  END LOOP;
END $$;
--> statement-breakpoint
SET lock_timeout = 0;
SET statement_timeout = '60s';
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS project_id_organization_scope_unique ON project(id, organization_scope_key);
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS workspace_id_project_unique ON workspace(id, project_id);
--> statement-breakpoint
SET lock_timeout = '1s';
SET statement_timeout = '5s';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'project'::regclass
    AND conname = 'project_id_organization_scope_unique') THEN
    ALTER TABLE project ADD CONSTRAINT project_id_organization_scope_unique
      UNIQUE USING INDEX project_id_organization_scope_unique;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace'::regclass
    AND conname = 'workspace_id_project_unique') THEN
    ALTER TABLE workspace ADD CONSTRAINT workspace_id_project_unique
      UNIQUE USING INDEX workspace_id_project_unique;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace'::regclass
    AND conname = 'workspace_project_organization_fk') THEN
    ALTER TABLE workspace ADD CONSTRAINT workspace_project_organization_fk
      FOREIGN KEY (project_id, organization_scope_key) REFERENCES project(id, organization_scope_key)
      DEFERRABLE INITIALLY DEFERRED NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace'::regclass
    AND conname = 'workspace_fork_project_fk') THEN
    ALTER TABLE workspace ADD CONSTRAINT workspace_fork_project_fk
      FOREIGN KEY (forked_from_workspace_id, project_id) REFERENCES workspace(id, project_id)
      DEFERRABLE INITIALLY DEFERRED NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- Drizzle represents the FK columns/actions; the shared finalizer owns deferred timing on push.
ALTER TABLE workspace ALTER CONSTRAINT workspace_project_organization_fk DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE workspace ALTER CONSTRAINT workspace_fork_project_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
ALTER TABLE workspace VALIDATE CONSTRAINT workspace_project_organization_fk;
--> statement-breakpoint
ALTER TABLE workspace VALIDATE CONSTRAINT workspace_fork_project_fk;
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
-- migration-safe: contract of #8830, gated on its authority-aware release being fully deployed, incompatible app/worker versions having drained, and the column-authority switch being committed; the validated check proves existing rows.
ALTER TABLE workspace ALTER COLUMN project_id SET NOT NULL;
-- migration-safe: the required column now enforces the validated helper check's invariant.
ALTER TABLE workspace DROP CONSTRAINT IF EXISTS workspace_project_id_present;
--> statement-breakpoint
-- migration-safe: contract of #8830, gated on its authority-aware release being fully deployed, incompatible app/worker versions having drained, and the column-authority switch being committed; no supported application reader or writer then needs this connector.
DROP TABLE IF EXISTS project_workspace;
-- migration-safe: contract of #8830, whose deployed readers recognize the required column and validated foreign keys after both temporary tables disappear atomically under the workspace barrier.
DROP TABLE IF EXISTS project_membership_rollout;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
-- Composite foreign keys protect structural writes; compatible application transactions own lifecycle.
SELECT pg_temp.validate_project_membership();
--> statement-breakpoint
DROP FUNCTION pg_temp.validate_project_membership();
--> statement-breakpoint
SET statement_timeout = 0;
--> statement-breakpoint
SET lock_timeout = '5s';
