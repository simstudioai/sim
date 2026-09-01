-- Storage for `managed_api_key` credentials (enum value added in 0315).
--
-- Pure expand. The column is nullable, the new constraint is vacuously true for every
-- existing row, and the widened partial index covers a strict superset of what it covered
-- before. Deployed code that predates this migration ignores both.
--
-- The check constraint compares `type::text`, matching the two existing `managed_oauth`
-- constraints: a text comparison does not reference the enum label, so it stays valid
-- regardless of transaction boundaries around 0315.
--
-- The index predicate must NOT do that. An enum-to-text cast is STABLE rather than IMMUTABLE
-- (labels can be renamed), and Postgres rejects a non-immutable expression in an index
-- predicate with `functions in index predicate must be marked IMMUTABLE`. It compares the enum
-- values directly instead, which is safe here because 0315 committed the new label in an
-- earlier migration.
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "encrypted_api_key" text;
--> statement-breakpoint
-- Added NOT VALID so it never takes a validating lock against live writes; no stored row can
-- violate it (none is `managed_api_key` yet), so the VALIDATE below is a formality that takes
-- only a SHARE UPDATE EXCLUSIVE lock.
ALTER TABLE "credential" ADD CONSTRAINT "credential_managed_api_key_source_check" CHECK ((type::text <> 'managed_api_key') OR (
        encrypted_api_key IS NOT NULL
        AND credential_group_enrollment_id IS NOT NULL
        AND credential_group_option_id IS NOT NULL
        AND provider_id IS NOT NULL
        AND provider_subject_id IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND granted_at IS NOT NULL
        AND account_id IS NULL
        AND encrypted_oauth_token_set IS NULL
        AND encrypted_service_account_key IS NULL
        AND granted_scopes IS NULL
        AND authorization_app_id IS NULL
        AND managed_oauth_scope_version IS NULL
        AND access_token_expires_at IS NULL
        AND refresh_token_expires_at IS NULL
        AND last_refreshed_at IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND unredacted = false
      )) NOT VALID;
--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_managed_api_key_source_check";
--> statement-breakpoint
-- Concurrent index operations cannot run inside the migration runner's transaction.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: the replacement predicate is strictly wider than the one it replaces
-- (`managed_oauth` plus `managed_api_key`), so every pair it must keep unique was already
-- unique under the old index and no `managed_api_key` row exists yet. Both operations are
-- concurrent, so writers are never blocked and a replay simply rebuilds an invalid index.
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_option_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_option_unique" ON "credential" USING btree ("credential_group_enrollment_id","credential_group_option_id") WHERE type IN ('managed_oauth', 'managed_api_key');--> statement-breakpoint
SET lock_timeout = '5s';
