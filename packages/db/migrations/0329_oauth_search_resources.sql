ALTER TABLE "oauth_access_token" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "resource" text;--> statement-breakpoint
-- Existing API grants retain NULL resources. During a rolling deploy, an older
-- writer must fail closed if it tries to issue the new search scope without its audience.
-- NOT VALID avoids scanning existing token tables while enforcing every new write.
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_search_resource_check" CHECK (NOT ('search:read' = ANY("oauth_access_token"."scopes")) OR "oauth_access_token"."resource" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_search_resource_check" CHECK (NOT ('search:read' = ANY("oauth_refresh_token"."scopes")) OR "oauth_refresh_token"."resource" IS NOT NULL) NOT VALID;
