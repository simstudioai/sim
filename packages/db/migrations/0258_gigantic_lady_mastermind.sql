COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_tiktok_credential_id_idx" ON "webhook" USING btree ((("provider_config")::jsonb ->> 'credentialId')) WHERE "webhook"."provider" = 'tiktok' AND "webhook"."is_active" = true AND "webhook"."archived_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';