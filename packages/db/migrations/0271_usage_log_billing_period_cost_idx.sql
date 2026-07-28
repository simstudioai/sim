-- Replay-safety: this file is a single CONCURRENTLY index build below an embedded COMMIT, so a
-- failure there replays the whole file — every statement here is idempotent.
--
-- Covering index for the billing-period aggregates. The existing
-- usage_log_billing_entity_period_idx matches the same leading equality quals but does not carry
-- `cost`, so every matched entry takes a heap fetch — measured at ~30,600 heap fetches out of
-- 30,946 buffers for a single tenant's period sum, and 242 billion heap fetches lifetime.
--
-- Column order is deliberate and load-bearing:
--   1-3  the equality quals shared by both consumers.
--   4-5  user_id, created_at — the daily-refresh rollup filters on these and NOT on
--        billing_period_end, so they must sit immediately after the shared prefix to be usable as
--        scan boundaries. Placing billing_period_end here instead would end the prefix at column 3
--        and force that query to scan every entry for the period (~266k) rather than ~2.2k.
--   6-8  payload columns, present only so both aggregates can resolve index-only. billing_period_end
--        is functionally determined by billing_period_start (verified in production: 13,612 groups,
--        zero with more than one end), so it removes no rows and costs nothing here. `source` is
--        only referenced inside a FILTER expression, so its position is irrelevant.
--
-- usage_log_billing_entity_period_idx is intentionally RETAINED, not superseded: it deduplicates to
-- ~12.5 bytes/entry (17 MB for 1.42M entries) because it has no high-cardinality key column, making
-- it far more compact for prefix-only scans than this one can be. Dropping it would regress the
-- daily-refresh rollup's bitmap plan.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_billing_period_cost_idx" ON "usage_log" USING btree ("billing_entity_type","billing_entity_id","billing_period_start","user_id","created_at","billing_period_end","source","cost") WHERE "billing_entity_type" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
