import type { Sql } from 'postgres'

/**
 * Objects Drizzle cannot express. Both the versioned migration runner and
 * db:push install this same lifecycle so consent and token-family guarantees
 * do not depend on how the tables were created. Reapplication preserves every
 * grant and operator customization of the seeded client. Future lifecycle
 * changes also require a new script migration; db:push reapplies on every run.
 */
const OAUTH_PROVIDER_LIFECYCLE_SQL = `CREATE OR REPLACE FUNCTION "oauth_refresh_token_prepare_family"() RETURNS trigger AS $$
DECLARE
	resolved_consent_id text;
BEGIN
	IF NEW."family_id" IS NULL THEN
		SELECT "id" INTO resolved_consent_id
		FROM "oauth_consent"
		WHERE "client_id" = NEW."client_id"
			AND "user_id" IS NOT DISTINCT FROM NEW."user_id"
			AND "reference_id" IS NOT DISTINCT FROM NEW."reference_id"
		FOR KEY SHARE;

		NEW."family_id" := NEW."id";
		NEW."generation" := 0;
		INSERT INTO "oauth_token_family" (
			"id", "client_id", "session_id", "user_id", "reference_id",
			"consent_id", "current_generation", "created_at", "expires_at"
		) VALUES (
			NEW."id", NEW."client_id", NEW."session_id", NEW."user_id", NEW."reference_id",
			resolved_consent_id, 0, NEW."created_at", NEW."expires_at"
		);
	ELSE
		PERFORM 1
		FROM "oauth_token_family" AS family
		WHERE family."id" = NEW."family_id"
			AND family."client_id" = NEW."client_id"
			AND family."user_id" = NEW."user_id"
			AND family."session_id" IS NOT DISTINCT FROM NEW."session_id"
			AND family."reference_id" IS NOT DISTINCT FROM NEW."reference_id"
			AND family."current_generation" = NEW."generation"
			AND NEW."expires_at" <= family."expires_at";

		IF NOT FOUND THEN
			RAISE EXCEPTION 'OAuth refresh token does not match its current family generation'
				USING ERRCODE = 'foreign_key_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER "oauth_refresh_token_10_prepare_family"
	BEFORE INSERT ON "oauth_refresh_token"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_refresh_token_prepare_family"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "oauth_token_require_active_consent"() RETURNS trigger AS $$
BEGIN
	PERFORM 1
	FROM "oauth_client"
	WHERE "client_id" = NEW."client_id"
		AND "skip_consent" IS TRUE;

	IF FOUND THEN
		RETURN NEW;
	END IF;

	PERFORM 1
	FROM "oauth_consent"
	WHERE "client_id" = NEW."client_id"
		AND "user_id" IS NOT DISTINCT FROM NEW."user_id"
		AND "reference_id" IS NOT DISTINCT FROM NEW."reference_id"
		AND NEW."scopes" <@ "scopes"
	FOR SHARE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'OAuth token requires an active consent grant'
			USING ERRCODE = 'foreign_key_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER "oauth_access_token_require_active_consent"
	BEFORE INSERT ON "oauth_access_token"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_token_require_active_consent"();--> statement-breakpoint
CREATE OR REPLACE TRIGGER "oauth_refresh_token_20_require_active_consent"
	BEFORE INSERT ON "oauth_refresh_token"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_token_require_active_consent"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "oauth_consent_narrow_tokens"() RETURNS trigger AS $$
BEGIN
	IF NEW."scopes" = OLD."scopes" THEN
		RETURN NEW;
	END IF;

	DELETE FROM "oauth_token_family" AS family
	WHERE family."consent_id" = NEW."id"
		AND EXISTS (
			SELECT 1
			FROM "oauth_refresh_token" AS refresh
			WHERE refresh."family_id" = family."id"
				AND refresh."generation" = family."current_generation"
				AND NOT (refresh."scopes" <@ NEW."scopes")
		);

	DELETE FROM "oauth_access_token"
	WHERE "client_id" = NEW."client_id"
		AND "user_id" IS NOT DISTINCT FROM NEW."user_id"
		AND "reference_id" IS NOT DISTINCT FROM NEW."reference_id"
		AND NOT ("scopes" <@ NEW."scopes");
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER "oauth_consent_narrow_tokens"
	AFTER UPDATE OF "scopes" ON "oauth_consent"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_consent_narrow_tokens"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "oauth_consent_delete_unlinked_access_tokens"() RETURNS trigger AS $$
BEGIN
	DELETE FROM "oauth_access_token"
	WHERE "client_id" = OLD."client_id"
		AND "user_id" IS NOT DISTINCT FROM OLD."user_id"
		AND "reference_id" IS NOT DISTINCT FROM OLD."reference_id";
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER "oauth_consent_delete_unlinked_access_tokens"
	AFTER DELETE ON "oauth_consent"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_consent_delete_unlinked_access_tokens"();--> statement-breakpoint
-- Seed the first-party Sim CLI as a public PKCE client. Loopback URIs match any port per RFC 8252.
INSERT INTO "oauth_client" (
	"id", "client_id", "name", "disabled", "skip_consent", "public", "type",
	"token_endpoint_auth_method", "require_pkce", "grant_types", "response_types",
	"redirect_uris", "scopes", "created_at", "updated_at"
) VALUES (
	'sim-cli', 'sim-cli', 'Sim CLI', false, false, true, 'native',
	'none', true, ARRAY['authorization_code', 'refresh_token'], ARRAY['code'],
	ARRAY['http://127.0.0.1/callback', 'http://[::1]/callback'],
	ARRAY['offline_access', 'api:read', 'api:write'],
	now(), now()
) ON CONFLICT ("client_id") DO NOTHING;
`

/** Installs OAuth triggers and the first-party client atomically and idempotently. */
export async function reconcileOAuthProviderLifecycle(database: Sql): Promise<void> {
  await database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx`SELECT pg_advisory_xact_lock(hashtext('sim:oauth-provider-lifecycle'))`
    for (const statement of OAUTH_PROVIDER_LIFECYCLE_SQL.split('--> statement-breakpoint')) {
      if (statement.trim()) await tx.unsafe(statement)
    }
  })
}
