-- Contract migration for the generic-folders cutover: adopt the deferred `folder_id` foreign
-- keys and drop the two legacy folder tables.
--
-- Ordering is deliberate and each step depends on the one before it:
--   1. final insert-only reconcile, so no legacy folder is lost by the DROP — with one
--      inherent exception: a legacy id already present in `folder` under a DIFFERENT
--      resource_type cannot be inserted (the primary key is taken) and is dropped. That needs
--      an id collision across two tables whose ids were preserved from disjoint sources, so it
--      is not reachable in practice;
--   2. re-root any `folder_id` that still does not resolve, so the FK can be validated;
--   3. adopt the FKs the expand migration deliberately left off;
--   4. drop the legacy tables.
--
-- Preconditions verified read-only against production before writing this file: 0 stranded
-- rows in either tree, 0 unresolvable `folder_id`s, 0 active rows filed under a soft-deleted
-- folder, and a FULL-ROW comparison (name, parent, deleted/archived state, workspace, user,
-- sort order, locked) clean on both trees. The only divergence is 47 workflow-folder names, all
-- matching `<old name> (N)` — 0272's deliberate dedup renames. That is precisely why step 1 is
-- INSERT-ONLY: an upsert would revert all 47.
--
-- In production steps 1 and 2 are therefore no-ops. They exist for deployments that never ran
-- the post-drain reconcile as an operational step — self-hosted upgrades above all, where a
-- rolling restart can strand a folder exactly the same way and no operator is watching for it.
-- This is the last moment the legacy rows exist, so it is the last chance to rescue them.
--
-- NAME DEDUPLICATION appears at four sites below and follows one pattern throughout, because
-- three separate partial unique indexes are in play and every one of them keys on a coalesced
-- nullable column, so re-rooting a row moves it into a namespace where its name may be taken:
--   * folder            (workspace_id, resource_type, coalesce(parent_id,''), name) WHERE deleted_at IS NULL
--   * workflow          (workspace_id, coalesce(folder_id,''), name)                WHERE archived_at IS NULL
--   * workspace_files   (workspace_id, coalesce(folder_id,''), original_name)       WHERE deleted_at IS NULL AND context='workspace' AND workspace_id IS NOT NULL
-- The pattern: rank contenders within the batch (`rn`), ask whether an already-present row
-- holds the base name (`base_taken`), derive a `slot` into the free-suffix sequence, and probe
-- for the first free `" (N)"` — where "free" must consider BOTH the rows already in the table
-- AND the base names this batch is about to claim (`kept`). Probing only the table is the
-- subtle failure: a stranded row legitimately named `Docs (1)` is invisible to the probe run
-- for a stranded `Docs`, so both would be assigned `Docs (1)` and the statement aborts.
-- Suffixes start at (1). Inactive rows are never renamed — the indexes are partial.

