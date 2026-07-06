-- workspace_files is an existing table: build the new partial unique index CONCURRENTLY
-- so the build never write-locks the relation (runner convention — plain CREATE INDEX
-- takes ACCESS EXCLUSIVE). A pre-existing duplicate (chat_id, display_name) output pair
-- (an artifact of the pre-index allocation race) fails the build and leaves an INVALID
-- index that migrate.ts surfaces with a WARN — dedupe the rows, drop the invalid index,
-- and re-run.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_chat_output_display_name_unique" ON "workspace_files" USING btree ("chat_id","display_name") WHERE "workspace_files"."context" = 'output' AND "workspace_files"."chat_id" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
