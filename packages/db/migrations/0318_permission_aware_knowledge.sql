-- Permission-aware knowledge bases (expand phase): document-level access control, members-mode
-- connectors, and per-member change feeds.
--
-- Every document gains `acl text[]`, the sorted list of access tokens a principal must hold one of
-- to read it. The column is added with a fast default of '{ws}' ("any workspace member"), which
-- on PG11+ is stored in pg_attribute.attmissingval and costs no table rewrite; every existing row
-- therefore keeps today's visibility until a connector opts into members mode. Members mode adds
-- three tables: one row per (connector, member credential), one row per (document, member) that
-- observed it, and a run log. The currently deployed application never reads or writes any column
-- added here and never inserts into the new tables, so this file is backward-compatible with it.
--
-- Transaction shape: the runner batches every pending file into ONE transaction and only an
-- embedded `COMMIT;` ends it (packages/db/scripts/migrate.ts). Everything up to that COMMIT is
-- cheap metadata work on small or new tables. Everything after it runs in autocommit and must
-- survive being run twice: constraints are guarded by pg_constraint lookups, indexes use
-- IF [NOT] EXISTS, and VALIDATE on an already-validated constraint is a no-op.
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "acl" text[] DEFAULT '{ws}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "source_modified_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "access_mode" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "credential_group_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "credential_group_option_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "member_sync_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "member_sync_lock_token" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "member_sync_lock_lease_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "next_member_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "last_member_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "last_member_sync_error" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "member_sync_consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "access_rewrite_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_connector_member" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"subject_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"last_started_at" timestamp,
	"last_complete_listing_at" timestamp,
	"last_listed_count" integer,
	"last_error" text,
	"member_synced_through" timestamp,
	"change_cursor" text,
	"change_cursor_at" timestamp,
	"suspended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kcm_status_check" CHECK ("knowledge_connector_member"."status" IN ('active', 'suspended', 'disabled')),
	CONSTRAINT "kcm_subject_token_shape_check" CHECK ("knowledge_connector_member"."subject_token" ~ '^s:[^:]+:[^:]+:.+$')
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_connector_member_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"members_claimed" integer DEFAULT 0 NOT NULL,
	"members_completed" integer DEFAULT 0 NOT NULL,
	"members_incomplete" integer DEFAULT 0 NOT NULL,
	"members_failed" integer DEFAULT 0 NOT NULL,
	"docs_listed" integer DEFAULT 0 NOT NULL,
	"docs_added" integer DEFAULT 0 NOT NULL,
	"docs_updated" integer DEFAULT 0 NOT NULL,
	"docs_unchanged" integer DEFAULT 0 NOT NULL,
	"docs_hydrated_once" integer DEFAULT 0 NOT NULL,
	"observations_added" integer DEFAULT 0 NOT NULL,
	"observations_removed" integer DEFAULT 0 NOT NULL,
	"docs_tombstoned" integer DEFAULT 0 NOT NULL,
	"docs_resurrected" integer DEFAULT 0 NOT NULL,
	"docs_purged" integer DEFAULT 0 NOT NULL,
	"credentials_audited" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	CONSTRAINT "kcmsl_status_check" CHECK ("knowledge_connector_member_sync_log"."status" IN ('started', 'completed', 'failed'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_document_observation" (
	"document_id" text NOT NULL,
	"member_id" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"run_id" text NOT NULL,
	CONSTRAINT "knowledge_document_observation_document_id_member_id_pk" PRIMARY KEY("document_id","member_id")
);--> statement-breakpoint
-- Foreign keys on the tables created above. They have no rows and no live traffic, so plain
-- ADD CONSTRAINT is safe; the pg_constraint guards only make the file replay-safe.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'knowledge_connector_member_workspace_id_workspace_id_fk' AND "conrelid" = '"knowledge_connector_member"'::regclass) THEN
    ALTER TABLE "knowledge_connector_member" ADD CONSTRAINT "knowledge_connector_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'knowledge_connector_member_connector_id_knowledge_connector_id_fk' AND "conrelid" = '"knowledge_connector_member"'::regclass) THEN
    ALTER TABLE "knowledge_connector_member" ADD CONSTRAINT "knowledge_connector_member_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'knowledge_connector_member_credential_id_credential_id_fk' AND "conrelid" = '"knowledge_connector_member"'::regclass) THEN
    ALTER TABLE "knowledge_connector_member" ADD CONSTRAINT "knowledge_connector_member_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'knowledge_connector_member_sync_log_connector_id_knowledge_connector_id_fk' AND "conrelid" = '"knowledge_connector_member_sync_log"'::regclass) THEN
    ALTER TABLE "knowledge_connector_member_sync_log" ADD CONSTRAINT "knowledge_connector_member_sync_log_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'knowledge_document_observation_document_id_document_id_fk' AND "conrelid" = '"knowledge_document_observation"'::regclass) THEN
    ALTER TABLE "knowledge_document_observation" ADD CONSTRAINT "knowledge_document_observation_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'knowledge_document_observation_member_id_knowledge_connector_member_id_fk' AND "conrelid" = '"knowledge_document_observation"'::regclass) THEN
    ALTER TABLE "knowledge_document_observation" ADD CONSTRAINT "knowledge_document_observation_member_id_knowledge_connector_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."knowledge_connector_member"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kcm_connector_credential_unique" ON "knowledge_connector_member" USING btree ("connector_id","credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kcm_connector_queue_idx" ON "knowledge_connector_member" USING btree ("connector_id","next_attempt_at" NULLS FIRST,"last_started_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kcm_credential_idx" ON "knowledge_connector_member" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kcmsl_connector_started_at_idx" ON "knowledge_connector_member_sync_log" USING btree ("connector_id","started_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kcmsl_started_at_partial_idx" ON "knowledge_connector_member_sync_log" USING btree ("started_at") WHERE "knowledge_connector_member_sync_log"."status" = 'started';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kdo_member_idx" ON "knowledge_document_observation" USING btree ("member_id");--> statement-breakpoint
-- Ends the runner's batch transaction (a redundant COMMIT is a WARNING, not an error). Every
-- statement below runs in autocommit so that no scan or index build holds the batch's locks.
COMMIT;--> statement-breakpoint
-- CHECK constraints on existing tables: NOT VALID adds them without a scan, then VALIDATE runs in
-- its own statement under SHARE UPDATE EXCLUSIVE. All four hold trivially today — every row is
-- '{ws}', 'workspace', 'idle', and has no member lease — so validation cannot fail.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'doc_acl_token_shape_check' AND "conrelid" = '"document"'::regclass) THEN
    ALTER TABLE "document" ADD CONSTRAINT "doc_acl_token_shape_check" CHECK (array_position("document"."acl", NULL) IS NULL AND (cardinality("document"."acl") = 0 OR array_to_string("document"."acl", E'\n') ~ '^((ws|pub|link|u:[^\nA-Z]+@[^\nA-Z]+|[gs]:[^\n:]+:[^\n:]+:[^\n]+)(\n(ws|pub|link|u:[^\nA-Z]+@[^\nA-Z]+|[gs]:[^\n:]+:[^\n:]+:[^\n]+))*)$')) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "document" VALIDATE CONSTRAINT "doc_acl_token_shape_check";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'kc_access_mode_check' AND "conrelid" = '"knowledge_connector"'::regclass) THEN
    ALTER TABLE "knowledge_connector" ADD CONSTRAINT "kc_access_mode_check" CHECK ("knowledge_connector"."access_mode" IN ('workspace', 'members', 'admin')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'kc_member_sync_status_check' AND "conrelid" = '"knowledge_connector"'::regclass) THEN
    ALTER TABLE "knowledge_connector" ADD CONSTRAINT "kc_member_sync_status_check" CHECK ("knowledge_connector"."member_sync_status" IN ('idle', 'pending', 'running', 'error', 'disabled')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'kc_sync_lock_exclusive_check' AND "conrelid" = '"knowledge_connector"'::regclass) THEN
    ALTER TABLE "knowledge_connector" ADD CONSTRAINT "kc_sync_lock_exclusive_check" CHECK (NOT ("knowledge_connector"."sync_lock_token" IS NOT NULL AND "knowledge_connector"."member_sync_lock_token" IS NOT NULL)) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "knowledge_connector" VALIDATE CONSTRAINT "kc_access_mode_check";--> statement-breakpoint
