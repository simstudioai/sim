-- Activity rollup correction bookkeeping: consecutive failed passes, when the correction queues
-- last ran (reads require it to be recent), and per-mark failure attempts. Columns on the one-row
-- activity_rollup_state and the small activity_rollup_dirty queue, each nullable or with a
-- constant DEFAULT, so every ADD COLUMN is metadata-only.
ALTER TABLE "activity_rollup_dirty" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_rollup_state" ADD COLUMN "failed_passes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_rollup_state" ADD COLUMN "corrections_at" timestamp with time zone;