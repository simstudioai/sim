-- Restores the single-column indexes on workflow_edges(source_block_id) and (target_block_id).
--
-- Both block-id columns reference workflow_blocks(id) ON DELETE CASCADE, so Postgres looks up
-- `WHERE source_block_id = $1` and `WHERE target_block_id = $1` once per deleted block. The
-- composite (workflow_id, *_block_id) indexes cannot serve that lookup, so a database without
-- these seq-scans the whole edges table twice per deleted block, inside the transaction that holds
-- the workflow row lock. 0043 created both indexes but schema.ts never declared them, so databases
-- built from the schema (and any that drifted) lack them; IF NOT EXISTS keeps this a no-op where
-- 0043's indexes survive.
--
-- Replay-safety: as 0463. workflow_edges is hot, so the builds are CONCURRENTLY below an embedded
-- COMMIT, and a replay moves only an INVALID index left by a failed build aside to be dropped,
-- keeping a valid one.
DO $$
DECLARE
  idx text;
BEGIN
  FOREACH idx IN ARRAY ARRAY['workflow_edges_source_block_fk_idx', 'workflow_edges_target_block_fk_idx'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(idx || '_failed')
        AND (indisvalid OR indrelid <> to_regclass('workflow_edges'))
    ) THEN
      RAISE EXCEPTION 'Refusing to drop unexpected recovery index %', idx || '_failed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(idx)
        AND indrelid = to_regclass('workflow_edges') AND NOT indisvalid
    ) THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', idx, idx || '_failed');
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workflow_edges_source_block_fk_idx_failed";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workflow_edges_target_block_fk_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_edges_source_block_fk_idx" ON "workflow_edges" USING btree ("source_block_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_edges_target_block_fk_idx" ON "workflow_edges" USING btree ("target_block_id");--> statement-breakpoint
SET lock_timeout = '5s';
