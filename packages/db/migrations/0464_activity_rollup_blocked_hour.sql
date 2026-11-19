-- Records an hour the activity rollup could not aggregate within its statement bounds, so the
-- pass backs off that hour instead of retrying it every tick. activity_rollup_state holds a single
-- row and no deployed code writes these columns, so adding them (one with a constant default) is
-- a metadata-only change.
ALTER TABLE "activity_rollup_state" ADD COLUMN "blocked_hour" timestamp;--> statement-breakpoint
ALTER TABLE "activity_rollup_state" ADD COLUMN "blocked_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_rollup_state" ADD COLUMN "blocked_until" timestamp with time zone;