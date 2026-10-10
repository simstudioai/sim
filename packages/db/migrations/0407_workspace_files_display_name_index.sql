-- A name reference that misses the exact-name lookup read every live file in its workspace, and
-- a workflow's new-file existence check always misses, so a large workspace paid a full read per
-- file written. This index serves that fallback by displayed name. It is partial on live
-- workspace files, a small slice of the table, so the build writes little WAL.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_workspace_display_name_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_workspace_display_name_idx" ON "workspace_files" USING btree ("workspace_id",regexp_replace(regexp_replace(regexp_replace(normalize("original_name", NFC), '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), '[\x01-\x1f\x7f]', '', 'g'), '[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')) WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