-- Step 1 — final reconcile. Guarded on table existence so a replay after the DROP is a no-op
-- rather than an error, and written as DO blocks so each tree is a single atomic statement
-- (0272 ends with an embedded COMMIT, so this file is not guaranteed to run inside drizzle's
-- batch transaction).
DO $$
BEGIN
	IF to_regclass('public.workflow_folder') IS NULL THEN
		RETURN;
	END IF;

	INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
	-- Keyed on `id` ALONE, matching the primary key it protects. Narrowing it by resource_type
	-- would classify an id already present under a DIFFERENT type as stranded; the ON CONFLICT
	-- below would then silently skip it rather than rescue it, so keeping the guard aligned with
	-- the constraint is what makes the two agree.
	WITH stranded AS (
		SELECT l.id, l.name, l.user_id, l.workspace_id, l.parent_id, l.locked, l.sort_order,
			l.created_at, l.updated_at, l.archived_at AS deleted_at
		FROM "workflow_folder" l
		WHERE NOT EXISTS (SELECT 1 FROM "folder" f WHERE f.id = l.id)
	),
	-- A parent is only usable if it will exist, shares this row's workspace, and leaves the row
	-- REACHABLE. The workspace match is enforced by the `folder_parent_resource_type_match`
	-- trigger and was never enforced by the legacy self-FK, so a cross-workspace parent is
	-- representable in the source data. Reachability is the subtler half: filing an ACTIVE
	-- folder under a soft-deleted parent hides it in Recently Deleted just as thoroughly as a
	-- dangling parent would, so it re-roots too — matching `resolveRestoredFolderId`, which
	-- re-roots a restored folder whose original parent is archived.
	--
	-- A soft-deleted row is exempt: it MAY keep a soft-deleted parent, because that is the
	-- normal shape of an archived subtree and flattening it would destroy the hierarchy a
	-- later restore rebuilds.
	--
	-- Anything else re-roots to the workspace root: losing one level of nesting beats losing the
	-- folder and stranding every workflow inside it.
	--
	-- LIMITATION: this is a per-row check, so a CYCLE among stranded rows (a→b→a) survives it —
	-- every row's parent exists, is same-workspace, and is active. Such rows land in `folder`
	-- unreachable from the root. 0272's backfill has the identical hole, so this is not a
	-- regression, and the client tolerates it (`getFolderPath` and `subtree.ts` both carry cycle
	-- guards). Breaking cycles needs a recursive walk; it is deliberately not done here.
	resolved AS (
		SELECT s.*,
			CASE
				WHEN s.parent_id IS NULL THEN NULL
				WHEN EXISTS (
					SELECT 1 FROM "folder" f
					WHERE f.id = s.parent_id AND f.resource_type = 'workflow' AND f.workspace_id = s.workspace_id
						AND (s.deleted_at IS NOT NULL OR f.deleted_at IS NULL)
				) THEN s.parent_id
				WHEN EXISTS (
					SELECT 1 FROM stranded s2
					WHERE s2.id = s.parent_id AND s2.workspace_id = s.workspace_id
						AND (s.deleted_at IS NOT NULL OR s2.deleted_at IS NULL)
				) THEN s.parent_id
				ELSE NULL
			END AS resolved_parent
		FROM stranded s
	),
	ranked AS (
		SELECT r.*,
			EXISTS (
				SELECT 1 FROM "folder" a
				WHERE a.workspace_id = r.workspace_id
					AND a.resource_type = 'workflow'
					AND coalesce(a.parent_id, '') = coalesce(r.resolved_parent, '')
					AND a.name = r.name
					AND a.deleted_at IS NULL
			) AS base_taken,
			row_number() OVER (
				PARTITION BY r.workspace_id, coalesce(r.resolved_parent, ''), r.name
				ORDER BY r.created_at, r.id
			) AS rn
		FROM resolved r
		WHERE r.deleted_at IS NULL
	),
	slotted AS (
		SELECT k.*, k.rn - 1 - (CASE WHEN k.base_taken THEN 0 ELSE 1 END) AS slot FROM ranked k
	),
	kept AS (
		SELECT s.workspace_id, s.resolved_parent, s.name FROM slotted s WHERE s.slot < 0
	),
	named AS (
		SELECT k.id,
			CASE
				WHEN k.slot < 0 THEN k.name
				ELSE coalesce(
					(
						SELECT k.name || ' (' || candidate.n || ')'
						FROM generate_series(1, 10000) AS candidate(n)
						WHERE NOT EXISTS (
							SELECT 1 FROM "folder" a
							WHERE a.workspace_id = k.workspace_id
								AND a.resource_type = 'workflow'
								AND coalesce(a.parent_id, '') = coalesce(k.resolved_parent, '')
								AND a.name = k.name || ' (' || candidate.n || ')'
								AND a.deleted_at IS NULL
						)
						AND NOT EXISTS (
							SELECT 1 FROM kept kp
							WHERE kp.workspace_id = k.workspace_id
								AND coalesce(kp.resolved_parent, '') = coalesce(k.resolved_parent, '')
								AND kp.name = k.name || ' (' || candidate.n || ')'
						)
						ORDER BY candidate.n
						OFFSET k.slot
						LIMIT 1
					),
					-- Suffix space exhausted. Fall back to the id, which is unique by
					-- construction, so the reconcile still completes and the row is traceable.
					-- Falling back to the base name would guarantee a collision and abort here
					-- with an error naming the base name, hiding the real cause.
					k.name || ' (' || k.id || ')'
				)
			END AS final_name
		FROM slotted k
	)
	SELECT r.id, 'workflow', coalesce(n.final_name, r.name),
		r.user_id, r.workspace_id, r.resolved_parent, r.locked, r.sort_order,
		r.created_at, r.updated_at, r.deleted_at
	FROM resolved r
	LEFT JOIN named n ON n.id = r.id
	-- Matches the `stranded` guard, which already means "no folder row with this id". Restating
	-- it as ON CONFLICT closes the gap between that read's snapshot and the index check: an
	-- operational re-run of 0274, or a live pod, committing into `folder` mid-statement would
	-- otherwise raise 23505 — and migrate.ts retries only 55P03, so that hard-fails the deploy.
	ON CONFLICT (id) DO NOTHING;
