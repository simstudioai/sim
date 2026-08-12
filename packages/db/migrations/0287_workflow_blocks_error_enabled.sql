-- migration-safe: an additive column with a non-null default, so old and new app versions read and write these rows throughout the deploy.
ALTER TABLE "workflow_blocks" ADD COLUMN "error_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every released version draws the error port with no toggle in front of it, so a
-- block someone already wired an error edge out of HAS the output on — there was
-- no other way to draw that edge. Defaulting those rows to false would hide a port
-- a live workflow routes failures through, so the edges decide the flag for every
-- workflow that predates the toggle. `workflow-block.tsx` keeps the same rule at
-- render time for states that never pass through here (imports, snapshots, copilot
-- edits); do not narrow either one to read the flag alone.
-- migration-safe: idempotent (sets a constant, on a column no released version reads or writes, so there is nothing to race); touches only the blocks that already have an error edge.
UPDATE "workflow_blocks" AS b
SET "error_enabled" = true
FROM "workflow_edges" AS e
WHERE e."source_block_id" = b."id" AND e."source_handle" = 'error';
