-- TikTok now uses the shared routing-key lookup. No deployed TikTok webhooks
-- exist to backfill, so only remove the obsolete provider-specific index.
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "webhook_tiktok_credential_id_idx";
--> statement-breakpoint
SET lock_timeout = '5s';
