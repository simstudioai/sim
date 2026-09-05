-- Enterprise Search: bounded synchronization, canonical workspace accounts,
-- provider identity group membership, and shared provider admission cooldowns.
-- Generated from the staging snapshot before adding replay-safe DDL and bounded backfills.
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
	"subject_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_external_group_member_group_id_subject_token_pk" PRIMARY KEY("group_id","subject_token")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keg_workspace_fk' AND conrelid = 'knowledge_external_group'::regclass) THEN
    ALTER TABLE "knowledge_external_group" ADD CONSTRAINT "keg_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kegm_group_fk' AND conrelid = 'knowledge_external_group_member'::regclass) THEN
    ALTER TABLE "knowledge_external_group_member" ADD CONSTRAINT "kegm_group_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_external_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keg_identity_unique" ON "knowledge_external_group" USING btree ("workspace_id","provider_id","tenant_id","external_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keg_workspace_synced_idx" ON "knowledge_external_group" USING btree ("workspace_id","last_synced_at" NULLS FIRST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kegm_subject_token_idx" ON "knowledge_external_group_member" USING btree ("subject_token");
--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes an invalid build left by an earlier attempt; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "user_email_lower_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_email_lower_idx" ON "user" USING btree (lower(btrim("email")));--> statement-breakpoint
SET lock_timeout = '5s';

--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "acl_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "acl_verified_at" timestamp;--> statement-breakpoint
-- Rearm automatic permission refresh in bounded, replay-safe batches. Manual, paused,
-- disabled, running, null-scheduled, and already-overdue work retains its schedule.
DO $rearm_permission_refresh$
DECLARE
  refresh_deadline timestamp := now() + interval '1 hour';
  affected integer;
BEGIN
  LOOP
    WITH due AS (
      SELECT id
      FROM knowledge_connector
      WHERE sync_interval_minutes > 0
        AND status IN ('active', 'error')
        AND archived_at IS NULL AND deleted_at IS NULL
        AND (
          (access_mode = 'admin' AND next_sync_at > refresh_deadline)
          OR (access_mode = 'members' AND member_sync_status IN ('idle', 'error')
              AND next_member_sync_at > refresh_deadline)
        )
      ORDER BY id
      LIMIT 500
      FOR UPDATE
    )
    UPDATE knowledge_connector AS connector
    SET next_sync_at = CASE WHEN connector.access_mode = 'admin'
          THEN LEAST(connector.next_sync_at, refresh_deadline) ELSE connector.next_sync_at END,
        next_member_sync_at = CASE WHEN connector.access_mode = 'members'
          THEN LEAST(connector.next_member_sync_at, refresh_deadline) ELSE connector.next_member_sync_at END
    FROM due WHERE connector.id = due.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;

  LOOP
    WITH due AS (
      SELECT member.id
      FROM knowledge_connector_member AS member
      JOIN knowledge_connector AS connector ON connector.id = member.connector_id
      WHERE connector.access_mode = 'members' AND connector.sync_interval_minutes > 0
        AND connector.status IN ('active', 'error')
        AND connector.member_sync_status IN ('idle', 'error')
        AND connector.archived_at IS NULL AND connector.deleted_at IS NULL
        AND member.status = 'active' AND member.next_attempt_at > refresh_deadline
      ORDER BY member.id
      LIMIT 500
      FOR UPDATE OF member
    )
    UPDATE knowledge_connector_member AS member
    SET next_attempt_at = refresh_deadline
    FROM due WHERE member.id = due.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$rearm_permission_refresh$;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "source_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "is_search_index" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "listing_checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ADD COLUMN IF NOT EXISTS "listing_checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_connector_sync_log" ADD COLUMN IF NOT EXISTS "listed_count" integer;--> statement-breakpoint
-- migration-safe: atomically widen the existing status check; all deployed writer values remain valid and no constraint-free interval is exposed.
ALTER TABLE "knowledge_connector_member_sync_log"
  DROP CONSTRAINT IF EXISTS "kcmsl_status_check",
  ADD CONSTRAINT "kcmsl_status_check" CHECK ("status" IN ('started', 'partial', 'completed', 'failed')) NOT VALID;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "kb_workspace_search_index_unique" ON "knowledge_base" USING btree ("workspace_id") WHERE "knowledge_base"."is_search_index" = true AND "knowledge_base"."deleted_at" IS NULL;--> statement-breakpoint
DO $identify_search_indexes$
DECLARE
  affected integer;
BEGIN
  LOOP
    WITH candidates AS (
      SELECT base.id
      FROM knowledge_base AS base
      WHERE base.name = 'Sim Search' AND base.workspace_id IS NOT NULL
        AND base.deleted_at IS NULL AND base.is_search_index = false
        AND NOT EXISTS (
          SELECT 1 FROM knowledge_base AS current_index
          WHERE current_index.workspace_id = base.workspace_id
            AND current_index.is_search_index = true AND current_index.deleted_at IS NULL
        )
      ORDER BY base.id
      LIMIT 500
      FOR UPDATE OF base
    )
    UPDATE knowledge_base AS base SET is_search_index = true
    FROM candidates WHERE base.id = candidates.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$identify_search_indexes$;
--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_workspace_unique" ON "credential_group" USING btree ("workspace_id");--> statement-breakpoint
-- migration-safe: the workspace unique index also enforces per-workspace name uniqueness; no column or data is removed
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_workspace_name_unique";--> statement-breakpoint
-- migration-safe: the workspace unique index resolves the single row before status filtering; no column or data is removed
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_workspace_status_idx";
--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "directory_checkpoint" jsonb;
--> statement-breakpoint
-- migration-safe: additive directory coordination table; existing group and connector tables remain unchanged.
CREATE TABLE IF NOT EXISTS "knowledge_external_directory" (
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"sync_lock_token" text,
	"sync_lock_lease_at" timestamp,
	"last_started_at" timestamp,
	"last_complete_sync_at" timestamp,
	CONSTRAINT "ked_identity_pk" PRIMARY KEY("workspace_id","provider_id","tenant_id"),
	CONSTRAINT "knowledge_external_directory_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action
);

--> statement-breakpoint
ALTER TABLE "rate_limit_bucket" ADD COLUMN IF NOT EXISTS "blocked_until" timestamp;
