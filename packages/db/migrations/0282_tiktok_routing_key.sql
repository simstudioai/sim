-- Resolve the server-attested TikTok open_id once at deploy time, like Slack's
-- team_id routing. Rows whose credential/account identity cannot be proven are
-- deliberately left unchanged so the migration never guesses a tenant key.
-- migration-safe: session-local scratch table created only by this migration; no application code reads it.
DROP TABLE IF EXISTS "_tiktok_webhook_routing_backfill";
--> statement-breakpoint
CREATE TEMP TABLE "_tiktok_webhook_routing_backfill" ON COMMIT PRESERVE ROWS AS
SELECT
	"webhook"."id" AS "webhook_id",
	"webhook"."workflow_id",
	"webhook"."path",
	regexp_replace(
		"account"."account_id",
		'-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
		'',
		'i'
	) AS "routing_key"
FROM "webhook"
INNER JOIN "credential"
	ON "credential"."id" = (("webhook"."provider_config")::jsonb ->> 'credentialId')
	AND "credential"."type" = 'oauth'
	AND "credential"."provider_id" = 'tiktok'
INNER JOIN "workflow"
	ON "workflow"."id" = "webhook"."workflow_id"
	AND "workflow"."workspace_id" = "credential"."workspace_id"
INNER JOIN "account"
	ON "account"."id" = "credential"."account_id"
	AND "account"."provider_id" = 'tiktok'
WHERE "webhook"."provider" = 'tiktok'
	AND "account"."account_id" ~* '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	AND regexp_replace(
		"account"."account_id",
		'-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
		'',
		'i'
	) <> '';
--> statement-breakpoint
DELETE FROM "webhook_path_claim"
USING "_tiktok_webhook_routing_backfill"
WHERE "webhook_path_claim"."path" = "_tiktok_webhook_routing_backfill"."path"
	AND "webhook_path_claim"."workflow_id" = "_tiktok_webhook_routing_backfill"."workflow_id";
--> statement-breakpoint
UPDATE "webhook"
SET
	"routing_key" = "_tiktok_webhook_routing_backfill"."routing_key",
	"path" = NULL,
	"updated_at" = now()
FROM "_tiktok_webhook_routing_backfill"
WHERE "webhook"."id" = "_tiktok_webhook_routing_backfill"."webhook_id"
	AND "_tiktok_webhook_routing_backfill"."routing_key" <> '';
--> statement-breakpoint
DO $$
DECLARE migrated_count integer;
BEGIN
	SELECT count(*) INTO migrated_count FROM "_tiktok_webhook_routing_backfill";
	RAISE NOTICE 'Migrated % TikTok webhook rows to routing_key', migrated_count;
END $$;
--> statement-breakpoint
-- migration-safe: remove the session-local scratch table after the backfill completes.
DROP TABLE IF EXISTS "_tiktok_webhook_routing_backfill";
--> statement-breakpoint
-- The routing-key index replaces the old TikTok credential-expression lookup.
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "webhook_tiktok_credential_id_idx";
--> statement-breakpoint
SET lock_timeout = '5s';
