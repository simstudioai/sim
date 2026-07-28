CREATE TYPE "public"."folder_resource_type" AS ENUM('workflow', 'file', 'knowledge_base', 'table');--> statement-breakpoint
CREATE TABLE "folder" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_type" "folder_resource_type" NOT NULL,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_id" text,
	"locked" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pinned_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"pinned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Drops the FK's old target only; no replacement is added here. This strictly loosens the
-- column (removes a check, adds none), so it cannot reject a write that used to succeed.
-- Adding a `folder`-targeted FK in this same migration would reject a still-running
-- old-code pod writing a workflow_folder-only id. That FK is deferred to a contract
-- migration once old code has drained; see the contract-pending marker on
-- workflow.folderId in schema.ts. The invariant is enforced in the application layer
-- on both the old and new code paths meanwhile.
-- migration-safe: strictly loosens the column, no cross-deploy write can be rejected by removing this constraint; see contract-pending marker on workflow.folderId in schema.ts
ALTER TABLE "workflow" DROP CONSTRAINT "workflow_folder_id_workflow_folder_id_fk";
--> statement-breakpoint
-- Same reasoning as the workflow.folder_id drop above.
-- migration-safe: strictly loosens the column, no cross-deploy write can be rejected by removing this constraint; see contract-pending marker on workspaceFiles.folderId in schema.ts
ALTER TABLE "workspace_files" DROP CONSTRAINT "workspace_files_folder_id_workspace_file_folders_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_item" ADD CONSTRAINT "pinned_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_item" ADD CONSTRAINT "pinned_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_user_idx" ON "folder" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "folder_workspace_resource_parent_idx" ON "folder" USING btree ("workspace_id","resource_type","parent_id");--> statement-breakpoint
CREATE INDEX "folder_parent_sort_idx" ON "folder" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "folder_deleted_at_idx" ON "folder" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "folder_workspace_deleted_partial_idx" ON "folder" USING btree ("workspace_id","deleted_at") WHERE "folder"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "folder_workspace_resource_parent_name_active_unique" ON "folder" USING btree ("workspace_id","resource_type",coalesce("parent_id", ''),"name") WHERE "folder"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pinned_item_user_workspace_idx" ON "pinned_item" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "pinned_item_resource_idx" ON "pinned_item" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pinned_item_user_resource_unique" ON "pinned_item" USING btree ("user_id","resource_type","resource_id");--> statement-breakpoint
-- A folder may only be parented by a folder of the same resourceType in the same
-- workspace. Neither invariant is expressible as a plain FK, so it is enforced here as
-- defense-in-depth behind the application-layer check. BEFORE INSERT OR UPDATE covers the
-- child side; a parent's own resource_type/workspace_id never change after creation, so
-- there is no re-validation path needed on the parent side.
--
-- The `IS NOT NULL` guards also make the backfill below order-independent: a child row
-- whose parent has not been inserted yet finds no parent row, and passes rather than
-- raising. The real referential check is the FK, which Postgres evaluates as an
-- AFTER-ROW trigger at end of statement, once every row is present.
CREATE FUNCTION "folder_parent_resource_type_match"() RETURNS trigger AS $$
DECLARE
	parent_resource_type "folder_resource_type";
	parent_workspace_id text;
BEGIN
	IF NEW.parent_id IS NOT NULL THEN
		SELECT resource_type, workspace_id INTO parent_resource_type, parent_workspace_id
		FROM "folder" WHERE id = NEW.parent_id;
		IF parent_resource_type IS NOT NULL AND parent_resource_type <> NEW.resource_type THEN
			RAISE EXCEPTION 'folder.parent_id % has resource_type % but row has resource_type %',
				NEW.parent_id, parent_resource_type, NEW.resource_type;
		END IF;
		IF parent_workspace_id IS NOT NULL AND parent_workspace_id <> NEW.workspace_id THEN
			RAISE EXCEPTION 'folder.parent_id % has workspace_id % but row has workspace_id %',
				NEW.parent_id, parent_workspace_id, NEW.workspace_id;
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "folder_parent_resource_type_match"
BEFORE INSERT OR UPDATE ON "folder"
FOR EACH ROW EXECUTE FUNCTION "folder_parent_resource_type_match"();
--> statement-breakpoint
-- Backfill: copy existing workflow folders into the generic table, preserving `id` verbatim
-- so every workflow.folder_id reference keeps resolving without being rewritten.
-- `color`/`is_expanded` are intentionally dropped (see schema.ts).
--
-- `workflow_folder` has no (workspace_id, parent_id, name) uniqueness constraint today but
-- the generic table does, so active duplicates must be deduplicated at backfill time or the
-- INSERT aborts on a unique violation.
--
-- The rename picks the first *unused* suffix rather than blindly using the row number. The
-- app's own dedup already produces "New folder (1)", "New folder (2)", ..., so a naive
-- `name || ' (' || rn || ')'` can regenerate a name that already exists in the same parent
-- and abort the migration. `candidate` below enumerates suffixes, discards any whose
-- resulting name is already taken by an active sibling, and hands the k-th survivor to the
-- k-th duplicate — so generated names collide neither with existing rows nor each other.
--
-- Only active rows are deduplicated: the unique index is partial (WHERE deleted_at IS NULL),
-- so archived rows are exempt and keep their original names.
--
-- ON CONFLICT (id) DO NOTHING makes this statement re-runnable, which is what allows a
-- catch-up pass after the deploy has drained to adopt any folder an old-code pod created
-- while the rollout was still in flight.
INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
WITH active AS (
	SELECT id, workspace_id, coalesce(parent_id, '') AS scope, name, created_at
	FROM "workflow_folder"
	WHERE archived_at IS NULL
), ranked AS (
	SELECT id, workspace_id, scope, name,
		ROW_NUMBER() OVER (PARTITION BY workspace_id, scope, name ORDER BY created_at, id) AS rn
	FROM active
), renamed AS (
	SELECT d.id, (
		SELECT d.name || ' (' || candidate.n || ')'
		FROM generate_series(1, 10000) AS candidate(n)
		WHERE NOT EXISTS (
			SELECT 1 FROM active a
			WHERE a.workspace_id = d.workspace_id
				AND a.scope = d.scope
				AND a.name = d.name || ' (' || candidate.n || ')'
		)
		ORDER BY candidate.n
		OFFSET (d.rn - 2)
		LIMIT 1
	) AS new_name
	FROM ranked d
	WHERE d.rn > 1
)
SELECT
	f.id, 'workflow', coalesce(r.new_name, f.name),
	f.user_id, f.workspace_id, f.parent_id, f.locked, f.sort_order,
	f.created_at, f.updated_at, f.archived_at
