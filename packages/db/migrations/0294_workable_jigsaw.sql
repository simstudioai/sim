-- usage_log is a hot append-only ledger. Build the reporting-range covering
-- index without taking a table-wide write lock. The migration runner starts a
-- transaction for each pending batch, so end it before CONCURRENTLY. Everything
-- below is replayable even when a failed concurrent build left an INVALID
-- same-named index behind.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay cleanup for the index introduced by this same unjournaled migration; CONCURRENTLY preserves usage_log writes
DROP INDEX CONCURRENTLY IF EXISTS "usage_log_billing_entity_created_at_cost_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_billing_entity_created_at_cost_idx" ON "usage_log" USING btree ("billing_entity_type","billing_entity_id","created_at","user_id","source","cost") WHERE "usage_log"."billing_entity_type" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
