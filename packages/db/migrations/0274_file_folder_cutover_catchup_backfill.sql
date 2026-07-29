-- Catch-up backfill: file folders created AFTER migration 0272 ran.
--
-- 0272 seeded `folder` with `resource_type = 'file'` from `workspace_file_folders`, but its
-- backfill is guarded by `WHERE NOT EXISTS (SELECT 1 FROM folder WHERE resource_type = 'file')`
-- so it fires exactly once. Every file folder created between that migration and the cutover
-- in this PR was therefore written to `workspace_file_folders` only, and exists nowhere in
-- `folder`.
--
-- The cutover repoints all reads and writes at `folder`. Without this statement those folders
-- disappear from the Files page on deploy, and the files inside them become unreachable —
-- their `folder_id` would point at a row nothing reads any more.
--
-- Safe to run repeatedly and safe to run while the old code is still serving: it only INSERTs
-- rows that are missing, keyed by the source id (0272 preserved ids, so a folder is the same
-- row in both tables). Parents and children go in one statement, so the self-referencing FK —
-- checked as an AFTER-ROW trigger at end of statement — is satisfied regardless of row order.
--
-- Name collisions cannot occur: every row comes from `workspace_file_folders`, whose own
-- active-unique index enforces exactly the uniqueness `folder`'s partial index requires, and
-- nothing other than these backfills ever writes `resource_type = 'file'`. The bare
-- ON CONFLICT DO NOTHING is belt-and-braces for a concurrent re-run.
INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
SELECT
	f.id, 'file', f.name,
	f.user_id, f.workspace_id, f.parent_id, false, f.sort_order,
	f.created_at, f.updated_at, f.deleted_at
FROM "workspace_file_folders" f
WHERE NOT EXISTS (
	SELECT 1 FROM "folder" existing WHERE existing.id = f.id
)
ON CONFLICT DO NOTHING;
