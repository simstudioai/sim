CREATE OR REPLACE FUNCTION increment_user_table_row_count()
RETURNS TRIGGER AS $$
DECLARE
    updated_count INTEGER;
    max_allowed INTEGER;
BEGIN
    UPDATE user_table_definitions
    SET row_count = row_count + 1,
        updated_at = timezone('UTC', now())
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

CREATE OR REPLACE FUNCTION decrement_user_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions
    SET row_count = GREATEST(row_count - 1, 0),
        updated_at = timezone('UTC', now())
    WHERE id = OLD.table_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION increment_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions d
    SET row_count = d.row_count + c.n,
        updated_at = timezone('UTC', now())
    FROM (
        SELECT table_id, count(*)::int AS n
        FROM new_rows
        GROUP BY table_id
    ) c
    WHERE d.id = c.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION decrement_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions d
    SET row_count = GREATEST(d.row_count - c.n, 0),
        updated_at = timezone('UTC', now())
    FROM (
        SELECT table_id, count(*)::int AS n
        FROM old_rows
        GROUP BY table_id
    ) c
    WHERE d.id = c.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
