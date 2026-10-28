-- Owner lookups for member departure and account deletion; the user FKs cascade through them too.
DO $$
DECLARE target record; recovery_name text; target_table regclass;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('chat_user_id_idx', 'chat'),
    ('workspace_file_uploaded_by_idx', 'workspace_file')
  ) AS indexes(index_name, table_name) LOOP
    recovery_name := target.index_name || '_failed';
    target_table := to_regclass(target.table_name);
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(recovery_name)
        AND (indisvalid OR indrelid <> target_table)
    ) THEN
      RAISE EXCEPTION 'Refusing to drop unexpected recovery index %', recovery_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(target.index_name)
        AND indrelid = target_table AND NOT indisvalid
    ) THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', target.index_name, recovery_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "chat_user_id_idx_failed";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_user_id_idx" ON "chat" USING btree ("user_id");
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_file_uploaded_by_idx_failed";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_file_uploaded_by_idx" ON "workspace_file" USING btree ("uploaded_by");
--> statement-breakpoint
SET lock_timeout = '5s';
