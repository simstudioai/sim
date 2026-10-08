CREATE TABLE "client_credential_token" (
	"id" text PRIMARY KEY NOT NULL,
	"encrypted_value" text NOT NULL,
	"access_token_digest" text,
	"expires_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "client_credential_token_expires_at_idx" ON "client_credential_token" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "client_credential_token_access_token_digest_idx" ON "client_credential_token" USING btree ("access_token_digest") WHERE "client_credential_token"."access_token_digest" IS NOT NULL;