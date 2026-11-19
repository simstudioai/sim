-- One-row table, and a constant DEFAULT makes this ADD COLUMN metadata-only.
ALTER TABLE "activity_rollup_state" ADD COLUMN "failed_passes" integer DEFAULT 0 NOT NULL;