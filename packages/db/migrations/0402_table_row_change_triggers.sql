-- Row writes append to user_table_row_changes instead of updating the table's definition row.
--
-- Every row-count and rows_version trigger updated the one user_table_definitions row per table
-- and held that lock until the commit was acknowledged, so a commit stalled on synchronous
-- replication made every other writer to the table queue behind it and hit lock_timeout. An
-- INSERT into the log takes no lock another writer waits on (its foreign-key check is KEY SHARE,
-- which only a table delete conflicts with). The fold cron moves the log into the definition row,
-- and readers already add the unfolded tail (0396), so the deployed app reads the same values.
--
-- One log row per table per INSERT or DELETE statement carries +n / -n rows and one version bump,
-- which replaces both the row-count triggers (0224) and the version insert/delete triggers (0240).
-- The deferred UPDATE trigger (0390) keeps its column filter and per-transaction dedupe and logs a
-- zero-delta row instead of bumping. Function and trigger names stay, so nothing else is renamed.
-- The DELETE and UPDATE triggers skip tables whose definition is gone: deleting a table or
-- workspace cascades into its rows after the definition row is already deleted, and nothing is
-- left to count.
--
-- Earlier migrations in the same deploy may COMMIT the runner's batch transaction. Re-open one so
-- the swap is atomic: between a separately committed function swap and trigger drop, a write
-- would bump the version twice or log no row at all.
BEGIN;--> statement-breakpoint

CREATE OR REPLACE FUNCTION increment_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_table_row_changes (table_id, row_delta)
    SELECT table_id, count(*)::integer FROM new_rows GROUP BY table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION decrement_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_table_row_changes (table_id, row_delta)
    SELECT o.table_id, -count(*)::integer FROM old_rows o
    WHERE EXISTS (SELECT 1 FROM user_table_definitions d WHERE d.id = o.table_id)
    GROUP BY o.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

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
        INSERT INTO user_table_row_changes (table_id, row_delta)
        SELECT NEW.table_id, 0
        WHERE EXISTS (SELECT 1 FROM user_table_definitions d WHERE d.id = NEW.table_id);
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_table_rows_version_insert_trigger ON user_table_rows;--> statement-breakpoint
DROP TRIGGER IF EXISTS user_table_rows_version_delete_trigger ON user_table_rows;--> statement-breakpoint
DROP FUNCTION IF EXISTS bump_user_table_rows_version();--> statement-breakpoint

COMMIT;
