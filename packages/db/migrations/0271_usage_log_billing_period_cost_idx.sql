-- Replay-safety: this file is a single CONCURRENTLY index build below an embedded COMMIT, so a
-- failure there replays the whole file — every statement here is idempotent.
--
-- Covering index for the billing-period cost aggregates. The existing
-- usage_log_billing_entity_period_idx matches the same four equality quals but does not carry
-- `cost`, so every matched entry takes a heap fetch (~47.5k per aggregate, ~62k aggregates/day).
-- Trailing the remaining predicate columns and `cost` as key columns lets both the period SUM and
-- the daily-refresh rollup resolve as index-only scans.
--
-- Key columns rather than INCLUDE: drizzle-orm is pinned at ^0.45.2, which has no .include(), and a
-- trailing key column yields the same index-only scan while keeping schema.ts and this file in sync.
--
-- The superseded index is left in place here; dropping it is a separate contract-phase migration so
-- that a planner regression costs nothing to revert.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_billing_period_cost_idx" ON "usage_log" USING btree ("billing_entity_type","billing_entity_id","billing_period_start","billing_period_end","source","user_id","created_at","cost") WHERE "billing_entity_type" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
