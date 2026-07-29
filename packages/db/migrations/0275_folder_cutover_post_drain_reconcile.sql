-- Post-drain reconcile for the generic-folder cutover, covering BOTH legacy trees.
--
-- 0272 mirrored `workflow_folder` and `workspace_file_folders` into `folder`, and 0274
-- reconciled the file tree. Both ran while the previous app version was still serving. During
-- the blue/green rolling window the old pods keep writing the LEGACY tables exclusively while
-- the new pods write `folder` exclusively, so every folder an old pod created between the
-- migration and its own termination exists only in the legacy table and is invisible to the
-- new code. 0274 anticipated this and asked to be run again once the deploy drained; a
-- journaled migration never replays, so that re-run has to be its own file. This is it.
--
-- Production measurement at 2026-07-29T06:40Z, mid-drain: exactly 1 stranded row
-- (`workflow_folder`, archived, no parent, no workflows inside) and 0 on the file side, with 0
-- name collisions and 0 absent parents on both trees. The count at execution time may be
-- higher, since old pods were still serving when that was taken.
--
-- INSERT-ONLY, NOT A MIRROR. 0274 could upsert every column because file folders can never
-- diverge in name — `workspace_file_folders` enforces the same active-unique key `folder`
-- does. That does NOT hold here: 0272's dedup renamed 47 workflow folders across 35 collision
-- groups, so `folder` is deliberately different from `workflow_folder` for those rows. An
-- upsert would revert all 47 to their colliding names and violate
-- `folder_workspace_resource_parent_name_active_unique` in the process. Only ids absent from
-- `folder` are touched; every row already mirrored is left exactly as it is.
--
-- Names are deduplicated against the FIRST FREE suffix rather than a row number, because the
-- target name may already be taken by a row this block is not inserting. Only ACTIVE rows are
-- deduplicated — the partial unique index ignores soft-deleted rows, so an archived folder
-- keeps its original name and reappears under it if restored.
--
-- Rows are inserted in depth order so a parent always lands before its children: the
-- self-referencing FK `folder_parent_id_folder_id_fk` is checked immediately, and the
-- `folder_parent_resource_type_match` trigger reads the parent row. A child inserted before
-- its parent would fail both.
--
-- RUN THIS BEFORE THE SOFT-DELETE CLEANUP JOB PURGES EXPIRED `folder` ROWS. Cleanup
-- hard-deletes from `folder` but never from the legacy tables, so a run that lands after a
-- purge reinstates every purged folder as a soft-deleted phantom in Recently Deleted whose
-- files and workflows are already gone. The retention window is far longer than any drain, so
-- running promptly after the deploy is sufficient — but this is the one ordering constraint
-- that makes the file dangerous rather than merely redundant if deferred indefinitely.
--
-- Idempotent and a clean no-op once reconciled: the driving queries select only ids missing
-- from `folder`, so a second execution finds nothing and the `ON CONFLICT (id) DO NOTHING`
-- guards against a concurrent writer inserting the same id between the SELECT and the INSERT.

-- Wrapped in a DO block for the same reason 0274 is: 0272 ends with an embedded COMMIT for its
-- trailing CONCURRENTLY index builds, so files after it are not guaranteed to run inside
-- drizzle's batch transaction. Both trees must land together or not at all.
DO $$
DECLARE
	rec RECORD;
	candidate TEXT;
	suffix INT;
BEGIN
	-- Workflow tree. `archived_at` is this table's soft-delete column; `folder` calls it
	-- `deleted_at`. Depth is computed over the SOURCE table so a stranded child of a stranded
	-- parent still orders correctly.
	FOR rec IN
		WITH RECURSIVE tree AS (
			SELECT s.id, 0 AS depth
			FROM "workflow_folder" s
			WHERE s."parent_id" IS NULL
			UNION ALL
			SELECT s.id, t.depth + 1
			FROM "workflow_folder" s
			JOIN tree t ON t.id = s."parent_id"
		)
		SELECT s."id", s."name", s."user_id", s."workspace_id", s."parent_id",
			s."sort_order", s."created_at", s."updated_at", s."archived_at" AS deleted_at
		FROM "workflow_folder" s
		JOIN tree t ON t.id = s."id"
		WHERE NOT EXISTS (SELECT 1 FROM "folder" f WHERE f."id" = s."id")
		ORDER BY t.depth, s."created_at"
	LOOP
		candidate := rec."name";
		IF rec.deleted_at IS NULL THEN
			suffix := 1;
			WHILE EXISTS (
				SELECT 1 FROM "folder" f
				WHERE f."workspace_id" = rec."workspace_id"
					AND f."resource_type" = 'workflow'
					AND coalesce(f."parent_id", '') = coalesce(rec."parent_id", '')
					AND f."name" = candidate
					AND f."deleted_at" IS NULL
			) LOOP
				suffix := suffix + 1;
				candidate := rec."name" || ' (' || suffix || ')';
			END LOOP;
		END IF;

		INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
		VALUES (rec."id", 'workflow', candidate, rec."user_id", rec."workspace_id", rec."parent_id",
			false, rec."sort_order", rec."created_at", rec."updated_at", rec.deleted_at)
		ON CONFLICT (id) DO NOTHING;
	END LOOP;

	-- File tree. Same shape; this table already uses `deleted_at`. 0274 reconciled it fully, so
	-- this pass only picks up what old pods wrote after 0274 ran.
	FOR rec IN
		WITH RECURSIVE tree AS (
			SELECT s.id, 0 AS depth
			FROM "workspace_file_folders" s
			WHERE s."parent_id" IS NULL
			UNION ALL
			SELECT s.id, t.depth + 1
			FROM "workspace_file_folders" s
			JOIN tree t ON t.id = s."parent_id"
		)
		SELECT s."id", s."name", s."user_id", s."workspace_id", s."parent_id",
			s."sort_order", s."created_at", s."updated_at", s."deleted_at"
		FROM "workspace_file_folders" s
		JOIN tree t ON t.id = s."id"
		WHERE NOT EXISTS (SELECT 1 FROM "folder" f WHERE f."id" = s."id")
		ORDER BY t.depth, s."created_at"
	LOOP
		candidate := rec."name";
		IF rec."deleted_at" IS NULL THEN
			suffix := 1;
			WHILE EXISTS (
				SELECT 1 FROM "folder" f
				WHERE f."workspace_id" = rec."workspace_id"
					AND f."resource_type" = 'file'
					AND coalesce(f."parent_id", '') = coalesce(rec."parent_id", '')
					AND f."name" = candidate
					AND f."deleted_at" IS NULL
			) LOOP
				suffix := suffix + 1;
				candidate := rec."name" || ' (' || suffix || ')';
			END LOOP;
		END IF;

		INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
		VALUES (rec."id", 'file', candidate, rec."user_id", rec."workspace_id", rec."parent_id",
			false, rec."sort_order", rec."created_at", rec."updated_at", rec."deleted_at")
		ON CONFLICT (id) DO NOTHING;
	END LOOP;
END $$;