END $$;
--> statement-breakpoint

DO $$
BEGIN
	IF to_regclass('public.workspace_file_folders') IS NULL THEN
		RETURN;
	END IF;

	INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
	WITH stranded AS (
		SELECT l.id, l.name, l.user_id, l.workspace_id, l.parent_id, l.sort_order,
			l.created_at, l.updated_at, l.deleted_at
		FROM "workspace_file_folders" l
		WHERE NOT EXISTS (SELECT 1 FROM "folder" f WHERE f.id = l.id)
	),
	-- Same reachability rule as the workflow tree above.
	resolved AS (
		SELECT s.*,
			CASE
				WHEN s.parent_id IS NULL THEN NULL
				WHEN EXISTS (
					SELECT 1 FROM "folder" f
					WHERE f.id = s.parent_id AND f.resource_type = 'file' AND f.workspace_id = s.workspace_id
						AND (s.deleted_at IS NOT NULL OR f.deleted_at IS NULL)
				) THEN s.parent_id
				WHEN EXISTS (
					SELECT 1 FROM stranded s2
					WHERE s2.id = s.parent_id AND s2.workspace_id = s.workspace_id
						AND (s.deleted_at IS NOT NULL OR s2.deleted_at IS NULL)
				) THEN s.parent_id
				ELSE NULL
			END AS resolved_parent
		FROM stranded s
	),
	ranked AS (
		SELECT r.*,
			EXISTS (
				SELECT 1 FROM "folder" a
				WHERE a.workspace_id = r.workspace_id
					AND a.resource_type = 'file'
					AND coalesce(a.parent_id, '') = coalesce(r.resolved_parent, '')
					AND a.name = r.name
					AND a.deleted_at IS NULL
			) AS base_taken,
			row_number() OVER (
				PARTITION BY r.workspace_id, coalesce(r.resolved_parent, ''), r.name
				ORDER BY r.created_at, r.id
			) AS rn
		FROM resolved r
		WHERE r.deleted_at IS NULL
	),
	slotted AS (
		SELECT k.*, k.rn - 1 - (CASE WHEN k.base_taken THEN 0 ELSE 1 END) AS slot FROM ranked k
	),
	kept AS (
		SELECT s.workspace_id, s.resolved_parent, s.name FROM slotted s WHERE s.slot < 0
	),
	named AS (
		SELECT k.id,
			CASE
				WHEN k.slot < 0 THEN k.name
				ELSE coalesce(
					(
						SELECT k.name || ' (' || candidate.n || ')'
						FROM generate_series(1, 10000) AS candidate(n)
						WHERE NOT EXISTS (
							SELECT 1 FROM "folder" a
							WHERE a.workspace_id = k.workspace_id
								AND a.resource_type = 'file'
								AND coalesce(a.parent_id, '') = coalesce(k.resolved_parent, '')
								AND a.name = k.name || ' (' || candidate.n || ')'
								AND a.deleted_at IS NULL
						)
						AND NOT EXISTS (
							SELECT 1 FROM kept kp
							WHERE kp.workspace_id = k.workspace_id
								AND coalesce(kp.resolved_parent, '') = coalesce(k.resolved_parent, '')
								AND kp.name = k.name || ' (' || candidate.n || ')'
						)
						ORDER BY candidate.n
						OFFSET k.slot
						LIMIT 1
					),
					k.name || ' (' || k.id || ')'
				)
			END AS final_name
		FROM slotted k
	)
	SELECT r.id, 'file', coalesce(n.final_name, r.name),
		r.user_id, r.workspace_id, r.resolved_parent, false, r.sort_order,
		r.created_at, r.updated_at, r.deleted_at
	FROM resolved r
	LEFT JOIN named n ON n.id = r.id
	-- Same rationale as the workflow tree above.
	ON CONFLICT (id) DO NOTHING;