ALTER TABLE "knowledge_connector" VALIDATE CONSTRAINT "kc_member_sync_status_check";--> statement-breakpoint
ALTER TABLE "knowledge_connector" VALIDATE CONSTRAINT "kc_sync_lock_exclusive_check";--> statement-breakpoint
-- credential_group_id is a new, all-NULL column, so its FK validates instantly.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'knowledge_connector_credential_group_id_credential_group_id_fk' AND "conrelid" = '"knowledge_connector"'::regclass) THEN
    ALTER TABLE "knowledge_connector" ADD CONSTRAINT "knowledge_connector_credential_group_id_credential_group_id_fk" FOREIGN KEY ("credential_group_id") REFERENCES "public"."credential_group"("id") ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "knowledge_connector" VALIDATE CONSTRAINT "knowledge_connector_credential_group_id_credential_group_id_fk";--> statement-breakpoint
-- knowledge_connector.credential_id is deliberately not yet a foreign key: rows written before
-- the credential table existed may still hold a raw account.id, which lib/oauth/credential-service.ts
-- still honours and which script migration 0011 remaps. A later migration adds the reference once
-- 0011 has run in production (see the contract-pending marker on knowledgeConnector.credentialId).
SET lock_timeout = 0;--> statement-breakpoint
-- The access predicate's index on the large table, built without blocking writes.
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "doc_acl_gin_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_acl_gin_idx" ON "document" USING gin ("acl" array_ops) WHERE "document"."deleted_at" IS NULL;--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve row writes.
DROP INDEX CONCURRENTLY IF EXISTS "kc_member_sync_due_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kc_member_sync_due_idx" ON "knowledge_connector" USING btree ("member_sync_status","next_member_sync_at") WHERE "knowledge_connector"."access_mode" = 'members' AND "knowledge_connector"."deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';--> statement-breakpoint
-- The fast default leaves `acl` with no statistics; without them the planner estimates the
-- predicate's selectivity blind and may prefer the GIN bitmap path for the common '{ws,pub}'
-- token set. ANALYZE is sample-based and cheap; it is not a backfill.
ANALYZE "document";
