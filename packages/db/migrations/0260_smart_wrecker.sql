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
-- Drops the FK's old target only, no replacement added here — this strictly loosens
-- the column (removes a check, adds none), so it cannot reject any write that used to
-- succeed. Adding a `folder`-targeted FK in this same migration would reject a
-- still-running old-code pod (blue/green cutover) writing a workflow_folder-only id;
-- that FK is deferred to a follow-up migration once old code is fully drained
-- (contract-pending marker on workflow.folderId in schema.ts). App-layer validation
-- already independently enforces the invariant on both old and new code paths.
-- migration-safe: strictly loosens the column, no cross-deploy write can be rejected by removing this constraint; see contract-pending marker on workflow.folderId in schema.ts
ALTER TABLE "workflow" DROP CONSTRAINT "workflow_folder_id_workflow_folder_id_fk";
--> statement-breakpoint
-- Same reasoning as the workflow.folder_id drop above.
-- migration-safe: strictly loosens the column, no cross-deploy write can be rejected by removing this constraint; see contract-pending marker on workspaceFiles.folderId in schema.ts
ALTER TABLE "workspace_files" DROP CONSTRAINT "workspace_files_folder_id_workspace_file_folders_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_parent_id_folder_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_item" ADD CONSTRAINT "pinned_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_item" ADD CONSTRAINT "pinned_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_user_idx" ON "folder" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "folder_resource_type_idx" ON "folder" USING btree ("resource_type");--> statement-breakpoint
CREATE INDEX "folder_workspace_resource_parent_idx" ON "folder" USING btree ("workspace_id","resource_type","parent_id");--> statement-breakpoint
CREATE INDEX "folder_parent_sort_idx" ON "folder" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "folder_deleted_at_idx" ON "folder" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "folder_workspace_deleted_partial_idx" ON "folder" USING btree ("workspace_id","deleted_at") WHERE "folder"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "folder_workspace_resource_parent_name_active_unique" ON "folder" USING btree ("workspace_id","resource_type",coalesce("parent_id", ''),"name") WHERE "folder"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pinned_item_user_workspace_idx" ON "pinned_item" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "pinned_item_resource_idx" ON "pinned_item" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pinned_item_user_resource_unique" ON "pinned_item" USING btree ("user_id","resource_type","resource_id");--> statement-breakpoint
-- Defense-in-depth: reject a folder row whose parent belongs to a different resourceType.
-- Mirrored at the application layer by assertFolderParentValid() in apps/sim/lib/folders/orchestration.ts.
CREATE FUNCTION "folder_parent_resource_type_match"() RETURNS trigger AS $$
DECLARE
	parent_resource_type "folder_resource_type";
	parent_workspace_id text;
BEGIN
	IF NEW.parent_id IS NOT NULL THEN
		SELECT resource_type, workspace_id INTO parent_resource_type, parent_workspace_id FROM "folder" WHERE id = NEW.parent_id;
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
-- Backfill: copy existing workflow folders into the generic table, preserving id verbatim.
-- Source table also has color/is_expanded columns, but the generic `folder` table dropped
-- them (no UI consumer for color; is_expanded's real state lives client-side in the
-- folders Zustand store, never read from the DB), so they are intentionally not carried over.
--
-- `workflow_folder` has no uniqueness constraint on (workspace_id, parent_id, name) today,
-- but the new `folder` table does (folder_workspace_resource_parent_name_active_unique,
-- scoped to active rows). Production has genuine active duplicates (verified against
-- prod: 33 groups, mostly default "Folder 1"/"Folder 2" names) that would otherwise abort
-- this INSERT with a unique-violation. Deduplicate active rows at backfill time by
-- appending " (N)" per collision, ordered by created_at then id for determinism --
-- matching the "New folder (N)" convention this app's own create-folder dedup already
-- uses, so a renamed row reads as expected in the UI. Archived rows are exempt from the
-- constraint (WHERE deleted_at IS NULL) and are partitioned separately so they're never
-- renamed.
INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
SELECT
	id, 'workflow',
	CASE WHEN archived_at IS NULL AND rn > 1 THEN name || ' (' || rn || ')' ELSE name END,
	user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, archived_at
FROM (
	SELECT *, ROW_NUMBER() OVER (
		PARTITION BY workspace_id, coalesce(parent_id, ''), name, (archived_at IS NULL)
		ORDER BY created_at, id
	) AS rn
	FROM "workflow_folder"
) "ranked_workflow_folder";
--> statement-breakpoint
-- Backfill: copy existing file folders into the generic table, preserving id verbatim.
-- Source table has no locked column, so use the same default as new rows. No active
-- duplicates exist in production today (verified), but the same defensive dedup as the
-- workflow backfill above is applied in case one is created before this migration runs.
INSERT INTO "folder" (id, resource_type, name, user_id, workspace_id, parent_id, locked, sort_order, created_at, updated_at, deleted_at)
SELECT
	id, 'file',
	CASE WHEN deleted_at IS NULL AND rn > 1 THEN name || ' (' || rn || ')' ELSE name END,
	user_id, workspace_id, parent_id, false, sort_order, created_at, updated_at, deleted_at
FROM (
	SELECT *, ROW_NUMBER() OVER (
		PARTITION BY workspace_id, coalesce(parent_id, ''), name, (deleted_at IS NULL)
		ORDER BY created_at, id
	) AS rn
	FROM "workspace_file_folders"
) "ranked_workspace_file_folders";
--> statement-breakpoint
-- knowledge_base.folder_id / user_table_definitions.folder_id are brand-new columns added
-- earlier in this same migration (all rows NULL) -- no old or new code reads/writes them
-- yet, so adding their FK here (unlike workflow/workspace_files above) has zero cross-deploy
-- write-compatibility risk. NOT VALID + an immediate VALIDATE still avoids the full-table
-- lock a plain ADD CONSTRAINT would take (validating an all-NULL column is instant either
-- way, but this keeps the pattern uniform and matches this repo's established precedent,
-- e.g. migrations/0243_kb_workspace_cascade.sql).
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "knowledge_base" VALIDATE CONSTRAINT "knowledge_base_folder_id_folder_id_fk";--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD CONSTRAINT "user_table_definitions_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "user_table_definitions" VALIDATE CONSTRAINT "user_table_definitions_folder_id_folder_id_fk";--> statement-breakpoint
-- knowledge_base/user_table_definitions are existing tables: build these indexes
-- CONCURRENTLY so the build never write-locks the relation (runner convention -- plain
-- CREATE INDEX takes ACCESS EXCLUSIVE; see packages/db/scripts/migrate.ts). This must be
-- the last statement group in the file -- CONCURRENTLY cannot run inside the migration
-- transaction, so everything after the COMMIT below runs outside it.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kb_folder_id_idx" ON "knowledge_base" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_table_def_folder_id_idx" ON "user_table_definitions" USING btree ("folder_id");--> statement-breakpoint
SET lock_timeout = '5s';