END $$;
--> statement-breakpoint

-- Step 2 — a `folder_id` can only still dangle if its folder is absent from BOTH tables, which
-- step 1 cannot rescue. Re-root it so the resource stays reachable at the workspace root
-- instead of blocking validation, and rename on collision for the same reason step 1 does: the
-- root namespace is covered by a partial unique index, and two same-named rows re-rooted out of
-- two different vanished folders would abort the migration. A dangling row is already
-- unreachable in the UI (filed under a folder that does not exist), so surfacing it at the root
-- under a suffixed name strictly improves on leaving it invisible.
DO $$
BEGIN
	-- `workspace_id IS NOT NULL` is load-bearing, not defensive. `workflow.workspace_id` is
	-- nullable (personal workflows), and NULL is treated as EQUAL by `PARTITION BY` but as
	-- UNKNOWN by the `=` in `base_taken`. Without this guard `rn` increments across every
	-- personal workflow while no collision is ever detected, so the dedup can ONLY fire
	-- spuriously — renaming a user-visible workflow that needed no rename, since the unique
	-- index treats NULL `workspace_id` rows as distinct anyway. The file block below has always
	-- carried the equivalent guard.
	WITH dangling AS (
		SELECT w.id, w.workspace_id, w.name,
			(w.archived_at IS NULL AND w.workspace_id IS NOT NULL) AS is_active
		FROM "workflow" w
		WHERE w."folder_id" IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM "folder" f WHERE f.id = w."folder_id")
	),
	ranked AS (
		SELECT d.*,
			EXISTS (
				SELECT 1 FROM "workflow" r
				WHERE r.workspace_id = d.workspace_id
					AND r."folder_id" IS NULL
					AND r.archived_at IS NULL
					AND r.name = d.name
			) AS base_taken,
			row_number() OVER (PARTITION BY d.workspace_id, d.name ORDER BY d.id) AS rn
		FROM dangling d
		WHERE d.is_active
	),
	slotted AS (
		SELECT k.*, k.rn - 1 - (CASE WHEN k.base_taken THEN 0 ELSE 1 END) AS slot FROM ranked k
	),
	kept AS (
		SELECT s.workspace_id, s.name FROM slotted s WHERE s.slot < 0
	),
	named AS (
		SELECT k.id,
			CASE
				WHEN k.slot < 0 THEN k.name
				ELSE coalesce(
					(
						SELECT k.name || ' (' || candidate.n || ')'
						FROM generate_series(1, 10000) AS candidate(n)
						WHERE NOT EXISTS (
							SELECT 1 FROM "workflow" r
							WHERE r.workspace_id = k.workspace_id
								AND r."folder_id" IS NULL
								AND r.archived_at IS NULL
								AND r.name = k.name || ' (' || candidate.n || ')'
						)
						AND NOT EXISTS (
							SELECT 1 FROM kept kp
							WHERE kp.workspace_id = k.workspace_id
								AND kp.name = k.name || ' (' || candidate.n || ')'
						)
						ORDER BY candidate.n
						OFFSET k.slot
						LIMIT 1
					),
					k.name || ' (' || k.id || ')'
				)
			END AS final_name
		FROM slotted k
	)
	UPDATE "workflow" w
	SET "folder_id" = NULL, "name" = coalesce(n.final_name, w.name)
	FROM dangling d
	LEFT JOIN named n ON n.id = d.id
	WHERE w.id = d.id;
END $$;
--> statement-breakpoint

