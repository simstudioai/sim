-- Contracts the two objects v0.9.65 stopped declaring and using. organization.whitelabel_settings was
-- un-declared in 0468 (#10269) and rate_limit_bucket's Postgres token bucket and provider-capacity store
-- were removed when Redis became required (#10272). rate_limit_bucket has no FKs in either direction.
-- Each drop autocommits under a short lock timeout so a busy table fails fast for migrate.ts to retry
-- rather than queue traffic behind its ACCESS EXCLUSIVE lock.
COMMIT;--> statement-breakpoint
SET lock_timeout = '100ms';--> statement-breakpoint
-- migration-safe: contract of #10269 (shipped in v0.9.65): whitelabeling was removed and no release from v0.9.65 on declares, reads, or writes whitelabel_settings.
ALTER TABLE "organization" DROP COLUMN IF EXISTS "whitelabel_settings";--> statement-breakpoint
-- migration-safe: contract of #10272 (shipped in v0.9.65): Redis is required and the Postgres token bucket and provider-capacity store that used rate_limit_bucket were removed.
DROP TABLE IF EXISTS "rate_limit_bucket";--> statement-breakpoint
SET lock_timeout = '5s';
