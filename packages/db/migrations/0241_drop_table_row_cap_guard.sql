-- Drop the row-count cap from the statement-level insert trigger (migration 0224).
--
-- Row-limit enforcement moved to a best-effort application check against the
-- workspace's CURRENT plan limit (see apps/sim/lib/table/billing.ts
-- `assertRowCapacity`). The previous design froze the plan limit into
-- user_table_definitions.max_rows at table-creation time, so plan upgrades never
-- raised an existing table's cap (and downgrades were never enforced).
--
-- The trigger now only maintains user_table_definitions.row_count -- an
-- unconditional set-based UPDATE mirroring decrement_user_table_row_count_stmt().
-- The frozen max_rows column is no longer consulted on insert.
CREATE OR REPLACE FUNCTION increment_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions d
    SET row_count = d.row_count + c.n,
        updated_at = now()
    FROM (
        SELECT table_id, count(*)::int AS n
        FROM new_rows
        GROUP BY table_id
    ) c
    WHERE d.id = c.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
