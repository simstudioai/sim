-- Administrator-mode knowledge connectors: mirrored source permissions.
--
-- Two new tables hold the external directory groups an administrator crawl mirrors onto document
-- ACLs, and who belongs to them. Groups are scoped by workspace, provider and tenant so two
-- connectors over one directory resolve it once; membership is keyed by case-folded email, because
-- a directory reports addresses and most members of a granted group have no Sim account yet.
--
-- `user` gains a case-insensitive unique index. Every identity binding by email compares the folded
-- address, so two accounts differing only in case were one identity to it, each inheriting the
-- other's grants. The pre-check below runs inside the runner's batch transaction and fails the deploy
-- naming the duplicate count, rolling back having changed nothing: a concurrent unique build that
-- hit a duplicate would instead leave an INVALID index that `IF NOT EXISTS` skips on every later run,
-- so the constraint would appear to exist while enforcing nothing.
--
-- Transaction shape: the pre-check and the new (empty) tables run inside the runner's batch
-- transaction. The embedded COMMIT then ends it so the index on the hot `user` table can build
-- CONCURRENTLY without write-blocking it. A failure after the COMMIT replays this whole file
-- against tables that are already committed, so every statement here is idempotent: IF NOT
-- EXISTS on tables and indexes, pg_constraint lookups around the foreign keys, and the
-- DROP / IF NOT EXISTS pair on the concurrent build.
DO $$
DECLARE
  duplicate_addresses bigint;
BEGIN
  SELECT count(*) INTO duplicate_addresses
  FROM (SELECT 1 FROM "user" GROUP BY lower(btrim("email")) HAVING count(*) > 1) AS d;

  IF duplicate_addresses > 0 THEN
    RAISE EXCEPTION
      'Cannot create user_email_lower_unique: % email address(es) are held by more than one account. Merge the duplicate accounts, then re-run this migration.',
      duplicate_addresses;
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_external_group" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"external_group_id" text NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_external_group_member" (
	"group_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_external_group_member_group_id_email_pk" PRIMARY KEY("group_id","email")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keg_workspace_fk') THEN
    ALTER TABLE "knowledge_external_group" ADD CONSTRAINT "keg_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kegm_group_fk') THEN
    ALTER TABLE "knowledge_external_group_member" ADD CONSTRAINT "kegm_group_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_external_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keg_identity_unique" ON "knowledge_external_group" USING btree ("workspace_id","provider_id","tenant_id","external_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keg_workspace_synced_idx" ON "knowledge_external_group" USING btree ("workspace_id","last_synced_at" NULLS FIRST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kegm_email_idx" ON "knowledge_external_group_member" USING btree ("email");
--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes an invalid build left by an earlier attempt; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "user_email_lower_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "user_email_lower_unique" ON "user" USING btree (lower(btrim("email")));--> statement-breakpoint
SET lock_timeout = '5s';
