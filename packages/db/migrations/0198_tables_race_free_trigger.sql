-- Replace increment_user_table_row_count() with a race-free conditional UPDATE.
-- The prior version did SELECT row_count -> IF check -> UPDATE, which is
-- TOCTOU-vulnerable: two concurrent inserts near max_rows could both pass the
-- check and push row_count past the cap. Application code compensated with
-- SELECT ... FOR UPDATE on user_table_definitions, creating a serialization
-- hotspot on every insert.
--
-- The new version performs capacity check and increment as a single
-- conditional UPDATE. The UPDATE takes a row-level exclusive lock atomically,
-- so concurrent inserts serialize on that lock; once row_count reaches
-- max_rows, the WHERE clause returns zero rows and we RAISE. This lets the
-- application drop its FOR UPDATE without losing correctness.
CREATE OR REPLACE FUNCTION increment_user_table_row_count()
RETURNS TRIGGER AS $$
DECLARE
    updated_count INTEGER;
    max_allowed INTEGER;
BEGIN
    UPDATE user_table_definitions
    SET row_count = row_count + 1,
        updated_at = now()
    WHERE id = NEW.table_id
      AND row_count < max_rows
    RETURNING row_count, max_rows INTO updated_count, max_allowed;

    IF NOT FOUND THEN
        SELECT max_rows INTO max_allowed
        FROM user_table_definitions
        WHERE id = NEW.table_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Table % not found', NEW.table_id
              USING ERRCODE = 'foreign_key_violation';
        END IF;

        RAISE EXCEPTION 'Maximum row limit (%) reached for table %',
            max_allowed, NEW.table_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- One-shot reconcile: ensure user_table_definitions.row_count matches the
-- actual count of user_table_rows. Guards against any historical drift before
-- downstream readers (listTables, getTableById) start trusting the column.
UPDATE user_table_definitions d
SET row_count = sub.c
FROM (
    SELECT table_id, count(*)::integer AS c
    FROM user_table_rows
    GROUP BY table_id
) sub
WHERE d.id = sub.table_id
  AND d.row_count IS DISTINCT FROM sub.c;
--> statement-breakpoint

-- Tables that exist but have zero rows should report row_count = 0 (not a
-- stale non-zero value left from rows deleted while the trigger was broken).
UPDATE user_table_definitions d
SET row_count = 0
WHERE d.row_count <> 0
  AND NOT EXISTS (
      SELECT 1 FROM user_table_rows r WHERE r.table_id = d.id
  );
