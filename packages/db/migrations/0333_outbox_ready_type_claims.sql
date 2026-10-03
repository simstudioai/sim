COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: this new additive index has no deployed readers; remove any unjournaled prior build before rebuilding concurrently on replay.
DROP INDEX CONCURRENTLY IF EXISTS "outbox_event_pending_type_available_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_event_pending_type_available_idx" ON "outbox_event" USING btree ("event_type","available_at","created_at","id") WHERE "outbox_event"."status" = 'pending';--> statement-breakpoint
SET lock_timeout = '5s';
