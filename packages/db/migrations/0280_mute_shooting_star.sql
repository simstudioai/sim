-- Replay-safety: this migration contains only an idempotent concurrent index build.
-- migration-safe: additive partial index only; no application-version cutover is required
-- because existing and new code remain compatible while the index is built.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "memory_workspace_updated_id_active_idx" ON "memory" USING btree ("workspace_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "memory"."deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
