-- Concurrent index operations cannot run inside the migration runner's transaction.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "user_table_rows_table_created_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_table_rows_table_created_id_idx" ON "user_table_rows" USING btree ("table_id","created_at","id");--> statement-breakpoint
SET lock_timeout = '5s';
