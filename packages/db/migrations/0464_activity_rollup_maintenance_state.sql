-- The activity rollup's maintenance bookkeeping: hours too heavy to read, retried with backoff, and
-- when a pass last completed (which gates writers' marks and decides a rebuild after a gap). A new
-- table, and a nullable column on the one-row activity_rollup_state, which no deployed code
-- writes: metadata-only and invisible to the running app.
-- 0463 ends the batch transaction with a concurrent index build; keep this table and its journal row atomic.
BEGIN;--> statement-breakpoint
CREATE TABLE "activity_rollup_blocked" (
	"bucket_start" timestamp PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"retry_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_rollup_state" ADD COLUMN "maintained_at" timestamp with time zone;