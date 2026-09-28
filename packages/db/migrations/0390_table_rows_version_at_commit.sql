-- Bump rows_version for row UPDATEs once per transaction, at commit.
--
-- The statement-level UPDATE bump (0240) locked the table's definition row
-- inside every row-write transaction and held it across the remaining round
-- trips (executions patch, provenance sidecar, read capture) and the commit,
-- so concurrent writers to one table queued behind each other. It also bumped
-- on provenance-only UPDATEs, which leave the CSV snapshot bytes untouched.
--
-- A deferred constraint trigger fires at COMMIT, so the definition row is
-- locked only for the commit itself. It fires only for UPDATEs that set `data`
-- or `order_key`, and its WHEN clause (evaluated at event time) then queues an
-- event only when one of them actually changes: the CSV snapshot reads exactly
-- those (cells and row order). Listing the columns keeps provenance- and
-- executions-only UPDATEs from comparing `data` at all, as the demote trigger
-- (0283) already does. `id`, `table_id`, and `workspace_id` are
-- never updated, and the snapshot never reads `position`. Constraint triggers
-- are row-level only, so one transaction-local setting lists the tables already
-- bumped (a comma-delimited list of table ids, matched exactly; ids are
-- generated `tbl_<hex>` or UUIDs, so they never contain the delimiter) and
-- dedupes the bump to one per table per transaction. It resets at transaction
-- end, so each backend holds a single placeholder setting however many tables
-- it writes. The row write and its bump still commit atomically, which the
-- snapshot cache's read / scan / re-read relies on.
--
-- INSERT and DELETE keep their statement-level bumps: the row-count triggers
-- (0224) already lock the definition row in those statements.
--
-- Earlier migrations in the same deploy may COMMIT the runner's batch
-- transaction. Re-open one so the trigger swap below is atomic: between a
-- separately committed DROP and CREATE, a committed data write would get no
-- bump and leave the snapshot cache stale. When this is the only pending file,
-- PostgreSQL treats the BEGIN as a harmless nested-BEGIN warning.
BEGIN;--> statement-breakpoint

CREATE OR REPLACE FUNCTION bump_user_table_rows_version_at_commit()
RETURNS TRIGGER AS $$
DECLARE
    bumped text := coalesce(current_setting('sim_rows_version.bumped', true), '');
BEGIN
    IF position(',' || NEW.table_id || ',' IN ',' || bumped || ',') = 0 THEN
        PERFORM set_config(
            'sim_rows_version.bumped',
            CASE WHEN bumped = '' THEN NEW.table_id ELSE bumped || ',' || NEW.table_id END,
            true
        );
        UPDATE user_table_definitions
        SET rows_version = rows_version + 1
        WHERE id = NEW.table_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_table_rows_version_update_trigger ON user_table_rows;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER user_table_rows_version_update_trigger
    AFTER UPDATE OF data, order_key ON user_table_rows
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (
        OLD.data IS DISTINCT FROM NEW.data
        OR OLD.order_key IS DISTINCT FROM NEW.order_key
    )
    EXECUTE FUNCTION bump_user_table_rows_version_at_commit();
--> statement-breakpoint

-- Defer the table_id foreign-key check to COMMIT. A row UPDATEd twice in one
-- transaction (the cell write, then the provenance marker the demote trigger
-- forces into a second statement) re-runs the RI check on the second UPDATE,
-- because the old tuple is this transaction's own. That check takes KEY SHARE
-- on the definition row, so concurrent writers to one table pile into a
-- growing multixact that the commit-time bump then has to merge with. Deferred,
-- the check runs after the bump, on a row the transaction already holds.
-- ON DELETE CASCADE stays immediate, and ALTER CONSTRAINT is catalog-only.
ALTER TABLE user_table_rows
    ALTER CONSTRAINT user_table_rows_table_id_user_table_definitions_id_fk
    DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- Planner statistics for tenant-scoped row lookups.
--
-- Every row lookup filters on (table_id, workspace_id), and table_id
-- determines workspace_id. Without a functional-dependency statistic the
-- planner multiplies the two selectivities and underestimates a table's row
-- count by orders of magnitude, which steers `data @>` filters to the btree
-- instead of the tenant GIN. The per-column sample target stays at its
-- default: the dependency alone restores the GIN plan, and a larger target
-- would make every future autoanalyze of this table read more rows.

CREATE STATISTICS IF NOT EXISTS user_table_rows_workspace_table_stats (dependencies)
    ON workspace_id, table_id FROM user_table_rows;
--> statement-breakpoint

-- Release the DDL locks before the sample so writers never wait on it. The
-- statements above are idempotent, so replaying this file after a partial run
-- is safe.
COMMIT;
--> statement-breakpoint

ANALYZE user_table_rows;
