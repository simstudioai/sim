COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: this new additive index has no deployed readers; remove any unjournaled prior build before rebuilding concurrently on replay.
DROP INDEX CONCURRENTLY IF EXISTS "user_gmail_mailbox_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_gmail_mailbox_idx" ON "user" USING btree ((CASE WHEN split_part(lower(btrim("email")), '@', 2) IN ('gmail.com', 'googlemail.com') THEN replace(split_part(split_part(lower(btrim("email")), '@', 1), '+', 1), '.', '') || '@gmail.com' END)) WHERE (CASE WHEN split_part(lower(btrim("user"."email")), '@', 2) IN ('gmail.com', 'googlemail.com') THEN replace(split_part(split_part(lower(btrim("user"."email")), '@', 1), '+', 1), '.', '') || '@gmail.com' END) IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
