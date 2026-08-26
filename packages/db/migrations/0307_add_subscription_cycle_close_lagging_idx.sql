-- Concurrent index operations cannot run inside the migration runner's transaction.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "subscription_cycle_close_lagging_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "subscription_cycle_close_lagging_idx" ON "subscription" USING btree ("id") WHERE "subscription"."status" in ('active', 'past_due') and "subscription"."period_start" is not null and ("subscription"."last_closed_period_start" is null or "subscription"."last_closed_period_start" < "subscription"."period_start");
