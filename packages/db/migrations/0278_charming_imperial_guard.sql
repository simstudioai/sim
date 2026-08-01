-- Both tables carry `workflow_id ... ON DELETE SET NULL` (migration 0212) with no index leading
-- on that column. Postgres implements SET NULL as an AFTER ROW referential trigger running
-- `UPDATE ... SET workflow_id = NULL WHERE workflow_id = $1` once per deleted parent row, so
-- every `DELETE FROM workflow` sequentially scans both tables per workflow — enough to blow the
-- statement timeout once the soft-delete retention job starts hard-deleting archived workflows.
-- Both indexes exist to make that trigger index-driven.
--
-- Replay-safety: this file is only CONCURRENTLY index builds below an embedded COMMIT, so a
-- failure replays the whole file — both statements are idempotent.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_large_value_references_workflow_id_idx" ON "execution_large_value_references" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_large_values_workflow_id_idx" ON "execution_large_values" USING btree ("workflow_id");--> statement-breakpoint
SET lock_timeout = '5s';
