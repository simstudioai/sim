CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"refresh_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"token_endpoint_auth_method" text,
	"grant_types" text[],
	"response_types" text[],
	"public" boolean,
	"type" text,
	"require_pkce" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"scopes" text[] NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "oauth_consent_user_client_reference_unique" UNIQUE NULLS NOT DISTINCT("user_id","client_id","reference_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"revoked" timestamp,
	"auth_time" timestamp,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_id_idx" ON "oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_session_id_idx" ON "oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_refresh_id_idx" ON "oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_client_idx" ON "oauth_access_token" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_expires_at_idx" ON "oauth_access_token" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_client_user_id_idx" ON "oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_client_id_idx" ON "oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_client_id_idx" ON "oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_session_id_idx" ON "oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_user_client_idx" ON "oauth_refresh_token" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_expires_at_idx" ON "oauth_refresh_token" USING btree ("expires_at");--> statement-breakpoint
CREATE FUNCTION "oauth_consent_upsert"() RETURNS trigger AS $$
DECLARE
	existing_id text;
BEGIN
	PERFORM pg_advisory_xact_lock(
		hashtextextended(
			concat_ws(E'\x1f', NEW."client_id", NEW."user_id", NEW."reference_id"),
			0
		)
	);

	SELECT "id" INTO existing_id
	FROM "oauth_consent"
	WHERE "client_id" = NEW."client_id"
		AND "user_id" IS NOT DISTINCT FROM NEW."user_id"
		AND "reference_id" IS NOT DISTINCT FROM NEW."reference_id";

	IF existing_id IS NOT NULL THEN
		UPDATE "oauth_consent"
		SET "scopes" = NEW."scopes", "updated_at" = NEW."updated_at"
		WHERE "id" = existing_id;
		RETURN NULL;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "oauth_consent_upsert"
	BEFORE INSERT ON "oauth_consent"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_consent_upsert"();--> statement-breakpoint
CREATE FUNCTION "oauth_token_require_active_consent"() RETURNS trigger AS $$
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
CREATE TRIGGER "oauth_access_token_require_active_consent"
	BEFORE INSERT ON "oauth_access_token"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_token_require_active_consent"();--> statement-breakpoint
CREATE TRIGGER "oauth_refresh_token_require_active_consent"
	BEFORE INSERT ON "oauth_refresh_token"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_token_require_active_consent"();--> statement-breakpoint
CREATE FUNCTION "oauth_consent_narrow_tokens"() RETURNS trigger AS $$
BEGIN
	IF NEW."scopes" = OLD."scopes" THEN
		RETURN NEW;
	END IF;

	DELETE FROM "oauth_refresh_token"
	WHERE "client_id" = NEW."client_id"
		AND "user_id" IS NOT DISTINCT FROM NEW."user_id"
		AND "reference_id" IS NOT DISTINCT FROM NEW."reference_id"
		AND NOT ("scopes" <@ NEW."scopes");

	DELETE FROM "oauth_access_token"
	WHERE "client_id" = NEW."client_id"
		AND "user_id" IS NOT DISTINCT FROM NEW."user_id"
		AND "reference_id" IS NOT DISTINCT FROM NEW."reference_id"
		AND NOT ("scopes" <@ NEW."scopes");
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "oauth_consent_narrow_tokens"
	AFTER UPDATE OF "scopes" ON "oauth_consent"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_consent_narrow_tokens"();--> statement-breakpoint
CREATE FUNCTION "oauth_consent_delete_tokens"() RETURNS trigger AS $$
BEGIN
	DELETE FROM "oauth_refresh_token"
	WHERE "client_id" = OLD."client_id"
		AND "user_id" IS NOT DISTINCT FROM OLD."user_id"
		AND "reference_id" IS NOT DISTINCT FROM OLD."reference_id";

	DELETE FROM "oauth_access_token"
	WHERE "client_id" = OLD."client_id"
		AND "user_id" IS NOT DISTINCT FROM OLD."user_id"
		AND "reference_id" IS NOT DISTINCT FROM OLD."reference_id";
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "oauth_consent_delete_tokens"
	AFTER DELETE ON "oauth_consent"
	FOR EACH ROW
	EXECUTE FUNCTION "oauth_consent_delete_tokens"();--> statement-breakpoint
-- Seed the first-party Sim CLI as a public (PKCE-only, no secret) OAuth client.
-- Loopback redirect URIs match any port (RFC 8252 §7.3); consent is never skipped.
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