DO $$
BEGIN
	WITH dangling AS (
		SELECT wf.id, wf.workspace_id, wf.original_name,
			(wf.deleted_at IS NULL AND wf.context = 'workspace' AND wf.workspace_id IS NOT NULL) AS is_active
		FROM "workspace_files" wf
		WHERE wf."folder_id" IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM "folder" f WHERE f.id = wf."folder_id")
	),
	ranked AS (
		SELECT d.*,
			EXISTS (
				SELECT 1 FROM "workspace_files" r
				WHERE r.workspace_id = d.workspace_id
					AND r."folder_id" IS NULL
					AND r.deleted_at IS NULL
					AND r.context = 'workspace'
					AND r.original_name = d.original_name
			) AS base_taken,
			row_number() OVER (PARTITION BY d.workspace_id, d.original_name ORDER BY d.id) AS rn
		FROM dangling d
		WHERE d.is_active
	),
	slotted AS (
		SELECT k.*, k.rn - 1 - (CASE WHEN k.base_taken THEN 0 ELSE 1 END) AS slot FROM ranked k
	),
	kept AS (
		SELECT s.workspace_id, s.original_name FROM slotted s WHERE s.slot < 0
	),
	named AS (
		SELECT k.id,
			CASE
				WHEN k.slot < 0 THEN k.original_name
				ELSE coalesce(
					(
						SELECT k.original_name || ' (' || candidate.n || ')'
						FROM generate_series(1, 10000) AS candidate(n)
						WHERE NOT EXISTS (
							SELECT 1 FROM "workspace_files" r
							WHERE r.workspace_id = k.workspace_id
								AND r."folder_id" IS NULL
								AND r.deleted_at IS NULL
								AND r.context = 'workspace'
								AND r.original_name = k.original_name || ' (' || candidate.n || ')'
						)
						AND NOT EXISTS (
							SELECT 1 FROM kept kp
							WHERE kp.workspace_id = k.workspace_id
								AND kp.original_name = k.original_name || ' (' || candidate.n || ')'
						)
						ORDER BY candidate.n
						OFFSET k.slot
						LIMIT 1
					),
					k.original_name || ' (' || k.id || ')'
				)
			END AS final_name
		FROM slotted k
	)
	UPDATE "workspace_files" wf
	SET "folder_id" = NULL, "original_name" = coalesce(n.final_name, wf.original_name)
	FROM dangling d
	LEFT JOIN named n ON n.id = d.id
	WHERE wf.id = d.id;
END $$;
--> statement-breakpoint

-- Step 3 — adopt the FKs 0272 deliberately left off. Added NOT VALID so the ACCESS EXCLUSIVE
-- lock covers only the catalog write, not a full scan: `workspace_files` is ~1.7M rows / 1.8GB
-- and an immediately-validated FK would block every read and write on it for the whole scan.
-- NOT VALID still enforces the constraint on all new writes; VALIDATE below takes only SHARE
-- UPDATE EXCLUSIVE and so runs concurrently with normal traffic.
DO $$
BEGIN
	ALTER TABLE "workflow"
		ADD CONSTRAINT "workflow_folder_id_folder_id_fk"
		FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE SET NULL NOT VALID;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$
BEGIN
	ALTER TABLE "workspace_files"
		ADD CONSTRAINT "workspace_files_folder_id_folder_id_fk"
		FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE SET NULL NOT VALID;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- The reconcile and the NOT VALID constraints must be durable before the scans below, which
-- deliberately run outside the surrounding transaction so they do not hold its locks.
COMMIT;
--> statement-breakpoint

ALTER TABLE "workflow" VALIDATE CONSTRAINT "workflow_folder_id_folder_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_files" VALIDATE CONSTRAINT "workspace_files_folder_id_folder_id_fk";
--> statement-breakpoint

-- Step 4 — drop the legacy tables. Named EXACTLY and never by pattern: `workflow_folder_sort_idx`
-- is an index on the LIVE `workflow` table, so anything globbing `workflow_folder*` would take
-- out a production index. Their own FKs and indexes go with them; nothing references either
-- table, so no CASCADE is needed and its absence is the safety check.
--
-- The cutover that stopped all reads and writes of these two tables shipped in EARLIER deploys
-- (#6037 / #6045), not in this PR. Production has since drained — last legacy write 06:27:21Z,
-- verified >10h earlier — and the full-row comparison described at the top of this file confirms
-- nothing is stranded. Step 1 rescues any straggler regardless.
-- migration-safe: reads/writes ceased in an earlier deploy; drained and full-row verified.
DROP TABLE IF EXISTS "workflow_folder";
--> statement-breakpoint
-- migration-safe: same cutover, same drain, same full-row verification as the drop above.
DROP TABLE IF EXISTS "workspace_file_folders";