FROM "workflow_folder" f
LEFT JOIN renamed r ON r.id = f.id
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Backfill: same for file folders. `workspace_file_folders` has no `locked` column, so file
-- folders start unlocked — locking is a workflow-folder feature and is not extended here.
--
-- `workspace_file_folders_workspace_parent_name_active_unique` already enforces the same
-- uniqueness this table requires, so active duplicates cannot exist. The identical dedup is
-- applied anyway: it is a no-op against clean data and costs one join, and it keeps this
-- statement correct if that constraint is ever relaxed.
INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
WITH active AS (
	SELECT id, workspace_id, coalesce(parent_id, '') AS scope, name, created_at
	FROM "workspace_file_folders"
	WHERE deleted_at IS NULL
), ranked AS (
	SELECT id, workspace_id, scope, name,
		ROW_NUMBER() OVER (PARTITION BY workspace_id, scope, name ORDER BY created_at, id) AS rn
	FROM active
), renamed AS (
	SELECT d.id, (
		SELECT d.name || ' (' || candidate.n || ')'
		FROM generate_series(1, 10000) AS candidate(n)
		WHERE NOT EXISTS (
			SELECT 1 FROM active a
			WHERE a.workspace_id = d.workspace_id
				AND a.scope = d.scope
				AND a.name = d.name || ' (' || candidate.n || ')'
		)
		ORDER BY candidate.n
		OFFSET (d.rn - 2)
		LIMIT 1
	) AS new_name
	FROM ranked d
	WHERE d.rn > 1
)
SELECT
	f.id, 'file', coalesce(r.new_name, f.name),
	f.user_id, f.workspace_id, f.parent_id, false, f.sort_order,
	f.created_at, f.updated_at, f.deleted_at
FROM "workspace_file_folders" f
LEFT JOIN renamed r ON r.id = f.id
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- The self-referencing parent FK is added AFTER the backfills above, not before.
-- Postgres checks non-deferrable FKs as AFTER-ROW triggers at end of statement, so a
-- single INSERT...SELECT carrying children and parents in arbitrary order would in fact
-- satisfy it — but creating the constraint here removes any dependence on that subtlety,
-- costs nothing on a table this size, and makes the backfill obviously correct on review.
ALTER TABLE "folder" ADD CONSTRAINT "folder_parent_id_folder_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- knowledge_base.folder_id / user_table_definitions.folder_id were added earlier in this
-- migration and are all-NULL, and no deployed code reads or writes them yet — so adding
-- their FK here (unlike the workflow/workspace_files drops above) carries no cross-deploy
-- write-compatibility risk. NOT VALID + an immediate VALIDATE avoids the full-table lock a
-- plain ADD CONSTRAINT takes; validating an all-NULL column is instant either way, but this
-- matches the established pattern (see migrations/0243_kb_workspace_cascade.sql).
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "knowledge_base" VALIDATE CONSTRAINT "knowledge_base_folder_id_folder_id_fk";--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD CONSTRAINT "user_table_definitions_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "user_table_definitions" VALIDATE CONSTRAINT "user_table_definitions_folder_id_folder_id_fk";--> statement-breakpoint
-- knowledge_base and user_table_definitions are existing, populated tables: build their new
-- indexes CONCURRENTLY so the build never takes ACCESS EXCLUSIVE on a live relation (runner
-- convention; see packages/db/scripts/migrate.ts). CONCURRENTLY cannot run inside a
-- transaction, so this must be the final statement group — everything below the COMMIT runs
-- outside the migration transaction.
--
-- `folder` and `pinned_item` are created empty in this same migration, so their indexes
-- above are built non-concurrently: there is no live traffic to lock out.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kb_folder_id_idx" ON "knowledge_base" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_table_def_folder_id_idx" ON "user_table_definitions" USING btree ("folder_id");--> statement-breakpoint
SET lock_timeout = '5s';
