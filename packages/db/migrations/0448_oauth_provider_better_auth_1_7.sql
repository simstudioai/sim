-- Better Auth 1.7 OAuth provider schema, expand only. Every new column is nullable or carries a
-- constant default (a catalog-only change), so 1.6.27 pods, which never name them, keep inserting
-- during the rollout. oauth_client.public and type stay for those pods; 1.7 stops writing them
-- (contract-pending in schema.ts).
--
-- oauth_resource, oauth_client_resource and oauth_client_assertion start empty: Sim binds its
-- per-organization and per-workflow MCP resources itself and never registers private_key_jwt
-- clients, but the provider reads these tables, so they must exist.
--
-- Tables are altered in the order token issuance locks them (client, consent, refresh token, access
-- token), so a concurrent grant waits for this migration instead of deadlocking with it.
--
-- Replay-safety: this file ends in CONCURRENTLY index builds on the live token tables below an
-- embedded COMMIT, so a failure there replays the whole file from the top — every statement here
-- is idempotent.
CREATE TABLE IF NOT EXISTS "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp,
	CONSTRAINT "oauth_client_resource_client_resource_unique" UNIQUE("client_id","resource_id"),
	CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_client_resource_resource_id_idx" ON "oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "client_discovery_id" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "client_credentials_scopes" text[] DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "backchannel_logout_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "backchannel_logout_session_required" boolean;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "application_type" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "jwks" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "jwks_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "dpop_bound_access_tokens" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN IF NOT EXISTS "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "authorization_code_id" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotated_at" timestamp;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotation_replay_response" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotation_replay_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "revoked" timestamp;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "authorization_code_id" text;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "confirmation" jsonb;--> statement-breakpoint
-- A failed concurrent build leaves an invalid index that IF NOT EXISTS would keep: each replay
-- moves one aside to be dropped, never a valid index or one on another table.
DO $$
DECLARE
  target text[];
BEGIN
  FOREACH target SLICE 1 IN ARRAY ARRAY[
    ['oauth_access_token_authorization_code_id_idx', 'oauth_access_token'],
    ['oauth_refresh_token_authorization_code_id_idx', 'oauth_refresh_token']
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(target[1] || '_failed')
        AND (indisvalid OR indrelid <> to_regclass(target[2]))
    ) THEN
      RAISE EXCEPTION 'Refusing to drop unexpected recovery index %_failed', target[1];
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(target[1])
        AND indrelid = to_regclass(target[2]) AND NOT indisvalid
    ) THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', target[1], target[1] || '_failed');
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "oauth_access_token_authorization_code_id_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_access_token_authorization_code_id_idx" ON "oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "oauth_refresh_token_authorization_code_id_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_refresh_token_authorization_code_id_idx" ON "oauth_refresh_token" USING btree ("authorization_code_id");--> statement-breakpoint
SET lock_timeout = '5s';
