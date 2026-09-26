-- migration-safe: one ADD COLUMN with a constant default on "workspace"; non-rewriting in modern
-- Postgres. Every existing workspace lands on false, which is the historical opt-out behaviour,
-- so no row changes meaning and no serving query changes shape. No backfill needed.
ALTER TABLE "workspace" ADD COLUMN "fork_sync_new_workflows_excluded" boolean DEFAULT false NOT NULL;
