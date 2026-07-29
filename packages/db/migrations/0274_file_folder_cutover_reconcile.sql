-- Reconcile `folder` (resource_type = 'file') with `workspace_file_folders` before the cutover.
--
-- 0272 seeded `folder` from `workspace_file_folders`, but its backfill is guarded by
-- `WHERE NOT EXISTS (SELECT 1 FROM folder WHERE resource_type = 'file')`, so it fires exactly
-- once — and nothing has written those rows since. The deployed manager reads and writes
-- `workspace_file_folders` EXCLUSIVELY. So `folder`'s file rows are frozen at the 0272
-- snapshot while every rename, move, delete, and restore since then lives only in the legacy
-- table.
--
-- The cutover in this PR repoints every read at `folder`. Without this migration:
--   * folders created after 0272 do not exist there at all — they vanish from the Files page
--     and their contents become unreachable;
--   * folders renamed or moved after 0272 revert to their old name and parent;
--   * folders deleted after 0272 reappear as active phantoms;
--   * a stale-active row can hold the name a newer folder legitimately took, so a plain
--     INSERT collides on `folder_workspace_resource_parent_name_active_unique`.
--
-- `workspace_file_folders` is authoritative and ids were preserved, so this makes `folder` a
-- faithful mirror of it rather than a partial catch-up.
--
-- IMPORTANT — run this AGAIN once the deploy has fully drained. Old pods keep writing the
-- legacy table until they are gone, so anything they write during the rolling window lands
-- after this runs. The block is idempotent and safe to repeat; a journaled migration does not
-- replay, so the post-drain pass is an operational step, not an automatic one.
--
-- One precondition on that re-run: do it BEFORE the soft-delete cleanup job has had a chance to
-- purge expired `folder` rows. Cleanup hard-deletes from `folder` but never from
-- `workspace_file_folders`, so re-running afterwards would reinstate every purged file folder as
-- a soft-deleted phantom in Recently Deleted whose files are already gone. The retention window
-- is far longer than any drain, so running the re-run promptly after the deploy is sufficient.
--
-- Where 0272 has not yet run, it and this file apply back to back and this becomes a no-op
-- reconcile over the rows 0272 just wrote.
--
-- Validated with a read-only dry run that materialises the full post-0272 `folder` table from
-- both source tables and asserts every constraint the table declares: no NULL names or NULL
-- required columns, no primary-key collisions between the two source tables, no
-- `folder_workspace_resource_parent_name_active_unique` violations, no resource-type or
-- workspace violations of `folder_parent_resource_type_match`, and no parent/user/workspace FK
-- violations, with every foldered file and workflow keeping a resolvable folder id.
--
-- 0272's dedup renames only workflow folders, never file folders: `workspace_file_folders`
-- enforces the same active-unique key this table does, so no file folder can arrive duplicated.
-- That is what lets pass 2 below write raw names.

-- Wrapped in a DO block so the two passes are ONE statement and therefore atomic on their own.
-- 0272 ends with an embedded COMMIT (its trailing CONCURRENTLY index builds cannot run inside a
-- transaction), so this file is not guaranteed to run inside drizzle's batch transaction. A
-- bare two-statement form could commit the parking pass and then fail the reconcile, leaving
-- every mirrored folder holding a placeholder name.
DO $$
BEGIN
	-- Pass 1: park every mirrored name out of the way. The partial unique index covers only
	-- active rows, and `'__0274_tmp__' || id` is unique by construction, so after this no
	-- pre-existing mirrored row can collide with the true state written below. Rows in `folder`
	-- with no source row are left untouched by the join — at cutover time none can exist, since
	-- nothing but 0272 has ever written `resource_type = 'file'`.
	UPDATE "folder" f
	SET "name" = '__0274_tmp__' || f."id"
	FROM "workspace_file_folders" w
	WHERE f."id" = w."id"
		AND f."resource_type" = 'file'
		AND f."deleted_at" IS NULL;

	-- Pass 2: insert what is missing and reconcile what diverged, in one statement so parents
	-- and children land together — the self-referencing FK is checked as an AFTER-ROW trigger at
	-- end of statement, and `folder_parent_resource_type_match` reads NULL for a parent inserted
	-- later in the same statement and so does not fire.
	--
	-- The conflict target is `(id)` DELIBERATELY, not the bare form: ids are the mirror key and
	-- must reconcile, whereas a NAME collision here would mean `workspace_file_folders` itself
	-- violated its own active-unique index. That must fail loudly rather than silently discard a
	-- folder — the bare `ON CONFLICT DO NOTHING` would swallow it and strand every file inside.
	INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
	SELECT
		f.id, 'file', f.name,
		f.user_id, f.workspace_id, f.parent_id, false, f.sort_order,
		f.created_at, f.updated_at, f.deleted_at
	FROM "workspace_file_folders" f
	ON CONFLICT (id) DO UPDATE SET
		"name" = EXCLUDED."name",
		"parent_id" = EXCLUDED."parent_id",
		"sort_order" = EXCLUDED."sort_order",
		"updated_at" = EXCLUDED."updated_at",
		"deleted_at" = EXCLUDED."deleted_at";
END $$;
