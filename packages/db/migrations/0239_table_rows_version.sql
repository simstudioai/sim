ALTER TABLE "user_table_definitions" ADD COLUMN "rows_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint

-- ============================================================
-- Statement-level rows_version maintenance for user_table_rows.
--
-- rows_version is a monotonic counter keyed by the snapshot cache: a CSV stored
-- under v{rows_version} stays valid until the table mutates. The bump MUST live
-- in a trigger, not application code -- every row write (insert/update/delete,
-- including order_key reorders, which are UPDATEs) must invalidate the snapshot,
-- and a trigger is the only bypass-proof layer.
--
-- Mirrors the statement-level row_count triggers (migration 0224): transition
-- tables let one UPDATE bump every affected table once per statement, so a bulk
-- reorder or import is +1, not +N -- avoiding the per-row lock contention on the
-- single definition row that 0224 removed. The NEW transition table carries the
-- affected table_id for INSERT/UPDATE (table_id never changes), the OLD table for
-- DELETE; both are aliased `changed_rows` so one function serves all three.
-- ============================================================

CREATE OR REPLACE FUNCTION bump_user_table_rows_version()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions d
    SET rows_version = d.rows_version + 1
    FROM (SELECT DISTINCT table_id FROM changed_rows) c
    WHERE d.id = c.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER user_table_rows_version_insert_trigger
    AFTER INSERT ON user_table_rows
    REFERENCING NEW TABLE AS changed_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION bump_user_table_rows_version();
--> statement-breakpoint

CREATE TRIGGER user_table_rows_version_update_trigger
    AFTER UPDATE ON user_table_rows
    REFERENCING NEW TABLE AS changed_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION bump_user_table_rows_version();
--> statement-breakpoint

CREATE TRIGGER user_table_rows_version_delete_trigger
    AFTER DELETE ON user_table_rows
    REFERENCING OLD TABLE AS changed_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION bump_user_table_rows_version();
