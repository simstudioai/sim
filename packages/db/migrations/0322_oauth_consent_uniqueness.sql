DROP INDEX "oauth_consent_user_client_idx";--> statement-breakpoint
CREATE INDEX "oauth_access_token_expires_at_idx" ON "oauth_access_token" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_expires_at_idx" ON "oauth_refresh_token" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_client_reference_unique" UNIQUE NULLS NOT DISTINCT("user_id","client_id","reference_id");