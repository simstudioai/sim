ALTER TABLE "user_table_definitions" ADD COLUMN "import_status" text;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "import_id" text;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "import_error" text;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "import_rows_processed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "import_started_at" timestamp;--> statement-breakpoint

-- ============================================================
-- Statement-level row-count maintenance for user_table_rows.
--
-- Replaces the per-row BEFORE INSERT / AFTER DELETE triggers from migration 0158
-- (whose increment function body was rewritten race-free in 0198, but which still
-- fired FOR EACH ROW). Per-row firing serialized a row-level lock on the single
-- user_table_definitions row once per inserted/deleted row -- the dominant cost and
-- contention point for bulk operations (e.g. a 1M-row import = 1M lock cycles).
--
-- The statement-level versions use transition tables to bump row_count by the
-- per-table count of affected rows in ONE UPDATE per statement, preserving the
-- atomic cap check. Transition tables require AFTER triggers, so the insert trigger
-- moves BEFORE -> AFTER: rows are inserted, then the count is bumped with the cap
-- check; an over-cap batch RAISEs and rolls back the whole statement.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
DECLARE
    over_cap text;
BEGIN
    -- Per-table counts within this statement; one capped UPDATE per affected table.
    -- A table_id present in the inserted rows always exists (FK), so any table the
    -- UPDATE did not touch was rejected by the `row_count + n <= max_rows` guard.
    WITH counts AS (
        SELECT table_id, count(*)::int AS n
        FROM new_rows
        GROUP BY table_id
    ),
    updated AS (
        UPDATE user_table_definitions d
        SET row_count = d.row_count + c.n,
            updated_at = now()
        FROM counts c
        WHERE d.id = c.table_id
          AND d.row_count + c.n <= d.max_rows
        RETURNING d.id
    )
    SELECT string_agg(c.table_id, ', ')
    INTO over_cap
    FROM counts c
    WHERE c.table_id NOT IN (SELECT id FROM updated);

    IF over_cap IS NOT NULL THEN
        RAISE EXCEPTION 'Maximum row limit reached for table(s) %', over_cap
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION decrement_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions d
    SET row_count = GREATEST(d.row_count - c.n, 0),
        updated_at = now()
    FROM (
        SELECT table_id, count(*)::int AS n
        FROM old_rows
        GROUP BY table_id
    ) c
    WHERE d.id = c.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_table_rows_insert_trigger ON user_table_rows;--> statement-breakpoint
DROP TRIGGER IF EXISTS user_table_rows_delete_trigger ON user_table_rows;--> statement-breakpoint

CREATE TRIGGER user_table_rows_insert_stmt_trigger
    AFTER INSERT ON user_table_rows
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION increment_user_table_row_count_stmt();
--> statement-breakpoint

CREATE TRIGGER user_table_rows_delete_stmt_trigger
    AFTER DELETE ON user_table_rows
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION decrement_user_table_row_count_stmt();
